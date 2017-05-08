// Heuristic indices:
// heur[action_num][state_num][poly_power]

function eval_poly(p, x, lsp) {
	var cum = 0;
	for(var i = 0; i < p.length; i++) {
		if(p[i] != 0) {  // Optimizations!
			cum += p[i] * Math.pow(x, i + lsp);
		}
	}
	return cum;
}

function argmax(arr) {
	if(arr.length == undefined || arr.length < 1) return undefined;
	var max = arr[0];
	var imax = 0;
	for(var i = 1; i < arr.length; i++) {
		if(arr[i] > max) {
			max = arr[i];
			imax = i;
		}
	}
	return [imax, max];
}

var KEY_PREFIX = "QL_";

class Learner {
	constructor(n_act, n_state, min_pow, max_pow, key) {
		if(min_pow == undefined) min_pow = -2;
		if(max_pow == undefined) max_pow = 2;
		if(key == undefined) key = "";
		this.n_act = n_act;
		this.n_state = n_state;
		this.min_pow = min_pow;
		this.max_pow = max_pow;
		this.gamma = 0.15;
		this.eta = 0.5;
		this.decay = 0.99;
		this.noise = 0.02;
		this.reward_scale = 1;
		this.key = key;
		this.state_norm = (new Array(this.n_state)).map(() => 1);
		this.loadHeuristic();
	}

	keyName() {
		return KEY_PREFIX + this.key;
	}

	loadHeuristic() {
		if(localStorage[this.keyName()] && localStorage[this.keyName()].length > 0) {
			this.heur = JSON.parse(localStorage[this.keyName()]);
		} else {
			this.resetHeuristic();
		}
	}

	saveHeuristic() {
		localStorage[this.keyName()] = JSON.stringify(this.heur);
	}

	resetHeuristic() {
		this.heur = new Array(this.n_act);
		for(var act = 0; act < this.n_act; act++) {
			this.heur[act] = new Array(this.n_state);
			for(var st = 0; st < this.n_state; st++) {
				this.heur[act][st] = new Array(this.max_pow - this.min_pow + 1);
				for(var pow = this.min_pow; pow <= this.max_pow; pow++) {
					this.heur[act][st][pow - this.min_pow] = 0;
				}
			}
		}
		this.randomize();
	}

	randomize(scale) {
		if(scale == undefined) scale = 1;
		for(var act = 0; act < this.n_act; act++) {
			for(var st = 0; st < this.n_state; st++) {
				for(var pow = this.min_pow; pow <= this.max_pow; pow++) {
					this.heur[act][st][pow - this.min_pow] = Math.random() * scale;
				}
			}
		}
	}

	eval(states) {
		var max_pow = this.max_pow;
		var weights = this.state_norm;
		states = states.map((v, idx) => v * weights[idx]);
		return this.heur.map(weights => 
			weights.map((poly, idx) =>
				eval_poly(poly, states[idx], max_pow)
			).reduce((a, b) => a + b, 0)
		);
	}

	getBestAction(states) {
		if(Math.random() < this.noise) {
			return Math.floor(this.n_act * Math.random());
		}
		var prios = this.eval(states);
		return argmax(prios)[0];
	}

	cumulateReward(states, act, reward) {
		reward *= this.reward_scale;
		var weights = this.state_norm;
		states = states.map((v, idx) => v * weights[idx]);
		for(var st = 0; st < this.n_state; st++) {
			for(var i = this.min_pow; i <= this.max_pow; i++) {
				this.heur[act][st][i - this.min_pow] += reward * states[st] * this.eta * Math.pow(this.gamma, i);
			}
		}
	}

	decayAll() {
		for(var act = 0; act < this.n_act; act++) {
			for(var st = 0; st < this.n_state; st++) {
				for(var pow = this.min_pow; pow <= this.max_pow; pow++) {
					this.heur[act][st][pow - this.min_pow] *= this.decay;
				}
			}
		}
	}
}
