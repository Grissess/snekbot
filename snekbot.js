SNEKBOT_VERSION = "v0.3.0";
CLOSE_FOOD_LIM = [50, 5];
AWAY_SNEK_SZ = [3, 0.25];
PANIC_RAD = 650;
PANIC_PRIO = 25;
FOOD_SZ = [1, 0.3, 0];
dbgover = document.createElement("canvas");
dbgctx = dbgover.getContext("2d");
document.querySelector("body").appendChild(dbgover);
setTimeout(function() {
	dbgover.style.position = "fixed";
	dbgover.style.width = "100%";
	dbgover.style.height = "100%";
	dbgover.style.zIndex = 99999999;
	dbgover.width = window.innerWidth;
	dbgover.height = window.innerHeight;
}, 50);
var motpos;

function dbg_init() {
	dbgctx.clearRect(0, 0, dbgover.width, dbgover.height);
	dbgctx.fillStyle = '#f0f';
	dbgctx.textAlign = 'start';
	dbgctx.textBaseline = 'top';
	dbgctx.fillText("SNEKBOT VERSION "+SNEKBOT_VERSION, 0, 0);
	motpos = 12;
}

function dbg_drawmot(mo, mores) {
	dbgctx.fillText("M:"+mo.name+": "+(mores[0])+", ("+(mores[1])+","+(mores[2])+")", 0, motpos);
	motpos += 12;
}

function dbg_drawscr(x, y, r) {
	if(!r) r = 50;
	dbgctx.beginPath();
	/*
	dbgctx.moveTo(x-r, y);
	dbgctx.lineTo(x+r, y);
	dbgctx.moveTo(x, y-r);
	dbgctx.lineTo(x, y+r);
	*/
	dbgctx.arc(x, y, r, 0, 2*Math.PI);
	dbgctx.stroke();
}

function dbg_drawcen(x, y, r) {
	dbg_drawscr(window.innerWidth / 2 + x * gsc, window.innerHeight / 2 + y * gsc, r);
}

function dbg_drawpt(x, y, r) {
	dbg_drawcen(x - view_xx, y - view_yy, r);
}

function norm(x1, y1, x2, y2) {
	var dx = x1-x2, dy = y1-y2;
	return Math.sqrt(dx*dx + dy*dy);
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

function in_bb(x, y, x1, y1, x2, y2) {
	var minx = x1<x2? x1 : x2;
	var maxx = x1>x2? x1 : x2;
	var miny = y1<y2? y1 : y2;
	var maxy = y1>y2? y1 : y2;
	//console.log(minx, "<=", x, "<=", maxx);
	//console.log(miny, "<=", y, "<=", maxy);
	var res = (x >= minx && x <= maxx && y >= miny && y <= maxy);
	//console.log("Result:", res);
	return res;
}

function in_circ(x, y, xc, yc, r) {
	return norm(x, y, xc, yc) <= r;
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


function is_occluded(x, y) {
	return foreach_snek_pt(function (px, py, snek) {
		var sr = snek.sc * 14.5;
		if(in_circ(x, y, px, py, sr)) {
			return true;
		}
		var iscts = seg_circle_isct(snake.xx, snake.yy, x, y, px, py, sr);
		if(iscts.length == 0) return false;
		var ix1 = iscts[0];
		var iy1 = iscts[1];
		var ix2 = iscts[2];
		var iy2 = iscts[3];
		if(in_bb(ix1, iy1, snake.xx, snake.yy, x, y) || in_bb(ix2, iy2, snake.xx, snake.yy, x, y)) {
			dbgctx.strokeStyle = '#ff0';
			dbg_drawpt(ix1, iy1, 10);
			dbg_drawpt(ix2, iy2, 10);
			return true;
		}
		return false;
	});
}

motives = [];
function motive(name, f) {
	motives.push({"name": name, "f": f});
}

function CONST_MOTIVE(benefit) {
	return [benefit, snake.xx, snake.yy];
}

function NO_MOTIVE() { return CONST_MOTIVE(0); }
function BAD_MOTIVE() { return CONST_MOTIVE(-1); }

function food_norm(fd) {
	return (fd.sz*fd.sz * FOOD_SZ[2] + fd.sz * FOOD_SZ[1] + FOOD_SZ[0]);
}

function nearest_safe_food() {
	if(foods.length < 1) return BAD_MOTIVE();
	var closestfood = foods[0];
	var closestnorm = norm(snake.xx, snake.yy, closestfood.xx, closestfood.yy);
	var benefit = food_norm(closestfood) / closestnorm;
	for(i = 1; i < foods.length; i++) {
		var food = foods[i];
		if(!food) continue;
		var foodnorm = norm(snake.xx, snake.yy, food.xx, food.yy);
		if(foodnorm > (CLOSE_FOOD_LIM[0] + snake.sc*CLOSE_FOOD_LIM[1]) && food_norm(food) / foodnorm > benefit) {
			if(is_occluded(food.xx, food.yy)) {
				dbgctx.strokeStyle = '#f00';
				dbg_drawpt(food.xx, food.yy, 10);
			} else {
				closestfood = food;
				closestnorm = foodnorm;
				benefit = food_norm(food) / foodnorm;
			}
		}
	}
	if(is_occluded(closestfood.xx, closestfood.yy)) {
		return BAD_MOTIVE();
	}
	return [benefit, closestfood.xx - snake.xx, closestfood.yy - snake.yy];
}
motive("nearest_safe_food", nearest_safe_food);

function circle_left() {
	return [0, 100 * Math.cos(snake.eang + Math.PI / 2), 100 * Math.sin(snake.eang + Math.PI / 2)];
}
motive("circle_left", circle_left);

function circle_right() {
	return [0, 100 * Math.cos(snake.eang - Math.PI / 2), 100 * Math.sin(snake.eang - Math.PI / 2)];
}
motive("circle_right", circle_right);

function away_from_nearest_snake() {
	var closestpt = null, closestnorm = -1, closestsns = null;
	foreach_snek_pt(function (px, py, snek, sni, ipt) {
		var sr = snek.sc * 14.5;
		if(ipt == snek.pts.length - 1) {
			sr *= 2.5;
		}
		if(closestpt == null) {
			closestpt = [px, py];
			closestnorm = norm(snake.xx, snake.yy, px, py) - sr;
			closestsns = snek.sc;
		} else {
			var dist = norm(snake.xx, snake.yy, px, py) - sr;
			if(dist < closestnorm) {
				closestpt = [px, py];
				closestnorm = dist;
				closestsns = snek.sc;
			}
		}
		return false;
	});
	if(closestpt == null) {
		return BAD_MOTIVE();
	}
	if(closestsns == null) {
		closestsns = 2;
	}
	dbgctx.strokeStyle='#0ff';
	dbg_drawpt(closestpt[0], closestpt[1], 25);
	var ang = Math.atan2(closestpt[1] - snake.yy, closestpt[0] - snake.xx);
	return [(closestsns * AWAY_SNEK_SZ[1] + AWAY_SNEK_SZ[0]) / closestnorm, 100 * Math.cos(Math.PI + ang), 100 * Math.sin(Math.PI + ang)];
}
motive("away_from_nearest_snake", away_from_nearest_snake);

function panic_circles() {
	for(var theta = 0; theta < 2 * Math.PI; theta += 0.05) {
		if(!is_occluded(snake.xx + PANIC_RAD * Math.cos(theta), snake.yy + PANIC_RAD * Math.sin(theta))) {
			return BAD_MOTIVE();
		}
	}
	var left = circle_left();
	return [PANIC_PRIO, left[1], left[2]];
}
motive("panic_circles", panic_circles);

function think() {
	dbg_init();
	if(!snake) return;
	foreach_snek_pt(function (px, py, snek, sni, ipt) {
		if(ipt % 5 == 0 || ipt == snek.pts.length - 1) {
			var sr = snek.sc * 14.5;
			if(ipt == snek.pts.length - 1) {
				sr *= 2.5;
			}
			dbgctx.strokeStyle = '#f0f';
			dbg_drawpt(px, py);
		}
		return false;
	});
	var mot_res = motives.map(function(mo) {return [mo, mo.f()];});
	var a = 0, v = mot_res[0][1][0];
	for(var i = 1; i < mot_res.length; i++) {
		if(mot_res[i][1][0] > v) {
			a = i;
			v = mot_res[i][1][0];
		}
	}
	for(i = 0; i < mot_res.length; i++) {
		dbgctx.textAlign = 'start';
		dbgctx.textBaseline = 'top';
		if(i == a) {
			dbgctx.strokeStyle='#0f0';
			xm = mot_res[i][1][1];
			ym = mot_res[i][1][2];
			dbg_drawcen(xm, ym);
			dbgctx.strokeStyle='#f0f';
			dbgctx.fillStyle='#f0f';
		} else {
			dbgctx.strokeStyle='#a0a';
			dbgctx.fillStyle='#a0a';
		}
		dbg_drawmot(mot_res[i][0], mot_res[i][1]);
	}
}

setInterval(think, 15);
