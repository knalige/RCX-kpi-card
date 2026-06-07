# RCX Pipeline Funnel — Tableau Viz Extension

A funnel chart for a sales pipeline: ordered stages drawn as centered, tapering bars,
each labeled with its count, its **% of the top stage**, and the **step-to-step
conversion** to the next stage. Built to match the RCX KPI card / gauge and reuse the
same hosting pipeline.

## Files
```
rcx-funnel/
├── funnel.trex     ← manifest (edit <url> if hosted elsewhere)
├── index.html
├── funnel.js
├── style.css
└── tableau.extensions.1.latest.js   ← included
```

## Hosting (reuse your existing repo)
Drop this folder into your `RCX-kpi-card` repo as a subfolder named `funnel`, served at:

`https://knalige.github.io/RCX-kpi-card/funnel/index.html`

That URL is already the default in `funnel.trex`. Open it in a browser to confirm it loads.

## Safelist (site admin)
Add the URL to **Settings → Extensions**, Full Data = No, User Prompts = Hide. A wildcard
`https://knalige.github.io/RCX-kpi-card/.*` covers the KPI card, gauge, and funnel in one entry.

## Build the pipeline data, then use it
Your stages are Lead → Opp → Closed Won → Onboarding → Active LO. The extension needs them
as **one Stage field** (one row per stage) plus a **count**. Two common ways to get that:

- If you already have a single stage field, use it directly.
- If each stage is a separate count (calc), reshape into a stage/value pair — e.g. a small
  pivot, or a `Measure Names`/`Measure Values` setup, so each stage is one row.

Then:
1. Marks → Mark Type → **Viz Extensions → Add Extension → RCX Pipeline Funnel**.
2. Drop the **Stage** dimension on the Stage tile and the **count** measure on Value.
3. **Sort the Stage field in pipeline order** (Lead first) — the funnel renders in the
   order Tableau sends the rows. (Or set `autoSort:true` to sort by value descending.)

## Customizing — `CONFIG` at the top of `funnel.js`
| Key | Meaning |
|-----|---------|
| `title` | `''` = worksheet name |
| `showStepConversion` | show "↓ 57% (next stage)" between bars |
| `showPctOfTop` | show "% of [first stage]" beside each bar |
| `autoSort` | `true` = sort stages by value desc; `false` = keep Tableau's sort |
| `useTableauFormat` | bar value uses Tableau's field formatting |
| `minBarPct` | smallest bar width so labels stay readable |
| `colorTop` / `colorBottom` | gradient endpoints across the stages |

Any key can be overridden per worksheet via the settings API.

## Notes
- The top stage defines the funnel's full width and the "% of top" baseline.
- Step conversion for a stage = next stage value ÷ this stage value.
- Re-editing the `.trex` requires removing and re-adding the extension in Tableau.
