// ==UserScript==
// @name         SnekBot
// @namespace    http://tampermonkey.net/
// @version      Q-0.3.9
// @description  slither.io bot
// @author       Grissess
// @match        http://slither.io
// @grant        none
// @run-at       document-start
// ==/UserScript==

if(!document.querySelector("#snekoverlay")) {
	var SNEKBOT_VERSION = "vQ-0.4.6-filesystem";

	/***** TWEAKABLE CONSTANTS *****/

	var HEAD_INFLATE = 3;
	var SIZE_TO_RADIUS = 14.5;
	var SA_RESOLUTION = Math.PI / 180;
	var SA_LENGTH = 1000;
	var REWARD_DECAY_RATE = 0.5;
	var BASELINE_PENALTY = 0.2;
	var DEATH_REWARD = -25;
	var LEAD_FACTOR = 1.5;
	var KILL_REWARD = 5;
	var REWARD_SIZE_FACTOR = 15;

	/***** DEBUG DRAWING *****/

	var DEBUG_DRAW = true;
	var dbgover = document.createElement("canvas");
	dbgover.id = "snekoverlay";
	var dbgctx = dbgover.getContext("2d");
	document.body.appendChild(dbgover);
	setTimeout(() => {
		dbgover.style.position = "fixed";
		dbgover.style.width = "100%";
		dbgover.style.height = "100%";
		dbgover.style.zIndex = 99999999;
		dbgover.width = window.innerWidth;
		dbgover.height = window.innerHeight;
	}, 50);
	var dbgtxty = 0, TAU = 2 * Math.PI;

	function dbg_txtstyle() {
		dbgctx.fillStyle = "#f0f";
		dbgctx.textAlign = "start";
		dbgctx.textBaseline = "top";
	}

	function dbg_init() {
		dbgctx.clearRect(0, 0, dbgover.width, dbgover.height);
		dbg_txtstyle();
		dbgctx.fillText("SNEKBOT VERSION " + SNEKBOT_VERSION, 0, 0);
		dbgtxty = 12;
	}

	function dbg_drawtxt(txt) {
		dbgctx.fillStyle = "#f0f";
		dbgctx.fillText(txt, 0, dbgtxty);
		dbgtxty += 12;
	}

	function dbg_drawscr(x, y, r) {
		if(!DEBUG_DRAW) return;
		if(!r) r = 50;
		dbgctx.beginPath();
		dbgctx.arc(x, y, r, 0, TAU);
		dbgctx.stroke();
	}

	function dbg_drawcen(x, y, r) {
		dbg_drawscr(window.innerWidth / 2 + x * gsc, window.innerHeight / 2 + y * gsc, r);
	}

	function dbg_drawpt(x, y, r) {
		dbg_drawcen(x - view_xx, y - view_yy, r);
	}

	function dbg_drawscrln(x1, y1, x2, y2) {
		if(!DEBUG_DRAW) return;
		dbgctx.beginPath();
		dbgctx.moveTo(x1, y1);
		dbgctx.lineTo(x2, y2);
	}

	function dbg_drawcenln(x1, y1, x2, y2) {
		var hw = window.innerWidth / 2, hh = window.innerHeight / 2;
		dbg_drawscrln(hw + x1 * gsc, hh + y1 * gsc, hw + x2 * gsc, hh + y2 * gsc);
	}

	function dbg_drawln(x1, y1, x2, y2) {
		dbg_drawcenln(x1 - view_xx, y1 - view_yy, x2 - view_xx, y2 - view_yy);
	}

	/***** UTILITIES *****/

	function norm(x1, y1, x2, y2) {
		var dx = x2 - x1, dy = y2 - y1;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function seg_circle_isct(x1, y1, x2, y2, xc, yc, r) {
		x1 -= xc;
		x2 -= xc;
		y1 -= yc;
		y2 -= yc;
		var dist = norm(x1, y1, x2, y2);
		var deter = (x1 * y2) - (x2 * y1);
		var discr = r*r * dist*dist - deter*deter;
		if(discr < 0) return [];
		var ix1 = (deter * (y2-y1) + Math.sign(y2-y1) * (x2-x1) * Math.sqrt(discr)) / (dist*dist);
		var ix2 = (deter * (y2-y1) - Math.sign(y2-y1) * (x2-x1) * Math.sqrt(discr)) / (dist*dist);
		var iy1 = (-deter * (x2-x1) + Math.abs(y2-y1) * Math.sqrt(discr)) / (dist*dist);
		var iy2 = (-deter * (x2-x1) - Math.abs(y2-y1) * Math.sqrt(discr)) / (dist*dist);
		ix1 += xc;
		ix2 += xc;
		iy1 += yc;
		iy2 += yc;
		return [ix1, iy1, ix2, iy2];
	}

	function closest_on_line(x1, y1, x2, y2, xp, yp) {
		var dx = x2 - x1, dy = y2 - y1;
		var mgsqr = dx*dx + dy*dy;
		var dot = (xp-x1)*dx + (yp-y1)*dy;
		var t = dot / mgsqr;
		return [x1 + dx * t, y1 + dy * t, t];
	}

	function foreach_snek_pt(f) {
		for(var sni = 0; sni < snakes.length; sni++) {
			var snek = snakes[sni];
			if(snek.id == snake.id) continue;
			var first = true;
			var slen = snek.cfl;
			var lpx, lpy;
			for(var ipt = snek.pts.length - 1; ipt >= 0 && slen > 0; ipt--, slen--) {
				var pt = snek.pts[ipt];
				var px = pt.xx + pt.fx, py = pt.yy + pt.fy;
				if(!first) {
					px = (lpx + px) / 2;
					py = (lpy + py) / 2;
				}
				var res = f(px, py, snek, sni, ipt);
				if(res) {
					return res;
				}
				lpx = px;
				lpy = py;
				first = false;
			}
		}
		return false;
	}

	function foreach_food(f) {
		foods.filter(fd => fd != null).forEach(fd => f(fd.xx, fd.yy, fd.sz, fd));
	}

	/***** STATE FUNCTIONS *****/

	var STATE_FUNCTIONS = [
		() => {
			return {"type": "center", "st": [norm(snake.xx, snake.yy, 2e4, 2e4)]};
		},
		() => {
			var fpts = [];
			foreach_food((x, y, sz, fd) => fpts.push({"norm": norm(x, y, snake.xx, snake.yy), "x": x, "y": y, "sz": sz}));
			fpts.sort((a, b) => a.norm - b.norm);
			var fpt = fpts[0];
			dbgctx.strokeStyle = "#0f0";
			dbg_drawpt(fpt.x, fpt.y);
			return {"type": "food", "st": [fpt.norm, fpt.sz], "food": fpt};
		},
		() => {
			var closestpt = null, closestnorm = -1, closestsn = null;
			foreach_snek_pt((px, py, snek, sni, ipt) => {
				var sr = snek.sc * SIZE_TO_RADIUS;
				if(ipt == snek.pts.length - 1) sr *= HEAD_INFLATE;
				if(closestpt == null || (norm(snake.xx, snake.yy, px, py) - sr) < closestnorm) {
					closestpt = [px, py];
					closestnorm = norm(snake.xx, snake.yy, px, py);
					closestsn = snek;
				}
			});
			var pris = [4e4, 0, 0, 4e4, 4e4, 4e4];
			if(closestpt != null) {
				pris[0] = closestnorm;
				pris[1] = closestsn.sc;
				pris[2] = (closestsn.ang + snake.ang) % TAU;
				var headpt = closestsn.pts[closestsn.pts.length - 1];
				pris[3] = norm(headpt.xx, headpt.yy, snake.xx, snake.yy);
				var fwdpt = [headpt.xx + closestsn.sp * Math.cos(closestsn.ang), headpt.yy + closestsn.sp * Math.sin(closestsn.ang)];
				var sr = closestsn.sc * SIZE_TO_RADIUS;
				var dx = fwdpt[0] - headpt.xx, dy = fwdpt[1] - headpt.yy;
				var cutoff_t = closest_on_line(headpt.xx, headpt.yy, fwdpt[0], fwdpt[1], snake.xx, snake.yy)[2];
				var dist = norm(0, 0, dx, dy);
				cutoff_t += LEAD_FACTOR * (sr / dist);
				var cutoff = [headpt.xx + dx * cutoff_t, headpt.yy + dy * cutoff_t];
				pris[4] = norm(cutoff[0], cutoff[1], headpt.xx, headpt.yy) / (dist * closestsn.sp);
				pris[5] = norm(cutoff[0], cutoff[1], snake.xx, snake.yy) / (dist * snake.sp);
				dbgctx.strokeStyle="#f0f";
				dbg_drawpt(closestpt[0], closestpt[1], 25);
				dbgctx.strokeStyle="#ff0";
				dbg_drawpt(cutoff[0], cutoff[1], 25);
			}
			return {"type": "snake", "st": pris, "snek": closestsn, "snekpt": closestpt, "cutoff": cutoff};
		},
		() => {
			return {"type": "snake_count", "st": [snakes.length]};
		},
		() => {
			var snpts = [];
			foreach_snek_pt((px, py, snek, sni, ipt) => snpts.push([px, py, snek.sc * SIZE_TO_RADIUS]));
			var ang_hits = {};
			var num_hits = 0;
			dbgctx.strokeStyle = "rgba(255, 0, 0, 63)";
			for(var theta = 0; theta < TAU; theta += SA_RESOLUTION) {
				var hit = false;
				var ex = snake.xx + SA_LENGTH * Math.cos(theta);
				var ey = snake.yy + SA_LENGTH * Math.sin(theta);
				for(var ipt = 0; ipt < snpts.length; ipt++) {
					var pt = snpts[ipt];
					var pts = seg_circle_isct(snake.xx, snake.yy, ex, ey, pt[0], pt[1], pt[2]);
					if(pts.length > 0) {
						hit = true;
						break;
					}
				}
				if(hit) {
					var asin = Math.sin(theta), acos = Math.cos(theta);
					dbg_drawcenln(
						acos * 15, asin * 15, acos * 25, asin * 25
					);
					num_hits++;
					ang_hits[theta] = true;
				}
			}
			// DAHNAMIC PORGRAMMING
			var ang_runs = {};
			var cur_run = 0;
			for(var theta = 0; theta < 2 * TAU; theta += SA_RESOLUTION) {
				if((ang_runs[theta] == undefined) || (cur_run > ang_runs[theta])) {
					ang_runs[theta] = cur_run;
				}
				if(ang_hits[theta]) {
					cur_run = 0
				} else {
					cur_run++;
				}
			}
			cur_run = ang_runs[0];
			for(var theta = TAU; theta >= 0; theta -= SA_RESOLUTION) {
				if(!ang_hits[theta]) {
					if(ang_runs[theta] > cur_run) {
						cur_run = ang_runs[theta];
					}
					ang_runs[theta] = cur_run;
				} else {
					cur_run = 0;
				}
			}
			var run_arr = [];
			for(var theta = 0; theta < 2 * TAU; theta += SA_RESOLUTION) {
				run_arr.push(ang_runs[theta]);
			}
			run_arr.sort();
			var best_run = run_arr[run_arr.length - 1];
			var ang_arr = [];
			for(var theta = 0; theta < 2 * TAU; theta += SA_RESOLUTION) {
				if(ang_runs[theta] == best_run) {
					ang_arr.push(theta);
				}
			}
			var best_open_ang = ang_arr.reduce((a, b) => a + b, 0) / ang_arr.length;
			return {"type": "solid_angle", "st": [num_hits * SA_RESOLUTION / TAU], "best_open_ang": best_open_ang};
		}
	];
	var STATE_CARDINALITY = 11;
	var STATE_NORM = [
		1 / 2e4,
		1 / 4e4, 1,
		1 / 4e4, 1, 1 / TAU, 1 / 4e4, 1 / 4e4, 1 / 4e4,
		1,
		1 / TAU,
		1  // For reward
	];

	/***** ACTIONS *****/

	function get_datum(l, t) {
		for(var i = 0; i < l.length; i++) {
			if(l[i].type == t) {
				return l[i];
			}
		}
	}

	function toward_ang(ang, boost) {
		if(boost == undefined) boost = 0;
		return [100 * Math.cos(ang), 100 * Math.sin(ang), boost];
	}

	var ACTION_FUNCTIONS = [
		(d) => {  // Toward center
			return toward_ang(Math.atan2(2e4 - snake.yy, 2e4 - snake.xx));
		},
		(d) => {  // Circle left
			return toward_ang(snake.ang + Math.PI / 2);
		},
		(d) => {  // Away from nearest snake
			var snek = get_datum(d, "snake");
			if(d.snekpt != undefined) {
				return toward_ang(Math.atan2(d.snekpt[1] - snake.yy, d.snekpt[0] - snake.xx) + Math.PI);
			}
			return [0, 0, 0];
		},
		(d) => {  // Toward nearest food
			var fud = get_datum(d, "food");
			return [fud.food.x - snake.xx, fud.food.y - snake.yy, 0];
		},
		(d) => {  // Toward open air, quickly
			var sa = get_datum(d, "solid_angle");
			return toward_ang(sa.best_open_ang, 1);
		},
		(d) => {  // Cut off the nearest snake
			var snek = get_datum(d, "snake");
			if(snek.cutoff != undefined) {
				return [snek.cutoff[0], snek.cutoff[1], 1];
			}
			return [0, 0, 0];
		}
	];

	var ACTION_NAMES = [
		"Toward center",
		"Circle left",
		"Away from nearest snake",
		"Toward nearest food",
		"Toward open air",
		"Cut off nearest snake"
	];

	/***** MAIN *****/

	var last_size = 1, last_states = null, last_act_idx = null, last_num_snakes = 0;
	var learner = new Learner(ACTION_FUNCTIONS.length, STATE_CARDINALITY, 1, 2, "sneqbot");
	var reward = 0;

	////////// Initial learner setup
	//learner.randomize()
	learner.state_norm = STATE_NORM;
	////////// End learner setup
	
	var killed = false;
	function learn() {
		if(last_states == null) return;
		if(!snake) {
			if(last_states != null && !killed) {
				learner.cumulateReward(last_states, last_act_idx, DEATH_REWARD);
				learner.saveHeuristic();
				setTimeout(() => want_play = true, 3000);
				killed = true;
				reward = 0;
			}
			return;
		}
		killed = false;
		want_play = false;
		var delta = REWARD_SIZE_FACTOR * (snake.sc - last_size);
		reward += delta;
		if(snakes.length < last_num_snakes) {
			reward += KILL_REWARD * (last_num_snakes - snakes.length);
		}
		learner.cumulateReward(last_states, last_act_idx, reward - BASELINE_PENALTY);
		learner.decayAll();
		reward *= REWARD_DECAY_RATE;

		last_size = snake.sc;
		last_num_snakes = snakes.length;
	}
	setInterval(learn, 500);

	function think() {
		dbg_init();

		if(!snake) return;

		foreach_snek_pt((px, py, snek, sni, ipt) => {
			if((ipt % 5 == 0) || (ipt == snek.pts.length - 1)) {
				var sr = snek.sc * SIZE_TO_RADIUS;
				if(ipt == snek.pts.length - 1) sr *= HEAD_INFLATE;
				dbgctx.strokeStyle = "#f00";
				dbg_drawpt(px, py, sr * gsc);
			}
		});

		var data = STATE_FUNCTIONS.map(f => f());
		var feature_vec = [].concat.apply([], data.map(d => d.st));
		feature_vec.push(reward - BASELINE_PENALTY);
		var act_idx = learner.getBestAction(feature_vec);
		var output_vec;
		while(true) {
			output_vec = ACTION_FUNCTIONS[act_idx](data);
			if(output_vec[0] != 0 || output_vec[1] != 1 || output_vec[2] != 0) {
				break;
			}
			act_idx = Math.floor(Math.random() * ACTION_FUNCTIONS.length);
		}
		xm = output_vec[0];
		ym = output_vec[1];
		setAcceleration(output_vec[2]);
		if(output_vec[2]) {
			dbgctx.strokeStyle = "#0ff";
		} else {
			dbgctx.strokeStyle = "#fff";
		}
		dbg_drawcen(xm, ym);

		dbg_txtstyle();
		dbg_drawtxt("Reward: " + (reward - BASELINE_PENALTY));
		dbg_drawtxt("For action: " + act_idx + " (" + ACTION_NAMES[act_idx] + ")");
		dbg_drawtxt("Fvec: " + feature_vec);
		dbg_drawtxt("Fvec_norm: " + feature_vec.map((v, idx) => v * STATE_NORM[idx]));
		for(var i = 0; i < learner.n_act; i++) {
			for(var j = 0; j < learner.n_state; j++) {
				if(i == act_idx) {
					if(reward > BASELINE_PENALTY) {
						dbgctx.fillStyle = "#0f0";
					} else {
						dbgctx.fillStyle = "#f00";
					}
				} else {
					dbgctx.fillStyle = "#f0f";
				}
				dbg_drawtxt("Act " + i + " state " + j + " poly: " + learner.heur[i][j]);
			}
		}

		last_states = feature_vec;
		last_act_idx = act_idx;
	}

	setInterval(think, 15);
}
