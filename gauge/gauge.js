'use strict';

/* ============================================================
   RCX Target Gauge — viz extension logic
   ------------------------------------------------------------
   Tiles (from gauge.trex):
     actual  (required) -> needle position + center number
     target  (required) -> the 100% reference (forecast)

   The gauge arc spans 0 .. maxScalePct% of target. Red/yellow/green
   zones show pacing; the needle points at actual's % of target; a
   white tick marks 100% (on target). Defaults in CONFIG; any key can
   be overridden per worksheet via extension settings.
   ============================================================ */

const CONFIG = {
  title: '',              // '' = worksheet name
  maxScalePct: 150,       // arc covers 0%..150% of target
  redMaxPct: 80,          // below 80% of target = red zone
  yellowMaxPct: 100,      // 80%..100% = yellow, above = green
  higherIsBetter: true,   // false for "lower is better" (e.g. churn) -> colors invert
  useTableauFormat: true, // center number uses Tableau's field formatting
  showTargetValue: true,  // show "Target: X" under the percent
  subLabel: 'of target'
};

(function () {
  const cx = 100, cy = 104, rOut = 86, rIn = 70; // gauge geometry in viewBox units

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
      if (!enc.actual || !enc.target) { setEmpty(true); return; }

      const table = await getSummaryData(ws);
      if (!table || !table.columns.length) { setEmpty(true); return; }

      const aCol = matchColumn(table.columns, enc.actual);
      const tCol = matchColumn(table.columns, enc.target);
      if (aCol < 0 || tCol < 0) { setEmpty(true); return; }

      let actual = 0, target = 0, actualFmt = null, targetFmt = null;
      for (const row of table.data) {
        const ac = row[aCol], tc = row[tCol];
        actual += numeric(ac);
        target += numeric(tc);
        if (actualFmt === null && ac && ac.formattedValue !== undefined) actualFmt = ac.formattedValue;
        if (targetFmt === null && tc && tc.formattedValue !== undefined) targetFmt = tc.formattedValue;
      }

      const single = table.data.length === 1;
      const pct = (target !== 0) ? (actual / target) * 100 : null;

      setEmpty(false);
      paint({
        title: CONFIG.title || ws.name,
        actualDisplay: (CONFIG.useTableauFormat && single && actualFmt !== null) ? actualFmt : formatNumber(actual),
        targetDisplay: (CONFIG.useTableauFormat && single && targetFmt !== null) ? targetFmt : formatNumber(target),
        pct: pct
      });
    } catch (e) {
      showError('Render error: ' + (e && e.message ? e.message : e));
    }
  }

  /* ---------- Tableau data helpers ---------- */
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
    const f = parseFloat(n);
    return isNaN(f) ? 0 : f;
  }

  /* ---------- geometry ---------- */
  function polar (r, deg) {
    const a = deg * Math.PI / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  }
  function angleForFraction (f) { return 180 - clamp(f, 0, 1) * 180; }
  function clamp (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function sector (startDeg, endDeg) {
    const steps = Math.max(2, Math.round(Math.abs(startDeg - endDeg) / 3));
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(polar(rOut, startDeg + (endDeg - startDeg) * i / steps));
    for (let i = steps; i >= 0; i--) pts.push(polar(rIn, startDeg + (endDeg - startDeg) * i / steps));
    return 'M ' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ') + ' Z';
  }

  /* ---------- rendering ---------- */
  function paint (m) {
    document.getElementById('g-title').textContent = m.title;
    document.getElementById('g-value').textContent = m.actualDisplay;

    const svg = document.getElementById('g-svg');
    const max = CONFIG.maxScalePct;
    const b1 = CONFIG.redMaxPct / max;     // red/yellow boundary (fraction of arc)
    const b2 = CONFIG.yellowMaxPct / max;  // yellow/green boundary
    const colors = CONFIG.higherIsBetter
      ? ['var(--rcx-red)', 'var(--rcx-yellow)', 'var(--rcx-green)']
      : ['var(--rcx-green)', 'var(--rcx-yellow)', 'var(--rcx-red)'];

    let svgParts = '';
    // three colored zones
    [[0, b1], [b1, b2], [b2, 1]].forEach((rng, idx) => {
      svgParts += `<path d="${sector(angleForFraction(rng[0]), angleForFraction(rng[1]))}" fill="${colors[idx]}"/>`;
    });

    // target tick at 100% of target
    const tf = clamp(100 / max, 0, 1);
    const ta = angleForFraction(tf);
    const t1 = polar(rIn - 3, ta), t2 = polar(rOut + 4, ta);
    svgParts += `<line x1="${t1[0].toFixed(2)}" y1="${t1[1].toFixed(2)}" x2="${t2[0].toFixed(2)}" y2="${t2[1].toFixed(2)}" stroke="var(--rcx-target)" stroke-width="2.5"/>`;

    // needle at actual
    if (m.pct !== null) {
      const f = clamp(m.pct / max, 0, 1);
      const na = angleForFraction(f);
      const tip = polar(rOut - 4, na);
      const bL = polar(7, na + 90), bR = polar(7, na - 90);
      svgParts += `<polygon points="${bL[0].toFixed(2)},${bL[1].toFixed(2)} ${tip[0].toFixed(2)},${tip[1].toFixed(2)} ${bR[0].toFixed(2)},${bR[1].toFixed(2)}" fill="var(--rcx-needle)"/>`;
      svgParts += `<circle cx="${cx}" cy="${cy}" r="7" fill="var(--rcx-needle)"/>`;
    }
    svg.innerHTML = svgParts;

    // sub line: "94% of target  ·  Target: 1,560"
    const sub = document.getElementById('g-sub');
    if (m.pct === null) {
      sub.innerHTML = '<span class="pct">no target</span>';
    } else {
      const zone = zoneClass(m.pct);
      let html = `<span class="pct ${zone}">${Math.round(m.pct)}%</span> ${escapeHtml(CONFIG.subLabel)}`;
      if (CONFIG.showTargetValue) html += `  ·  Target: ${escapeHtml(m.targetDisplay)}`;
      sub.innerHTML = html;
    }
  }

  function zoneClass (pct) {
    const below = pct < CONFIG.redMaxPct, mid = pct < CONFIG.yellowMaxPct;
    if (CONFIG.higherIsBetter) return below ? 'red' : (mid ? 'yellow' : 'green');
    return below ? 'green' : (mid ? 'yellow' : 'red');
  }

  function formatNumber (n) { return Number(n).toLocaleString(); }
  function escapeHtml (s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function setEmpty (e) {
    document.getElementById('card').classList.toggle('state-empty', e);
    document.getElementById('gauge').hidden = e;
  }
  function showError (msg) {
    setEmpty(true);
    const h = document.getElementById('hint'); if (h) h.textContent = msg;
    console.error('[RCX Gauge] ' + msg);
  }
})();
