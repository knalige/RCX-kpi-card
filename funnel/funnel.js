'use strict';

/* ============================================================
   RCX Pipeline Funnel — viz extension logic
   Tiles (funnel.trex):
     stage  (dimension, required) -> pipeline stage names
     value  (measure, required)   -> count/amount per stage
   Funnel respects the order rows arrive in (sort the Stage field
   in pipeline order in Tableau). Shows count, % of top stage, and
   step-to-step conversion between stages.
   ============================================================ */

const CONFIG = {
  title: '',                 // '' = worksheet name
  showStepConversion: true,  // "↓ 57%" between stages
  showPctOfTop: true,        // "% of [first stage]" beside each bar
  autoSort: false,           // true = sort stages by value desc; false = keep Tableau's order
  useTableauFormat: true,    // bar value uses Tableau's field formatting
  minBarPct: 14,             // smallest bar width (% of full) so labels stay readable
  colorTop: '#7fb3e6',       // gradient: first stage
  colorBottom: '#2e5c9a'     // gradient: last stage
};

(function () {
  window.onload = tableau.extensions.initializeAsync().then(() => {
    const ws = tableau.extensions.worksheetContent.worksheet;
    ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, render);
    render();
  }, (err) => showError('Init failed (does the API library support viz extensions?): ' + err));

  function applySettings () {
    try {
      const s = tableau.extensions.settings.getAll();
      Object.keys(CONFIG).forEach(k => {
        if (s[k] === undefined) return;
        if (typeof CONFIG[k] === 'number') CONFIG[k] = parseFloat(s[k]);
        else if (typeof CONFIG[k] === 'boolean') CONFIG[k] = (s[k] === 'true');
        else CONFIG[k] = s[k];
      });
    } catch (e) {}
  }

  async function render () {
    try {
      applySettings();
      const ws = tableau.extensions.worksheetContent.worksheet;
      const enc = await getEncodingFields(ws);
      if (!enc.stage || !enc.value) { setEmpty(true); return; }

      const table = await getSummaryData(ws);
      if (!table || !table.columns.length) { setEmpty(true); return; }

      const sCol = matchColumn(table.columns, enc.stage);
      const vCol = matchColumn(table.columns, enc.value);
      if (sCol < 0 || vCol < 0) { setEmpty(true); return; }

      let stages = table.data.map(row => ({
        stage: label(row[sCol]),
        value: numeric(row[vCol]),
        display: (CONFIG.useTableauFormat && row[vCol] && row[vCol].formattedValue !== undefined)
                   ? row[vCol].formattedValue : Number(numeric(row[vCol])).toLocaleString()
      })).filter(s => s.stage !== '');

      if (CONFIG.autoSort) stages.sort((a, b) => b.value - a.value);
      if (!stages.length) { setEmpty(true); return; }

      setEmpty(false);
      paint(ws.name, stages);
    } catch (e) {
      showError('Render error: ' + (e && e.message ? e.message : e));
    }
  }

  /* ---------- Tableau helpers ---------- */
  async function getEncodingFields (ws) {
    const spec = await ws.getVisualSpecificationAsync();
    const out = {};
    if (!spec || !spec.marksSpecifications) return out;
    const marks = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    if (!marks) return out;
    for (const e of marks.encodings) if (e && e.field && e.id) out[e.id] = e.field.name;
    return out;
  }
  async function getSummaryData (ws) {
    const reader = await ws.getSummaryDataReaderAsync();
    let columns = [], data = [];
    for (let i = 0; i < reader.pageCount; i++) {
      const page = await reader.getPageAsync(i);
      if (i === 0) columns = page.columns;
      data = data.concat(page.data);
    }
    await reader.releaseAsync();
    return { columns, data };
  }
  function matchColumn (columns, name) {
    if (!name) return -1;
    const n = name.toLowerCase();
    let i = columns.findIndex(c => c.fieldName.toLowerCase() === n);
    if (i >= 0) return i;
    i = columns.findIndex(c => c.fieldName.toLowerCase().includes(n));
    if (i >= 0) return i;
    return columns.findIndex(c => n.includes(c.fieldName.toLowerCase()));
  }
  function numeric (dv) {
    if (!dv) return 0;
    const n = (dv.nativeValue !== undefined && dv.nativeValue !== null) ? dv.nativeValue : dv.value;
    const f = parseFloat(n); return isNaN(f) ? 0 : f;
  }
  function label (dv) {
    if (!dv) return '';
    return (dv.formattedValue !== undefined && dv.formattedValue !== null) ? String(dv.formattedValue)
         : String(dv.value !== undefined ? dv.value : '');
  }

  /* ---------- color gradient ---------- */
  function hexToRgb (h) { h = h.replace('#',''); return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
  function lerpColor (i, n) {
    const a = hexToRgb(CONFIG.colorTop), b = hexToRgb(CONFIG.colorBottom);
    const t = n <= 1 ? 0 : i / (n - 1);
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  /* ---------- render ---------- */
  function paint (wsName, stages) {
    document.getElementById('f-title').textContent = CONFIG.title || wsName;
    const body = document.getElementById('f-body');
    body.innerHTML = '';

    const entry = stages[0].value || 1;          // top stage = funnel entry
    const n = stages.length;

    stages.forEach((s, i) => {
      const wpct = clamp((s.value / entry) * 100, CONFIG.minBarPct, 100);

      const row = el('div', 'f-row');
      const bar = el('div', 'f-bar');
      bar.style.width = wpct + '%';
      bar.style.background = lerpColor(i, n);
      bar.innerHTML = `<span class="f-stage">${esc(s.stage)}</span>`;
      row.appendChild(bar);

      // Value (and optional % of top) sit OUTSIDE the bar so labels never
      // collide on narrow stages.
      const side = el('div', 'f-side');
      let sideTxt = s.display;
      if (CONFIG.showPctOfTop) {
        sideTxt += (i === 0) ? '  ·  100%'
                             : '  ·  ' + Math.round((s.value / entry) * 100) + '% of ' + stages[0].stage;
      }
      side.textContent = sideTxt;
      row.appendChild(side);

      body.appendChild(row);

      if (CONFIG.showStepConversion && i < n - 1) {
        const conv = el('div', 'f-conv');
        const stepPct = s.value ? Math.round((stages[i + 1].value / s.value) * 100) : 0;
        conv.innerHTML = `<span class="arrow">&#8595;</span> ${stepPct}% &nbsp;<span style="opacity:.7">(${esc(stages[i + 1].stage)})</span>`;
        body.appendChild(conv);
      }
    });
  }

  /* ---------- utils ---------- */
  function clamp (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function el (tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc (s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function setEmpty (e) {
    document.getElementById('card').classList.toggle('state-empty', e);
    document.getElementById('funnel').hidden = e;
  }
  function showError (msg) {
    setEmpty(true);
    const h = document.getElementById('hint'); if (h) h.textContent = msg;
    console.error('[RCX Funnel] ' + msg);
  }
})();
