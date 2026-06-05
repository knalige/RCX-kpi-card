'use strict';

/* ============================================================
   RCX KPI Card — viz extension logic
   ------------------------------------------------------------
   How it works:
   - The .trex defines three encoding tiles on the Marks card:
       value       (required) -> the big number
       comparison  (optional) -> prior-period value, drives the delta
       trend       (optional) -> a date/dimension, drives the sparkline
   - On any data change we read the worksheet summary data, map the
     encoding fields to their data columns, compute the number / delta /
     series, and render.

   Reusability:
   - Drop ANY measure on "Value" and the card renders that measure.
   - Defaults live in CONFIG below. Any of them can be overridden per
     worksheet instance via extension settings (key = same name as in
     CONFIG), e.g. tableau.extensions.settings.set('title', 'YTD ...').
   ============================================================ */

const CONFIG = {
  title: '',            // '' = use the worksheet name as the title
  subtitle: '',         // e.g. '2026'. '' = hidden
  decimals: 0,          // decimal places for the big number
  prefix: '',           // e.g. '$'
  suffix: '',           // e.g. '%'
  comparisonSuffix: 'vs Last Year',
  showSparkline: true,
  // When true, the big number uses Tableau's own field formatting (percent,
  // currency, decimals) for single-value cards. Set false to always use the
  // prefix/suffix/decimals below instead.
  useTableauFormat: true,
  // higher = the delta is "good" when it goes up (green up / red down).
  // set false for metrics where lower is better (green down / red up).
  upIsGood: true
};

(function () {
  // --- bootstrap -------------------------------------------------------
  window.onload = tableau.extensions.initializeAsync().then(() => {
    const worksheet = tableau.extensions.worksheetContent.worksheet;

    // Re-render whenever the data behind the worksheet changes
    // (adding/removing fields, filtering, parameter changes, etc.).
    worksheet.addEventListener(
      tableau.TableauEventType.SummaryDataChanged,
      render
    );

    render();
  }, (err) => {
    showError('Could not initialize. Make sure the Extensions API library '
      + 'supports viz extensions (worksheet-extension). Details: ' + err);
  });

  // --- settings overrides ---------------------------------------------
  function applySettingsOverrides () {
    try {
      const s = tableau.extensions.settings.getAll();
      Object.keys(CONFIG).forEach((k) => {
        if (s[k] === undefined) return;
        if (typeof CONFIG[k] === 'number') CONFIG[k] = parseFloat(s[k]);
        else if (typeof CONFIG[k] === 'boolean') CONFIG[k] = (s[k] === 'true');
        else CONFIG[k] = s[k];
      });
    } catch (e) { /* settings not available — fine, use defaults */ }
  }

  // --- main render -----------------------------------------------------
  async function render () {
    try {
      applySettingsOverrides();
      const worksheet = tableau.extensions.worksheetContent.worksheet;

      // 1) Which field is on each encoding tile?
      const encMap = await getEncodingFields(worksheet); // {value, comparison, trend}

      if (!encMap.value) {
        setEmpty(true);
        return;
      }

      // 2) Pull the worksheet summary data.
      const table = await getSummaryData(worksheet);
      if (!table || table.columns.length === 0) { setEmpty(true); return; }

      // 3) Map each encoding's field name to a data column index (tolerant).
      const valueCol = matchColumn(table.columns, encMap.value);
      const compCol  = encMap.comparison ? matchColumn(table.columns, encMap.comparison) : -1;
      const trendCol = encMap.trend ? matchColumn(table.columns, encMap.trend) : -1;
      // Optional separate measure for the line height (decoupled from Value).
      const trendValueCol = encMap.trendvalue ? matchColumn(table.columns, encMap.trendvalue) : -1;

      if (valueCol < 0) { setEmpty(true); return; }

      // 4) Aggregate down the rows.
      let total = 0, compTotal = 0;
      let valueFormatted = null;   // Tableau's own formatted string (e.g. "85%", "$1,800")
      const series = []; // {key, val} for sparkline
      for (const row of table.data) {
        const cell = row[valueCol];
        const v = numeric(cell);
        total += v;
        if (valueFormatted === null && cell && cell.formattedValue !== undefined) {
          valueFormatted = cell.formattedValue;
        }
        if (compCol >= 0) compTotal += numeric(row[compCol]);
        if (trendCol >= 0) {
          // Line height comes from the dedicated trend measure if provided,
          // otherwise it falls back to the Value field (old behavior).
          const lineVal = trendValueCol >= 0 ? numeric(row[trendValueCol]) : v;
          series.push({ key: sortKey(row[trendCol]), val: lineVal });
        }
      }

      // Prefer Tableau's own formatting (percent, currency, decimals) for the big
      // number. Only safe when there's a single value — with a Trend date the
      // value is split across rows, so we fall back to JS formatting of the sum.
      const useTableauFmt = CONFIG.useTableauFormat && trendCol < 0 && valueFormatted !== null;
      const valueDisplay = useTableauFmt ? valueFormatted : formatNumber(total);

      // 5) Compute the delta.
      const hasComparison = compCol >= 0;
      const diff = total - compTotal;
      const pct = (hasComparison && compTotal !== 0) ? (diff / compTotal) : null;

      // 6) Render everything.
      setEmpty(false);
      paint({
        title: CONFIG.title || worksheet.name,
        subtitle: CONFIG.subtitle,
        valueDisplay: valueDisplay,
        hasComparison,
        diff,
        pct,
        series: series.sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0))
      });

      await safeRelease(worksheet);
    } catch (e) {
      showError('Render error: ' + (e && e.message ? e.message : e));
    }
  }

  // --- Tableau data helpers -------------------------------------------

  // Returns { value, comparison, trend } -> field name string (or undefined)
  async function getEncodingFields (worksheet) {
    const spec = await worksheet.getVisualSpecificationAsync();
    const result = {};
    if (!spec || !spec.marksSpecifications) return result;
    const marks = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    if (!marks) return result;
    for (const enc of marks.encodings) {
      if (enc && enc.field && enc.id) {
        result[enc.id] = enc.field.name;
      }
    }
    return result;
  }

  // Pages through getSummaryDataReaderAsync and returns a single combined
  // { columns:[{fieldName,index}], data:[[DataValue,...]] }.
  async function getSummaryData (worksheet) {
    const reader = await worksheet.getSummaryDataReaderAsync();
    const pages = reader.pageCount;
    let columns = [];
    let data = [];
    for (let i = 0; i < pages; i++) {
      const page = await reader.getPageAsync(i);
      if (i === 0) columns = page.columns;
      data = data.concat(page.data);
    }
    await reader.releaseAsync();
    return { columns, data };
  }

  // Tolerant match of an encoding field name to a summary-data column.
  // Measures often show up aggregated, e.g. encoding "Total Participation"
  // -> column "SUM(Total Participation)", so we try exact, then contains.
  function matchColumn (columns, fieldName) {
    if (!fieldName) return -1;
    const fn = fieldName.toLowerCase();
    let idx = columns.findIndex(c => c.fieldName.toLowerCase() === fn);
    if (idx >= 0) return idx;
    idx = columns.findIndex(c => c.fieldName.toLowerCase().includes(fn));
    if (idx >= 0) return idx;
    idx = columns.findIndex(c => fn.includes(c.fieldName.toLowerCase()));
    return idx; // -1 if nothing matched
  }

  function numeric (dataValue) {
    if (!dataValue) return 0;
    const n = (dataValue.nativeValue !== undefined && dataValue.nativeValue !== null)
      ? dataValue.nativeValue : dataValue.value;
    const f = parseFloat(n);
    return isNaN(f) ? 0 : f;
  }

  function sortKey (dataValue) {
    if (!dataValue) return '';
    const n = (dataValue.nativeValue !== undefined && dataValue.nativeValue !== null)
      ? dataValue.nativeValue : dataValue.value;
    // Dates arrive as ISO-ish strings or Date objects; both sort fine as-is.
    return n;
  }

  async function safeRelease () { /* reader already released in getSummaryData */ }

  // --- rendering -------------------------------------------------------
  function paint (m) {
    const card = document.getElementById('card');

    document.getElementById('kpi-title').textContent = m.title;

    const sub = document.getElementById('kpi-subtitle');
    sub.textContent = m.subtitle || '';
    sub.style.display = m.subtitle ? 'block' : 'none';

    document.getElementById('kpi-value').textContent = m.valueDisplay;

    // Delta line
    const delta = document.getElementById('kpi-delta');
    if (m.hasComparison) {
      delta.hidden = false;
      const positive = m.diff >= 0;
      const good = CONFIG.upIsGood ? positive : !positive;
      delta.classList.toggle('up', good);
      delta.classList.toggle('down', !good);

      document.getElementById('delta-arrow').textContent = positive ? '▲' : '▼';
      document.getElementById('delta-abs').textContent =
        (positive ? '+' : '−') + formatNumber(Math.abs(m.diff));
      const pctEl = document.getElementById('delta-pct');
      if (m.pct === null) {
        pctEl.textContent = '';
      } else {
        pctEl.textContent = '(' + (positive ? '+' : '−')
          + Math.abs(m.pct * 100).toFixed(0) + '%)';
      }
      document.getElementById('delta-suffix').textContent = CONFIG.comparisonSuffix || '';
    } else {
      delta.hidden = true;
    }

    // Sparkline
    drawSparkline(m.series);

    // Fit the big number to the card so it never clips.
    fitValue(card);
  }

  function formatNumber (n) {
    const opts = { minimumFractionDigits: CONFIG.decimals, maximumFractionDigits: CONFIG.decimals };
    return CONFIG.prefix + Number(n).toLocaleString(undefined, opts) + CONFIG.suffix;
  }

  function drawSparkline (series) {
    const svg = document.getElementById('sparkline');
    if (!CONFIG.showSparkline || !series || series.length < 2) {
      svg.hidden = true;
      svg.innerHTML = '';
      return;
    }
    svg.hidden = false;

    const W = 100, H = 100; // viewBox units; SVG scales to the card via preserveAspectRatio
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const vals = series.map(s => s.val);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const stepX = W / (series.length - 1);

    let line = '';
    series.forEach((s, i) => {
      const x = i * stepX;
      const y = H - ((s.val - min) / range) * (H * 0.9) - H * 0.05;
      line += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    });
    const area = line + `L ${W} ${H} L 0 ${H} Z`;

    svg.innerHTML =
      `<path d="${area}" fill="var(--rcx-spark)" fill-opacity="var(--rcx-spark-fill-opacity)" stroke="none"/>` +
      `<path d="${line.trim()}" fill="none" stroke="var(--rcx-spark)" stroke-width="1.5" ` +
      `vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Shrinks/grows the big number so it fits the card width.
  function fitValue (card) {
    const valueEl = document.getElementById('kpi-value');
    const avail = card.clientWidth - 32;
    let size = 48;
    valueEl.style.setProperty('--rcx-value-size', size + 'px');
    valueEl.style.fontSize = size + 'px';
    while (valueEl.scrollWidth > avail && size > 16) {
      size -= 2;
      valueEl.style.fontSize = size + 'px';
    }
  }

  // --- state helpers ---------------------------------------------------
  function setEmpty (isEmpty) {
    const card = document.getElementById('card');
    const kpi = document.getElementById('kpi');
    card.classList.toggle('state-empty', isEmpty);
    kpi.hidden = isEmpty;
  }

  function showError (msg) {
    setEmpty(true);
    const hint = document.getElementById('hint');
    if (hint) hint.textContent = msg;
    // Also log for the browser console / Tableau debugging.
    // eslint-disable-next-line no-console
    console.error('[RCX KPI Card] ' + msg);
  }

  // Re-fit on resize so the number stays crisp when the card is resized.
  window.addEventListener('resize', () => {
    const card = document.getElementById('card');
    if (card && !card.classList.contains('state-empty')) fitValue(card);
  });
})();
