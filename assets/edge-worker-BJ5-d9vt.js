(function() {
	function t(t) {
		if (t.length < 4) return null;
		const e = t.reduce((t, e) => t.x + t.y < e.x + e.y ? t : e), o = t.reduce((t, e) => t.x + t.y > e.x + e.y ? t : e), n = t.reduce((t, e) => t.x - t.y > e.x - e.y ? t : e), a = t.reduce((t, e) => t.x - t.y < e.x - e.y ? t : e);
		return (/* @__PURE__ */ new Set([
			r(e),
			r(n),
			r(o),
			r(a)
		])).size < 4 ? null : [
			e,
			n,
			o,
			a
		];
		function r(t) {
			return `${Math.round(t.x)}:${Math.round(t.y)}`;
		}
	}
	function e(t, e, n, a, r, s) {
		const c = function(t) {
			const [e, o, n, a] = t;
			return Math.abs(e.x * o.y - e.y * o.x + (o.x * n.y - o.y * n.x) + (n.x * a.y - n.y * a.x) + (a.x * e.y - a.y * e.x)) / 2;
		}(t) / (e * n);
		if (c < .05 || c > .99) return {
			score: 0,
			details: {
				ratio: c,
				reason: "ratio"
			}
		};
		const h = o(t[0], t[1], e, n, a, r, s), i = o(t[1], t[2], e, n, a, r, s), l = o(t[2], t[3], e, n, a, r, s), f = o(t[3], t[0], e, n, a, r, s), u = .3;
		if (h.maxGap > u || i.maxGap > u || l.maxGap > u || f.maxGap > u) return {
			score: 0,
			details: {
				reason: "gap_detected",
				maxGap: Math.max(h.maxGap, i.maxGap, l.maxGap, f.maxGap)
			}
		};
		const M = [
			h.score,
			i.score,
			l.score,
			f.score
		].sort((t, e) => t - e), [x, d, m, y] = M;
		if (M.filter((t) => t >= .3).length < 3) return {
			score: 0,
			details: {
				zScores: M,
				reason: "not_visible"
			}
		};
		const p = (t) => Math.min(1, Math.max(0, t / 2));
		let g = 0;
		return g = x >= .8 ? (p(h.score) + p(i.score) + p(l.score) + p(f.score)) / 4 : (p(d) + p(m) + p(y)) / 3, {
			score: g,
			details: {
				zScores: M,
				ratio: c,
				maxGap: 0
			}
		};
	}
	function o(t, e, o, n, a, r, s) {
		const c = e.x - t.x, h = e.y - t.y, i = Math.min(64, Math.max(8, Math.floor(Math.hypot(c, h) / 4)));
		let l = 0, f = 0, u = 0, M = 0;
		const x = Math.min(100, Math.max(10, s)), d = r;
		for (let m = 0; m <= i; m++) {
			const e = m / i, s = Math.round(t.x + c * e), y = Math.round(t.y + h * e), p = Math.max(0, Math.min(o - 1, s));
			let g = !1;
			const w = a[Math.max(0, Math.min(n - 1, y)) * o + p];
			w > d && (l += (w - r) / x, f++, g = !0), g ? u = 0 : (u++, u > M && (M = u));
		}
		return 0 === f ? {
			score: 0,
			maxGap: 1
		} : {
			score: l / f * (f / (i + 1)),
			maxGap: M / (i + 1)
		};
	}
	self.onmessage = (o) => {
		const n = o.data;
		if ("detect" !== n.type) return;
		const a = performance.now(), r = function(o, n, a) {
			const r = n * a, s = new Uint8Array(r), c = new Uint8Array(r);
			for (let t = 0, e = 0; t < r; t++, e += 4) s[t] = .299 * o[e] + .587 * o[e + 1] + .114 * o[e + 2] | 0;
			for (let t = 1; t < a - 1; t++) {
				const e = t * n;
				for (let t = 1; t < n - 1; t++) {
					const o = e + t;
					c[o] = (s[o - n - 1] + s[o - n] + s[o - n + 1] + s[o - 1] + s[o] + s[o + 1] + s[o + n - 1] + s[o + n] + s[o + n + 1]) / 9;
				}
			}
			const h = new Uint16Array(r);
			let i = 0, l = 0, f = 0;
			const u = [];
			for (let t = 1; t < a - 1; t++) {
				const e = t * n;
				for (let t = 1; t < n - 1; t++) {
					const o = e + t, a = -c[o - n - 1] - 2 * c[o - 1] - c[o + n - 1] + c[o - n + 1] + 2 * c[o + 1] + c[o + n + 1], r = -c[o - n - 1] - 2 * c[o - n] - c[o - n + 1] + c[o + n - 1] + 2 * c[o + n] + c[o + n + 1], s = Math.abs(a) + Math.abs(r);
					h[o] = s, i += s, l += s * s, f++;
				}
			}
			if (0 === f) return {
				quad: null,
				confidence: 0,
				width: n,
				height: a
			};
			const M = i / f, x = Math.max(0, l / f - M * M), d = Math.sqrt(x), m = M + 1 * d;
			for (let t = 2; t < a - 2; t++) {
				const e = t * n;
				for (let t = 2; t < n - 2; t++) {
					const o = e + t;
					h[o] > m && u.push(o);
				}
			}
			const y = 180, p = Math.PI / 180, g = Math.ceil(2 * Math.ceil(Math.hypot(n, a)) / 2), w = Math.floor(g / 2), G = new Uint16Array(g * y), b = new Float32Array(y), q = new Float32Array(y);
			for (let t = 0; t < y; t++) {
				const e = t * p;
				b[t] = Math.cos(e), q[t] = Math.sin(e);
			}
			for (const t of u) {
				const e = t % n, o = t / n | 0;
				for (let t = 0; t < y; t++) {
					const n = e * b[t] + o * q[t], a = Math.floor(n / 2) + w;
					a >= 0 && a < g && G[t * g + a]++;
				}
			}
			const A = [], F = [], U = Math.max(15, u.length / 100);
			for (let t = 0; t < G.length; t++) {
				const e = G[t];
				if (e > U) {
					const o = Math.floor(t / g), n = t % g;
					let a = !0;
					for (let t = -1; t <= 1; t++) {
						for (let r = -1; r <= 1; r++) {
							if (0 === t && 0 === r) continue;
							const s = (o + t) * g + (n + r);
							if (s >= 0 && s < G.length && G[s] > e) {
								a = !1;
								break;
							}
						}
						if (!a) break;
					}
					if (a) {
						const t = 2 * (n - w), a = o * p, r = a * (180 / Math.PI), s = {
							rho: t,
							theta: a,
							score: e
						};
						r > 45 && r < 135 ? A.push(s) : F.push(s);
					}
				}
			}
			A.sort((t, e) => e.score - t.score), F.sort((t, e) => e.score - t.score);
			const k = (t, e) => {
				const o = [];
				for (const n of t) {
					if (o.length >= e) break;
					o.some((t) => Math.abs(t.rho - n.rho) < 30 && Math.abs(t.theta - n.theta) < .2) || o.push(n);
				}
				return o;
			}, z = k(A, 8), S = k(F, 8);
			let I = null;
			const P = (t, e) => {
				const o = Math.cos(t.theta) * Math.sin(e.theta) - Math.sin(t.theta) * Math.cos(e.theta);
				return Math.abs(o) < .1 ? null : {
					x: (Math.sin(e.theta) * t.rho - Math.sin(t.theta) * e.rho) / o,
					y: (Math.cos(t.theta) * e.rho - Math.cos(e.theta) * t.rho) / o
				};
			};
			if (z.length >= 2 && S.length >= 2) {
				const o = Math.min(z.length, 6), r = Math.min(S.length, 6);
				for (let s = 0; s < o; s++) for (let c = s + 1; c < o; c++) for (let o = 0; o < r; o++) for (let i = o + 1; i < r; i++) {
					const r = P(z[s], S[o]), l = P(z[s], S[i]), f = P(z[c], S[o]), u = P(z[c], S[i]);
					if (!(r && l && f && u)) continue;
					const x = t([
						r,
						l,
						u,
						f
					]);
					if (x) {
						const { score: t, details: o } = e(x, n, a, h, M, d);
						if (t > 0) {
							const e = o.ratio || 0, n = t + 1 * e;
							(!I || n > I.metric) && (I = {
								q: x,
								s: t,
								r: e,
								metric: n
							});
						}
					}
				}
			}
			return I ? (I.s.toFixed(2), I.r.toFixed(2), {
				quad: I.q,
				confidence: I.s,
				width: n,
				height: a
			}) : {
				quad: null,
				confidence: 0,
				width: n,
				height: a
			};
		}(n.rgba, n.width, n.height), s = performance.now() - a, c = {
			type: "result",
			width: r.width,
			height: r.height,
			confidence: r.confidence,
			quad: r.quad ? r.quad : null,
			tMs: s
		};
		self.postMessage(c);
	};
})();
