/* global BeamSolver */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'beam-calculator-state-v1';
  // SVG width tracks the rendered width so text stays a readable size.
  let W = 820;
  let PAD_L = 64;
  const PAD_R = 28;
  function measure() {
    const fig = document.querySelector('#diagrams figure');
    const w = fig ? fig.clientWidth : 0;
    W = Math.round(Math.max(300, w || 820));
    PAD_L = W < 560 ? 44 : 64;
  }

  const $ = (id) => document.getElementById(id);
  let uid = 1;
  const nextId = () => uid++;

  // ---------------------------------------------------------------- state ---

  const EXAMPLES = {
    'ss-point': { L: 6, support: 'simple', a: 0, b: 6, loads: [{ kind: 'point', x: 3, P: 20 }] },
    'ss-udl': { L: 8, support: 'simple', a: 0, b: 8, loads: [{ kind: 'udl', x1: 0, x2: 8, w1: 10, w2: 10 }] },
    'ss-tri': { L: 9, support: 'simple', a: 0, b: 9, loads: [{ kind: 'udl', x1: 0, x2: 9, w1: 0, w2: 12 }] },
    overhang: {
      L: 10, support: 'simple', a: 0, b: 7.5,
      loads: [
        { kind: 'udl', x1: 0, x2: 7.5, w1: 8, w2: 8 },
        { kind: 'point', x: 3, P: 25 },
        { kind: 'point', x: 10, P: 15 },
      ],
    },
    cant: {
      L: 4, support: 'cantilever-left', a: 0, b: 4,
      loads: [
        { kind: 'udl', x1: 0, x2: 4, w1: 5, w2: 5 },
        { kind: 'point', x: 4, P: 10 },
      ],
    },
    moment: {
      L: 10, support: 'simple', a: 0, b: 10,
      loads: [{ kind: 'moment', x: 4, M: 40 }, { kind: 'point', x: 7, P: 10 }],
    },
  };

  const defaultState = () => ({
    L: 10,
    support: 'simple',
    a: 0,
    b: 10,
    useEI: true,
    E: 200,
    I: 300,
    tension: false,
    loads: [
      { id: nextId(), kind: 'point', x: 3, P: 20 },
      { id: nextId(), kind: 'udl', x1: 5, x2: 10, w1: 6, w2: 6 },
    ],
  });

  let state = load() || defaultState();
  let result = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.loads)) return null;
      s.loads.forEach((l) => (l.id = nextId()));
      return s;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable */
    }
  }

  // ------------------------------------------------------------ formatting ---

  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    let d = digits;
    if (d === undefined) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    let s = v.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (/^-0(\.0*)?$/.test(s)) s = '0';
    return s.replace('-', '−');
  }
  const fx = (x) => fmt(x, 3);

  // ---------------------------------------------------------------- inputs ---

  const inputs = {
    length: $('length'), support: $('support'), supA: $('supA'), supB: $('supB'),
    useEI: $('useEI'), E: $('E'), I: $('I'), tension: $('tension'),
  };

  function num(el) {
    const v = el.value.trim() === '' ? NaN : Number(el.value);
    return v;
  }

  function syncInputsFromState() {
    inputs.length.value = state.L;
    inputs.support.value = state.support;
    inputs.supA.value = state.a;
    inputs.supB.value = state.b;
    inputs.useEI.checked = state.useEI;
    inputs.E.value = state.E;
    inputs.I.value = state.I;
    inputs.tension.checked = state.tension;
    updateVisibility();
    renderLoads();
  }

  function updateVisibility() {
    document.querySelectorAll('.simple-only').forEach((el) => (el.hidden = state.support !== 'simple'));
    $('eiFields').classList.toggle('disabled', !state.useEI);
    inputs.E.disabled = inputs.I.disabled = !state.useEI;
    $('figY').hidden = !state.useEI;
  }

  function bindTopInputs() {
    inputs.length.addEventListener('input', () => {
      const oldL = state.L;
      state.L = num(inputs.length);
      // Keep the roller at the end if it was there before.
      if (state.support === 'simple' && state.b === oldL && state.L > 0) {
        state.b = state.L;
        inputs.supB.value = state.b;
      }
      update();
    });
    inputs.support.addEventListener('change', () => {
      state.support = inputs.support.value;
      updateVisibility();
      update();
    });
    inputs.supA.addEventListener('input', () => { state.a = num(inputs.supA); update(); });
    inputs.supB.addEventListener('input', () => { state.b = num(inputs.supB); update(); });
    inputs.useEI.addEventListener('change', () => { state.useEI = inputs.useEI.checked; updateVisibility(); update(); });
    inputs.E.addEventListener('input', () => { state.E = num(inputs.E); update(); });
    inputs.I.addEventListener('input', () => { state.I = num(inputs.I); update(); });
    inputs.tension.addEventListener('change', () => { state.tension = inputs.tension.checked; update(); });

    document.querySelectorAll('[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const L = state.L > 0 ? state.L : 10;
        const kind = btn.dataset.add;
        const mid = round(L / 2);
        const ld =
          kind === 'point' ? { kind, x: mid, P: 10 } :
          kind === 'udl' ? { kind, x1: 0, x2: L, w1: 5, w2: 5 } :
          { kind, x: mid, M: 10 };
        ld.id = nextId();
        state.loads.push(ld);
        renderLoads();
        update();
      })
    );

    $('example').addEventListener('change', (e) => {
      const ex = EXAMPLES[e.target.value];
      if (!ex) return;
      state = { ...state, ...JSON.parse(JSON.stringify(ex)) };
      state.loads.forEach((l) => (l.id = nextId()));
      e.target.value = '';
      syncInputsFromState();
      update();
    });

    $('csv').addEventListener('click', downloadCsv);
  }

  const round = (v) => Math.round(v * 1000) / 1000;

  const LOAD_FIELDS = {
    point: { title: 'Point load', fields: [['x', 'Position', 'm'], ['P', 'Force', 'kN']] },
    udl: {
      title: 'Distributed load',
      fields: [['x1', 'Start', 'm'], ['x2', 'End', 'm'], ['w1', 'w at start', 'kN/m'], ['w2', 'w at end', 'kN/m']],
    },
    moment: { title: 'Applied moment', fields: [['x', 'Position', 'm'], ['M', 'Moment', 'kN·m']] },
  };

  function renderLoads() {
    const list = $('loads');
    list.innerHTML = '';
    if (!state.loads.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No loads yet. Add one above.';
      list.appendChild(li);
      return;
    }
    state.loads.forEach((ld, i) => {
      const spec = LOAD_FIELDS[ld.kind];
      const li = document.createElement('li');
      li.className = 'load';
      li.innerHTML =
        `<div class="load-head"><span>${i + 1}. ${spec.title}</span>` +
        `<button type="button" class="del" aria-label="Remove load ${i + 1}" title="Remove">×</button></div>` +
        `<div class="grid3">${spec.fields
          .map(
            ([key, label, unit]) =>
              `<label class="field"><span>${label} <em>${unit}</em></span>` +
              `<input type="number" step="any" inputmode="decimal" data-key="${key}" value="${ld[key]}"></label>`
          )
          .join('')}</div>`;
      li.querySelector('.del').addEventListener('click', () => {
        state.loads = state.loads.filter((l) => l.id !== ld.id);
        renderLoads();
        update();
      });
      li.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('input', () => {
          ld[inp.dataset.key] = num(inp);
          inp.classList.toggle('invalid', !Number.isFinite(ld[inp.dataset.key]));
          update();
        })
      );
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- solve ---

  function buildBeam() {
    const support =
      state.support === 'simple' ? { type: 'simple', a: state.a, b: state.b } : { type: state.support };
    const loads = state.loads.map(({ id, ...rest }) => rest);
    const beam = { length: state.L, support, loads };
    if (state.useEI) beam.EI = state.E * state.I; // GPa × 10⁶ mm⁴ = kN·m²
    return beam;
  }

  function update() {
    save();
    const r = BeamSolver.solve(buildBeam());
    const errBox = $('errors');
    if (!r.ok) {
      errBox.hidden = false;
      errBox.innerHTML = '<ul>' + r.errors.map((e) => `<li>${e}</li>`).join('') + '</ul>';
      $('diagrams').classList.add('stale');
      return;
    }
    errBox.hidden = true;
    $('diagrams').classList.remove('stale');
    result = r;
    renderStats();
    render();
  }

  function render() {
    if (!result) return;
    measure();
    renderLoadDiagram();
    renderChart($('svgV'), 'V', 'var(--shear)', 'kN', 1);
    renderChart($('svgM'), 'M', 'var(--moment)', 'kN·m', state.tension ? -1 : 1);
    if (result.deflection) renderChart($('svgY'), 'y', 'var(--defl)', 'mm', 1);
    renderTable();
    clearCursor();
  }

  // ---------------------------------------------------------------- stats ---

  function renderStats() {
    const s = result.summary;
    const tiles = [];
    const reactText = result.reactions
      .map((r) => `${r.label} = ${fmt(r.F)}<small>kN</small>`)
      .join('<br>');
    const fixed = result.reactions.find((r) => r.kind === 'fixed');
    tiles.push({
      cls: 'react', k: 'Reactions', v: reactText, wrap: true,
      s: fixed ? `M = ${fmt(fixed.M)} kN·m ${fixed.M >= 0 ? '(cw)' : '(ccw)'}` :
        result.reactions.map((r) => `${r.label} at x = ${fx(r.x)} m`).join(', '),
    });
    tiles.push({ cls: 'moment', k: 'Max sagging moment', v: `${fmt(Math.max(0, s.maxM.value))}<small>kN·m</small>`, s: s.maxM.value > 0 ? `at x = ${fx(s.maxM.x)} m` : 'none' });
    tiles.push({ cls: 'moment', k: 'Max hogging moment', v: `${fmt(Math.min(0, s.minM.value))}<small>kN·m</small>`, s: s.minM.value < 0 ? `at x = ${fx(s.minM.x)} m` : 'none' });
    tiles.push({ cls: 'shear', k: 'Max shear |V|', v: `${fmt(Math.abs(s.absV.value))}<small>kN</small>`, s: `at x = ${fx(s.absV.x)} m` });
    if (s.absY) {
      tiles.push({ cls: 'defl', k: 'Max deflection', v: `${fmt(s.absY.value * 1000)}<small>mm</small>`, s: `at x = ${fx(s.absY.x)} m · L/${spanRatio(s.absY.value)}` });
    }
    $('stats').innerHTML = tiles
      .map((t) => `<div class="stat ${t.cls}"><div class="k">${t.k}</div><div class="v${t.wrap ? ' wrap' : ''}">${t.v}</div><div class="s">${t.s}</div></div>`)
      .join('');
  }

  function spanRatio(y) {
    if (!y) return '∞';
    // Use the span between supports for simple beams, the full length for cantilevers.
    const span = state.support === 'simple' ? Math.abs(state.b - state.a) : state.L;
    return Math.round(span / Math.abs(y)).toLocaleString();
  }

  // ------------------------------------------------------------ svg utils ---

  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, attrs = {}) {
    const t = el('text', { x, y, ...attrs }, parent);
    t.textContent = str;
    return t;
  }
  const sx = (x) => PAD_L + (x / result.length) * (W - PAD_L - PAD_R);
  const invX = (px) => ((px - PAD_L) / (W - PAD_L - PAD_R)) * result.length;

  function arrowMarker(defs, id, color) {
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 9, markerHeight: 9, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }, m);
  }

  // -------------------------------------------------------- load diagram ---

  function renderLoadDiagram() {
    const svg = $('svgLoad');
    const H = 262;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    arrowMarker(defs, 'aLoad', 'var(--load)');
    arrowMarker(defs, 'aReact', 'var(--react)');
    const beamY = 118;
    const L = result.length;
    const loads = result.loads;

    // grid lines at key points
    for (const k of result.keys) el('line', { x1: sx(k), x2: sx(k), y1: 20, y2: H - 30, class: 'grid' }, svg);

    // distributed loads (draw first, under point loads)
    const udls = loads.filter((l) => l.kind === 'udl');
    const wMax = Math.max(1e-9, ...udls.map((u) => Math.max(Math.abs(u.w1), Math.abs(u.w2))));
    const hFor = (w) => (Math.abs(w) / wMax) * 42;
    for (const u of udls) {
      const top = beamY - 6;
      const x1 = sx(u.x1);
      const x2 = sx(u.x2);
      const h1 = hFor(u.w1);
      const h2 = hFor(u.w2);
      const dir = (w) => (w >= 0 ? 1 : -1);
      // outline (drawn on top side for downward loads, both treated as top for simplicity)
      const y1 = top - h1 - 8;
      const y2 = top - h2 - 8;
      el('path', { d: `M${x1},${top} L${x1},${y1} L${x2},${y2} L${x2},${top}`, fill: 'var(--load)', 'fill-opacity': 0.06, stroke: 'var(--load)', 'stroke-width': 1.5 }, svg);
      const n = Math.max(2, Math.round((x2 - x1) / 26));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = x1 + (x2 - x1) * t;
        const w = u.w1 + (u.w2 - u.w1) * t;
        const py = y1 + (y2 - y1) * t;
        if (Math.abs(w) < 1e-9 || Math.abs(top - py) < 10) continue;
        if (dir(w) > 0) el('line', { x1: px, y1: py, x2: px, y2: top, stroke: 'var(--load)', 'stroke-width': 1.2, 'marker-end': 'url(#aLoad)' }, svg);
        else el('line', { x1: px, y1: top, x2: px, y2: py, stroke: 'var(--load)', 'stroke-width': 1.2, 'marker-end': 'url(#aLoad)' }, svg);
      }
      const label = Math.abs(u.w1 - u.w2) < 1e-9 ? `${fmt(u.w1)} kN/m` : `${fmt(u.w1)} → ${fmt(u.w2)} kN/m`;
      text(svg, (x1 + x2) / 2, Math.min(y1, y2) - 6, label, { 'text-anchor': 'middle', class: 'val' });
    }

    // beam
    el('rect', { x: sx(0), y: beamY - 5, width: sx(L) - sx(0), height: 10, rx: 2, fill: 'var(--line-strong)', stroke: 'var(--ink)', 'stroke-width': 1.2 }, svg);

    // point loads
    for (const p of loads.filter((l) => l.kind === 'point')) {
      const px = sx(p.x);
      if (p.P >= 0) el('line', { x1: px, y1: beamY - 70, x2: px, y2: beamY - 6, stroke: 'var(--load)', 'stroke-width': 2.2, 'marker-end': 'url(#aLoad)' }, svg);
      else el('line', { x1: px, y1: beamY - 6, x2: px, y2: beamY - 70, stroke: 'var(--load)', 'stroke-width': 2.2, 'marker-end': 'url(#aLoad)' }, svg);
      text(svg, px, beamY - 76, `${fmt(Math.abs(p.P))} kN`, { 'text-anchor': 'middle', class: 'val' });
    }

    // applied moments
    for (const m of loads.filter((l) => l.kind === 'moment')) {
      drawMomentArc(svg, sx(m.x), beamY, 20, m.M >= 0, 'var(--load)', 'aLoad');
      text(svg, sx(m.x), beamY - 30, `${fmt(Math.abs(m.M))} kN·m`, { 'text-anchor': 'middle', class: 'val' });
    }

    // supports & reactions
    for (const r of result.reactions) {
      const px = sx(r.x);
      if (r.kind === 'fixed') {
        const left = r.x === 0;
        const wx = left ? px - 12 : px;
        el('rect', { x: wx, y: beamY - 34, width: 12, height: 68, fill: 'var(--line)', stroke: 'none' }, svg);
        el('line', { x1: px, y1: beamY - 34, x2: px, y2: beamY + 34, stroke: 'var(--ink)', 'stroke-width': 2 }, svg);
        for (let i = 0; i < 7; i++) {
          const yy = beamY - 30 + i * 10;
          el('line', { x1: px, y1: yy, x2: left ? px - 10 : px + 10, y2: yy + 8, stroke: 'var(--ink)', 'stroke-width': 1 }, svg);
        }
        // reaction moment
        if (Math.abs(r.M) > 1e-9) {
          const cx = left ? px + 26 : px - 26;
          drawMomentArc(svg, cx, beamY + 44, 14, r.M >= 0, 'var(--react)', 'aReact');
          text(svg, cx, beamY + 76, `M = ${fmt(Math.abs(r.M))} kN·m`, { 'text-anchor': left ? 'start' : 'end', class: 'val', style: 'fill: var(--react)', dx: left ? -14 : 14 });
        }
        drawReactionArrow(svg, left ? px + 56 : px - 56, beamY, r, left ? 'start' : 'end');
      } else {
        // triangle
        const ty = beamY + 5;
        el('path', { d: `M${px},${ty} L${px - 11},${ty + 18} L${px + 11},${ty + 18} z`, fill: 'var(--panel)', stroke: 'var(--ink)', 'stroke-width': 1.5 }, svg);
        if (r.kind === 'roller') {
          el('circle', { cx: px - 6, cy: ty + 22, r: 3.5, fill: 'var(--panel)', stroke: 'var(--ink)', 'stroke-width': 1.2 }, svg);
          el('circle', { cx: px + 6, cy: ty + 22, r: 3.5, fill: 'var(--panel)', stroke: 'var(--ink)', 'stroke-width': 1.2 }, svg);
          el('line', { x1: px - 14, x2: px + 14, y1: ty + 26.5, y2: ty + 26.5, stroke: 'var(--ink)', 'stroke-width': 1.2 }, svg);
        } else {
          el('line', { x1: px - 14, x2: px + 14, y1: ty + 18, y2: ty + 18, stroke: 'var(--ink)', 'stroke-width': 1.2 }, svg);
          for (let i = 0; i < 5; i++) el('line', { x1: px - 12 + i * 6, y1: ty + 18, x2: px - 16 + i * 6, y2: ty + 24, stroke: 'var(--ink)', 'stroke-width': 1 }, svg);
        }
        drawReactionArrow(svg, px, beamY + 18, r, px > W - PAD_R - 90 ? 'end' : 'middle');
      }
    }

    // dimension axis
    const ay = H - 18;
    el('line', { x1: sx(0), x2: sx(L), y1: ay, y2: ay, class: 'axis' }, svg);
    let lastPx = -1e9;
    for (const k of result.keys) {
      const px = sx(k);
      el('line', { x1: px, x2: px, y1: ay - 4, y2: ay + 4, class: 'axis' }, svg);
      if (px - lastPx >= 34 || k === L) {
        if (k === L && px - lastPx < 34) continue;
        text(svg, px, ay + 15, fx(k), { 'text-anchor': 'middle' });
        lastPx = px;
      }
    }
    text(svg, PAD_L - 10, ay + 4, 'x (m)', { 'text-anchor': 'end' });
    addCursorLayer(svg, H, 20, H - 30);
  }

  function drawReactionArrow(svg, px, yTop, r, anchor) {
    if (Math.abs(r.F) < 1e-9) return;
    const len = 40;
    const yBase = yTop + len;
    if (r.F > 0) el('line', { x1: px, y1: yBase + 20, x2: px, y2: yTop + 20, stroke: 'var(--react)', 'stroke-width': 2.2, 'marker-end': 'url(#aReact)' }, svg);
    else el('line', { x1: px, y1: yTop + 20, x2: px, y2: yBase + 20, stroke: 'var(--react)', 'stroke-width': 2.2, 'marker-end': 'url(#aReact)' }, svg);
    const dx = anchor === 'middle' ? 8 : anchor === 'start' ? 6 : -6;
    text(svg, px + dx, yBase + 14, `${r.label} = ${fmt(Math.abs(r.F))} kN`, { 'text-anchor': anchor === 'middle' ? 'start' : anchor, class: 'val', style: 'fill: var(--react)' });
  }

  /** Arc arrow around (cx, cy). Clockwise on screen when `cw`. */
  function drawMomentArc(svg, cx, cy, rad, cw, color, marker) {
    const pt = (deg) => {
      const a = (deg * Math.PI) / 180;
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    };
    // Angles measured clockwise on screen from +x. Arc passes over the top (270°).
    const [s, e] = cw ? [150, 390] : [390, 150];
    const [x0, y0] = pt(s);
    const [x1, y1] = pt(e);
    el('path', { d: `M${x0},${y0} A${rad},${rad} 0 1 ${cw ? 1 : 0} ${x1},${y1}`, fill: 'none', stroke: color, 'stroke-width': 2, 'marker-end': `url(#${marker})` }, svg);
  }

  // --------------------------------------------------------------- charts ---

  function renderChart(svg, key, color, unit, flip) {
    const H = 190;
    const top = 24;
    const bottom = H - 26;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const isY = key === 'y';
    const scale = isY ? 1000 : 1; // m → mm
    const data = (isY ? result.deflection : result.points).map((p) => ({ x: p.x, v: p[key] * scale }));
    let vmin = Math.min(0, ...data.map((d) => d.v * flip));
    let vmax = Math.max(0, ...data.map((d) => d.v * flip));
    if (vmax - vmin < 1e-12) { vmax = 1; vmin = -1; }
    const padV = (vmax - vmin) * 0.12;
    vmax += padV;
    vmin -= padV;
    const sy = (v) => top + ((vmax - v * flip) / (vmax - vmin)) * (bottom - top);

    for (const k of result.keys) el('line', { x1: sx(k), x2: sx(k), y1: top - 8, y2: bottom + 6, class: 'grid' }, svg);

    const y0 = sy(0);
    let d = `M${sx(data[0].x)},${y0}`;
    for (const p of data) d += ` L${sx(p.x).toFixed(2)},${sy(p.v).toFixed(2)}`;
    d += ` L${sx(data[data.length - 1].x)},${y0} Z`;
    el('path', { d, fill: color, stroke: 'none', style: `fill-opacity: var(--fill-alpha)` }, svg);
    let line = '';
    data.forEach((p, i) => (line += `${i ? ' L' : 'M'}${sx(p.x).toFixed(2)},${sy(p.v).toFixed(2)}`));
    el('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);

    // zero axis
    el('line', { x1: sx(0), x2: sx(result.length), y1: y0, y2: y0, class: 'axis' }, svg);
    text(svg, PAD_L - 10, y0 + 4, '0', { 'text-anchor': 'end' });

    // annotations: max and min
    const s = result.summary;
    const ann = isY
      ? [s.maxY, s.minY].map((a) => a && { x: a.x, v: a.value * 1000 })
      : key === 'V' ? [{ x: s.maxV.x, v: s.maxV.value }, { x: s.minV.x, v: s.minV.value }]
      : [{ x: s.maxM.x, v: s.maxM.value }, { x: s.minM.x, v: s.minM.value }];
    const seen = [];
    for (const a of ann) {
      if (!a || Math.abs(a.v) < 1e-9) continue;
      if (seen.some((b) => Math.abs(b.x - a.x) < 1e-6 && Math.abs(b.v - a.v) < 1e-9)) continue;
      seen.push(a);
      const px = sx(a.x);
      const py = sy(a.v);
      el('circle', { cx: px, cy: py, r: 3.5, fill: color }, svg);
      const above = a.v * flip >= 0;
      const anchor = px < PAD_L + 50 ? 'start' : px > W - PAD_R - 50 ? 'end' : 'middle';
      text(svg, px, above ? py - 8 : py + 16, `${fmt(a.v)} ${unit}`, { 'text-anchor': anchor, class: 'val' });
    }

    // label moment values at supports / load points where they are local peaks
    if (key === 'M') {
      for (const k of result.keys) {
        const p = BeamSolver.evaluate(result, k);
        if (Math.abs(p.M) < 1e-6) continue;
        if (seen.some((b) => Math.abs(b.x - k) < result.length * 0.04)) continue;
        seen.push({ x: k, v: p.M });
        const px = sx(k);
        const py = sy(p.M);
        el('circle', { cx: px, cy: py, r: 2.5, fill: color }, svg);
        const above = p.M * flip >= 0;
        text(svg, px, above ? py - 8 : py + 16, fmt(p.M), { 'text-anchor': 'middle' });
      }
    }

    svg.dataset.key = key;
    svg._sy = sy;
    svg._scale = scale;
    svg._color = color;
    addCursorLayer(svg, H, top - 8, bottom + 6);
  }

  // --------------------------------------------------------------- cursor ---

  const charts = () => [$('svgLoad'), $('svgV'), $('svgM'), $('svgY')].filter((s) => !s.closest('[hidden]'));

  function addCursorLayer(svg, H, y1, y2) {
    const g = el('g', { class: 'cursor-layer', style: 'display:none' }, svg);
    el('line', { x1: 0, x2: 0, y1, y2, class: 'cursor' }, g);
    if (svg._sy) el('circle', { cx: 0, cy: 0, r: 4.5, class: 'cursor-dot', fill: svg._color }, g);
    el('rect', { x: PAD_L - 8, y: 0, width: W - PAD_L - PAD_R + 16, height: H, fill: 'transparent', class: 'hit' }, svg);
  }

  function setCursor(x) {
    const p = BeamSolver.evaluate(result, x);
    for (const svg of charts()) {
      const g = svg.querySelector('.cursor-layer');
      if (!g) continue;
      g.style.display = '';
      const px = sx(x);
      const ln = g.querySelector('line');
      ln.setAttribute('x1', px);
      ln.setAttribute('x2', px);
      const dot = g.querySelector('circle');
      if (dot && svg._sy) {
        const key = svg.dataset.key;
        const v = key === 'y' ? p.y : p[key];
        dot.setAttribute('cx', px);
        dot.setAttribute('cy', svg._sy(v * svg._scale));
      }
    }
    let html = `<b>x = ${fmt(x, 3)} m</b><span class="sep">|</span>V = <b>${fmt(p.V)}</b> kN<span class="sep">|</span>M = <b>${fmt(p.M)}</b> kN·m`;
    if (p.y !== null) html += `<span class="sep">|</span>δ = <b>${fmt(p.y * 1000)}</b> mm`;
    $('readout').innerHTML = html;
  }

  function clearCursor() {
    document.querySelectorAll('.cursor-layer').forEach((g) => (g.style.display = 'none'));
    $('readout').textContent = 'Hover or drag across a diagram to read values.';
  }

  function bindCursor() {
    const handler = (e) => {
      if (!result) return;
      const svg = e.target.closest('svg.chart');
      if (!svg) return;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
      const x = Math.min(Math.max(invX(loc.x), 0), result.length);
      setCursor(x);
    };
    const container = $('diagrams');
    container.addEventListener('pointermove', handler);
    container.addEventListener('pointerdown', handler);
    container.addEventListener('pointerleave', clearCursor);
  }

  // ---------------------------------------------------------------- table ---

  function renderTable() {
    const hasY = !!result.deflection;
    const rows = [];
    const describe = (x) => {
      const n = [];
      for (const r of result.reactions) if (Math.abs(r.x - x) < 1e-9) n.push(r.kind === 'fixed' ? 'fixed support' : r.kind);
      result.loads.forEach((l, i) => {
        if (l.kind === 'udl') {
          if (Math.abs(l.x1 - x) < 1e-9) n.push(`load ${i + 1} start`);
          if (Math.abs(l.x2 - x) < 1e-9) n.push(`load ${i + 1} end`);
        } else if (Math.abs(l.x - x) < 1e-9) n.push(`load ${i + 1}`);
      });
      if (!n.length && (x === 0 || x === result.length)) n.push('free end');
      return n.join(', ');
    };
    const xs = [...result.keys.map((x) => ({ x, note: null })), ...result.extremaX.map((x) => ({ x, note: 'zero shear (moment peak)' }))].sort((a, b) => a.x - b.x);
    for (const { x, note } of xs) {
      const left = x > 0 ? BeamSolver.evaluate(result, x - 1e-7) : null;
      const right = BeamSolver.evaluate(result, x);
      const vl = left ? left.V : null;
      const vr = x < result.length ? right.V : null;
      rows.push(
        `<tr><td>${fx(x)}</td><td>${vl === null ? '–' : fmt(vl)}</td><td>${vr === null ? '–' : fmt(vr)}</td>` +
          `<td>${fmt(right.M)}</td>${hasY ? `<td>${fmt(right.y * 1000)}</td>` : ''}<td class="note">${note || describe(x)}</td></tr>`
      );
    }
    $('table').innerHTML =
      `<thead><tr><th>x (m)</th><th>V left (kN)</th><th>V right (kN)</th><th>M (kN·m)</th>${hasY ? '<th>δ (mm)</th>' : ''}<th>Location</th></tr></thead>` +
      `<tbody>${rows.join('')}</tbody>`;
  }

  function downloadCsv() {
    if (!result) return;
    const hasY = !!result.deflection;
    const lines = [['x_m', 'V_kN', 'M_kNm'].concat(hasY ? ['deflection_mm'] : []).join(',')];
    result.points.forEach((p, i) => {
      const row = [p.x, p.V, p.M].map((v) => +v.toFixed(6));
      if (hasY) row.push(+(result.deflection[i].y * 1000).toFixed(6));
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'beam-results.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ----------------------------------------------------------------- boot ---

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const before = W;
      measure();
      if (W !== before) render();
    }, 120);
  });

  bindTopInputs();
  bindCursor();
  syncInputsFromState();
  update();
})();
