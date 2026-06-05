# RCX Target Gauge — Tableau Viz Extension

A radial gauge that shows **actual vs target (forecast)** with red/yellow/green
pacing zones, a needle at the actual value, and a tick at the 100% (on-target) mark.
Built to match the RCX KPI card and reuse the same hosting pipeline.

## Files
```
rcx-gauge/
├── gauge.trex     ← manifest (edit the <url> to your host)
├── index.html
├── gauge.js
├── style.css
└── tableau.extensions.1.latest.js   ← included
```

## Hosting (reuse your existing repo)
Easiest path: drop this whole folder into your existing `RCX-kpi-card` repo as a
subfolder named `gauge`, so it's served at:

`https://knalige.github.io/RCX-kpi-card/gauge/index.html`

That URL is already set as the default in `gauge.trex`. If you host it somewhere
else, edit the `<source-location><url>` line to match.

Open the URL in a browser to confirm it loads (you'll see the "Drop your measure…" hint).

## Safelist (site admin)
Add the gauge URL to your site's **Settings → Extensions** safe list, **Full Data = No**
(it only reads summary data), and set **User Prompts → Hide**. Match the URL exactly,
including the capital `RCX`. A wildcard like `https://knalige.github.io/RCX-kpi-card/.*`
will cover both the KPI card and the gauge in one entry.

## Use it on a worksheet
1. Marks card → Mark Type dropdown → **Viz Extensions → Add Extension** → pick **RCX Target Gauge**
   (or Access Local Extensions → the `gauge.trex` on your PC).
2. Drop fields on the tiles:
   - **Actual** → your measure (e.g. `YTD This Year`, active LOs, participation).
   - **Target (forecast)** → your forecast measure for the same period.
3. The needle points to actual's % of target; 100% is marked with a white tick.

## Customizing — `CONFIG` at the top of `gauge.js`
| Key | Meaning |
|-----|---------|
| `title` | `''` = worksheet name |
| `maxScalePct` | arc spans 0..this % of target (default 150) |
| `redMaxPct` / `yellowMaxPct` | zone boundaries in % of target (default 80 / 100) |
| `higherIsBetter` | `true` = up is green; set `false` for "lower is better" (e.g. churn) — colors invert |
| `useTableauFormat` | center number inherits Tableau's field format (percent/currency) |
| `showTargetValue` | show "Target: X" under the percent |
| `subLabel` | text after the percent, default "of target" |

Any key can also be overridden per worksheet via the settings API
(`tableau.extensions.settings.set('higherIsBetter','false')` then `saveAsync()`).

Colors live as CSS variables in `style.css` (`--rcx-red`, `--rcx-yellow`,
`--rcx-green`, `--rcx-needle`, etc.) — change once to retheme.

## Notes
- **Additive measures** (SUM) work directly. For a ratio actual/target where each is
  itself non-additive, put both as their aggregate measures and the gauge divides the
  two totals — correct for most actual-vs-forecast cases.
- Re-editing the `.trex` requires removing and re-adding the extension in Tableau.
