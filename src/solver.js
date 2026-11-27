/*
 * Beam solver for statically determinate beams.
 *
 * Units (consistent): length in m, force in kN, moment in kN·m,
 * distributed load in kN/m, EI in kN·m². Deflection is returned in m.
 *
 * Sign conventions
 *   - Point loads P and distributed loads w are positive DOWNWARD.
 *   - Applied moments M are positive CLOCKWISE.
 *   - Reactions are positive UPWARD; reaction moments positive CLOCKWISE.
 *   - Shear V(x) = sum of upward forces to the left of the section.
 *   - Bending moment M(x) is positive when SAGGING (tension at the bottom).
 *   - Deflection is positive UPWARD (so a typical gravity-loaded beam has
 *     negative deflection).
 *
 * Supports
 *   - { type: 'simple', a, b }  pin at x = a and roller at x = b (overhangs allowed)
 *   - { type: 'cantilever-left' }  fixed at x = 0, free at x = L
 *   - { type: 'cantilever-right' } fixed at x = L, free at x = 0
 *
 * Loads
 *   - { kind: 'point',  x, P }
 *   - { kind: 'udl',    x1, x2, w1, w2 }   linearly varying from w1 at x1 to w2 at x2
 *   - { kind: 'moment', x, M }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BeamSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  /** Total downward force and clockwise moment about point `p` of one load. */
  function loadResultant(load, p) {
    if (load.kind === 'point') return { F: load.P, Mcw: load.P * (load.x - p) };
    if (load.kind === 'moment') return { F: 0, Mcw: load.M };
    if (load.kind === 'udl') {
      const { F, Mx1 } = partialUdl(load, load.x2);
      // Downward force to the right of p produces a clockwise moment about p.
      return { F, Mcw: F * (load.x1 - p) + Mx1 };
    }
    throw new Error('Unknown load kind: ' + load.kind);
  }

  /**
   * Force and first moment (about x1) of the part of a linearly varying load
   * lying between x1 and c (c clamped to [x1, x2]).
   */
  function partialUdl(load, c) {
    const { x1, x2, w1, w2 } = load;
    const span = x2 - x1;
    if (span <= EPS) return { F: 0, Mx1: 0 };
    const l = Math.min(Math.max(c, x1), x2) - x1;
    const k = (w2 - w1) / span;
    return {
      F: w1 * l + (k * l * l) / 2,
      Mx1: (w1 * l * l) / 2 + (k * l * l * l) / 3,
    };
  }

  function normaliseLoad(load) {
    if (load.kind === 'udl') {
      let { x1, x2, w1, w2 } = load;
      if (x2 < x1) {
        [x1, x2] = [x2, x1];
        [w1, w2] = [w2, w1];
      }
      return { kind: 'udl', x1, x2, w1, w2 };
    }
    return { ...load };
  }

  function validate(beam) {
    const errors = [];
    const L = beam.length;
    if (!(L > 0)) errors.push('Beam length must be greater than zero.');
    const s = beam.support;
    if (s.type === 'simple') {
      if (!(s.a >= 0 && s.a <= L)) errors.push('Pin support must lie on the beam.');
      if (!(s.b >= 0 && s.b <= L)) errors.push('Roller support must lie on the beam.');
      if (Math.abs(s.b - s.a) < EPS) errors.push('The two supports must be at different positions.');
    } else if (s.type !== 'cantilever-left' && s.type !== 'cantilever-right') {
      errors.push('Unknown support type.');
    }
    beam.loads.forEach((ld, i) => {
      const n = 'Load ' + (i + 1);
      const inBeam = (x) => Number.isFinite(x) && x >= -EPS && x <= L + EPS;
      if (ld.kind === 'udl') {
        if (!inBeam(ld.x1) || !inBeam(ld.x2)) errors.push(n + ': distributed load must lie on the beam.');
        if (!Number.isFinite(ld.w1) || !Number.isFinite(ld.w2)) errors.push(n + ': enter load intensities.');
      } else {
        if (!inBeam(ld.x)) errors.push(n + ': position must lie on the beam.');
        const v = ld.kind === 'point' ? ld.P : ld.M;
        if (!Number.isFinite(v)) errors.push(n + ': enter a magnitude.');
      }
    });
    if (beam.EI !== undefined && beam.EI !== null && !(beam.EI > 0)) {
      errors.push('EI must be greater than zero.');
    }
    return errors;
  }

  /** Reactions as concentrated actions: [{ x, F (up), M (cw) , label }]. */
  function reactions(beam) {
    const L = beam.length;
    const s = beam.support;
    const loads = beam.loads;
    if (s.type === 'simple') {
      const { a, b } = s;
      let F = 0;
      let Ma = 0; // clockwise moment of applied loads about a
      for (const ld of loads) {
        const r = loadResultant(ld, a);
        F += r.F;
        Ma += r.Mcw;
      }
      // Sum of clockwise moments about a = 0: Ma - Rb (b - a) = 0
      const Rb = Ma / (b - a);
      const Ra = F - Rb;
      return [
        { x: a, F: Ra, M: 0, label: 'R₁', kind: 'pin' },
        { x: b, F: Rb, M: 0, label: 'R₂', kind: 'roller' },
      ];
    }
    const xf = s.type === 'cantilever-left' ? 0 : L;
    let F = 0;
    let M = 0;
    for (const ld of loads) {
      const r = loadResultant(ld, xf);
      F += r.F;
      M += r.Mcw;
    }
    // Upward reaction at xf has no moment about xf; the fixed-end moment balances.
    return [{ x: xf, F, M: -M, label: 'R', kind: 'fixed' }];
  }

  /**
   * Shear and moment at x. `side` = 'left' gives the limit approaching x from
   * the left (concentrated actions AT x excluded), 'right' includes them.
   */
  function actionsAt(x, loads, reacts, side) {
    let V = 0;
    let M = 0;
    const included = (xp) => (side === 'left' ? xp < x - EPS : xp <= x + EPS);
    for (const r of reacts) {
      if (!included(r.x)) continue;
      V += r.F;
      M += r.F * (x - r.x) + r.M;
    }
    for (const ld of loads) {
      if (ld.kind === 'point') {
        if (!included(ld.x)) continue;
        V -= ld.P;
        M -= ld.P * (x - ld.x);
      } else if (ld.kind === 'moment') {
        if (!included(ld.x)) continue;
        M += ld.M;
      } else if (ld.kind === 'udl') {
        if (x <= ld.x1) continue;
        const { F, Mx1 } = partialUdl(ld, x);
        V -= F;
        M -= F * (x - ld.x1) - Mx1;
      }
    }
    return { V, M };
  }

  function clean(v) {
    return Math.abs(v) < 1e-9 ? 0 : v;
  }

  /**
   * Solve a beam.
   * @param {{length:number, support:object, loads:object[], EI?:number}} beamIn
   * @param {{samplesPerSegment?:number}} [opts]
   */
  function solve(beamIn, opts = {}) {
    const errors = validate(beamIn);
    if (errors.length) return { ok: false, errors };

    const L = beamIn.length;
    const loads = beamIn.loads.map(normaliseLoad);
    const beam = { ...beamIn, loads };
    const reacts = reactions(beam);
    const nSeg = opts.samplesPerSegment || 200;

    // Key x positions where diagrams may have kinks or jumps.
    const keySet = new Set([0, L]);
    for (const r of reacts) keySet.add(r.x);
    for (const ld of loads) {
      if (ld.kind === 'udl') {
        keySet.add(ld.x1);
        keySet.add(ld.x2);
      } else keySet.add(ld.x);
    }
    const keys = [...keySet]
      .map((x) => Math.min(Math.max(x, 0), L))
      .sort((p, q) => p - q)
      .filter((x, i, arr) => i === 0 || x - arr[i - 1] > EPS);

    // Sample points: at each key point record left and right limits.
    const points = [];
    const push = (x, side) => {
      const { V, M } = actionsAt(x, loads, reacts, side);
      points.push({ x, V: clean(V), M: clean(M) });
    };
    for (let k = 0; k < keys.length; k++) {
      const x = keys[k];
      if (k > 0) push(x, 'left');
      const last = points[points.length - 1];
      const { V, M } = actionsAt(x, loads, reacts, 'right');
      if (!last || last.x !== x || Math.abs(last.V - V) > 1e-9 || Math.abs(last.M - M) > 1e-9) {
        push(x, 'right');
      }
      if (k < keys.length - 1) {
        const x2 = keys[k + 1];
        for (let i = 1; i < nSeg; i++) push(x + ((x2 - x) * i) / nSeg, 'right');
      }
    }
    // Locate exact zero-shear points (moment extrema) by bisection.
    const extremaX = [];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      if (q.x - p.x <= EPS || p.V === 0) continue;
      if (q.V === 0) {
        extremaX.push(q.x); // sample landed exactly on the zero crossing
        continue;
      }
      if (p.V * q.V > 0) continue;
      let lo = p.x;
      let hi = q.x;
      let vlo = p.V;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        const vm = actionsAt(mid, loads, reacts, 'right').V;
        if (vm * vlo > 0) {
          lo = mid;
          vlo = vm;
        } else hi = mid;
      }
      extremaX.push((lo + hi) / 2);
    }

    // Deflection by double integration of M/EI with boundary conditions.
    let deflection = null;
    if (beam.EI > 0) deflection = integrateDeflection(points, beam, reacts);

    // Summary values.
    const summary = summarise(points, extremaX, loads, reacts, deflection);

    return { ok: true, length: L, reactions: reacts, points, keys, extremaX, deflection, summary, loads };
  }

  function integrateDeflection(points, beam, reacts) {
    const EI = beam.EI;
    const n = points.length;
    const theta = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const dx = points[i].x - points[i - 1].x;
      theta[i] = theta[i - 1] + ((points[i].M + points[i - 1].M) / 2 / EI) * dx;
      y[i] = y[i - 1] + ((theta[i] + theta[i - 1]) / 2) * dx;
    }
    // y_true = y + C1 x + C2
    let C1 = 0;
    let C2 = 0;
    const s = beam.support;
    const at = (x) => {
      // interpolate y and theta at x
      for (let i = 1; i < n; i++) {
        if (points[i].x >= x - EPS) {
          const p = points[i - 1];
          const q = points[i];
          const t = q.x - p.x > EPS ? (x - p.x) / (q.x - p.x) : 1;
          return { y: y[i - 1] + (y[i] - y[i - 1]) * t, th: theta[i - 1] + (theta[i] - theta[i - 1]) * t };
        }
      }
      return { y: y[n - 1], th: theta[n - 1] };
    };
    if (s.type === 'simple') {
      const ya = at(s.a).y;
      const yb = at(s.b).y;
      C1 = -(yb - ya) / (s.b - s.a);
      C2 = -ya - C1 * s.a;
    } else if (s.type === 'cantilever-right') {
      const e = at(beam.length);
      C1 = -e.th;
      C2 = -e.y - C1 * beam.length;
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = { x: points[i].x, y: y[i] + C1 * points[i].x + C2, theta: theta[i] + C1 };
    }
    return out;
  }

  function summarise(points, extremaX, loads, reacts, deflection) {
    const best = (arr, key, cmp) => {
      let b = arr[0];
      for (const p of arr) if (cmp(p[key], b[key])) b = p;
      return { value: b[key], x: b.x };
    };
    const candidates = points.slice();
    for (const x of extremaX) {
      const { V, M } = actionsAt(x, loads, reacts, 'right');
      candidates.push({ x, V: clean(V), M: clean(M) });
    }
    const gt = (u, v) => u > v + 1e-12;
    const lt = (u, v) => u < v - 1e-12;
    const res = {
      maxV: best(candidates, 'V', gt),
      minV: best(candidates, 'V', lt),
      maxM: best(candidates, 'M', gt),
      minM: best(candidates, 'M', lt),
    };
    const absMax = (a, b) => (Math.abs(a.value) >= Math.abs(b.value) ? a : b);
    res.absV = absMax(res.maxV, res.minV);
    res.absM = absMax(res.maxM, res.minM);
    if (deflection) {
      const maxY = best(deflection, 'y', gt);
      const minY = best(deflection, 'y', lt);
      res.maxY = maxY;
      res.minY = minY;
      res.absY = absMax(maxY, minY);
    }
    return res;
  }

  /** Evaluate V and M at an arbitrary x (right-hand limit). */
  function evaluate(result, x) {
    const { V, M } = actionsAt(x, result.loads, result.reactions, 'right');
    let y = null;
    if (result.deflection) {
      const d = result.deflection;
      for (let i = 1; i < d.length; i++) {
        if (d[i].x >= x) {
          const p = d[i - 1];
          const q = d[i];
          const t = q.x - p.x > EPS ? (x - p.x) / (q.x - p.x) : 1;
          y = p.y + (q.y - p.y) * t;
          break;
        }
      }
      if (y === null) y = d[d.length - 1].y;
    }
    return { x, V: clean(V), M: clean(M), y };
  }

  return { solve, evaluate, validate, reactions };
});
