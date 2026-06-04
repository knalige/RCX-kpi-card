# RCX KPI Card — Tableau Viz Extension

A free, self-hosted viz extension that turns any worksheet into a KPI card:
a big number, a green/red year-over-year delta, and a background sparkline.
It's a **viz extension**, so it appears as a new mark type on the **Marks card**.
Drop any measure on the **Value** tile and it renders — fully reusable across measures.

```
rcx-kpi-card/
├── kpi-card.trex      ← manifest (you edit the URL in here)
├── index.html         ← the page Tableau loads
├── kpi-card.js         ← logic (reads encodings + summary data, renders)
├── style.css           ← navy RCX theme
└── tableau.extensions.1.latest.js   ← (you add this — see step 1)
```

---

## 1. Add the Tableau Extensions API library

The one file not included here is the Tableau API library, because it must be a
recent build that supports **viz** extensions (`worksheet-extension`).

1. Download/clone the Extensions API SDK: https://github.com/tableau/extensions-api
2. Copy `lib/tableau.extensions.1.latest.js` from that repo into this folder,
   next to `index.html`.

(That filename is exactly what `index.html` references.)

## 2. Put it on GitHub Pages (free HTTPS hosting)

1. Create a new GitHub repo, e.g. `rcx-kpi-card`.
2. Upload all files in this folder (including the library from step 1) to the repo root.
3. Repo **Settings → Pages** → Source = `Deploy from a branch`, Branch = `main` / `/root`. Save.
4. After a minute, your site is live at:
   `https://YOURUSER.github.io/rcx-kpi-card/index.html`
5. Open that URL in a browser to confirm it loads (you'll see the "Drag a measure…" hint).

## 3. Point the manifest at your URL

Open `kpi-card.trex` and replace the `<source-location>` URL with your real one:

```xml
<source-location>
  <url>https://YOURUSER.github.io/rcx-kpi-card/index.html</url>
</source-location>
```

> If you ever edit the `.trex` after adding it in Tableau, remove the extension
> from the worksheet and re-add it — Tableau only parses the manifest on add.

## 4. Safelist it in Tableau Cloud (site admin)

Same place you allow-listed the LaDataViz extension:

1. Sign into the **RCX Sports Analytics** site (not Cloud Manager).
2. **Settings → Extensions → Dashboard and Viz Extensions**.
3. Add your URL (`https://YOURUSER.github.io/rcx-kpi-card/index.html`) to the safe list.
4. Grant **Full Data** access (the card needs to read the worksheet's summary data).

## 5. Use it on a worksheet

1. Open a worksheet. On the **Marks** card, open the **Mark Type** dropdown.
2. Under **Viz Extensions**, choose **Add Extension** → select **RCX KPI Card**
   (or "Access Local Extensions" while testing with a local server).
3. Drag fields onto the encoding tiles that appear on the Marks card:
   - **Value** (required): your measure, e.g. `YTD This Year` → the big number.
   - **Comparison** (optional): the prior-period measure, e.g. `YTD Last Year`
     → drives the green/red delta and percentage.
   - **Trend** (optional): a date/dimension (e.g. `MONTH(Order Placed Date)`)
     → draws the background sparkline.

---

## Customizing (the "reusable" part)

Two ways to change behavior:

**A. Defaults — edit the `CONFIG` block at the top of `kpi-card.js`:**

| Key                | What it does                                              |
|--------------------|----------------------------------------------------------|
| `title`            | `''` uses the worksheet name; otherwise this text        |
| `subtitle`         | e.g. `'2026'`; `''` hides it                              |
| `decimals`         | decimal places on the big number                         |
| `prefix` / `suffix`| e.g. `'$'` / `'%'`                                        |
| `comparisonSuffix` | trailing text on the delta, default `vs Last Year`       |
| `showSparkline`    | `true` / `false`                                         |
| `upIsGood`         | `true` = up is green; set `false` for "lower is better"  |

**B. Per-worksheet — extension settings.** Any CONFIG key can be overridden for a
single instance via the settings API, so the *same* hosted extension can show
different titles/formats on different cards. From the browser console while the
extension is focused, or from a small config script:

```js
tableau.extensions.settings.set('title', 'YTD Avg. Participation');
tableau.extensions.settings.set('upIsGood', 'false');
await tableau.extensions.settings.saveAsync();
```

## Theme

All colors live as CSS variables at the top of `style.css`
(`--rcx-bg`, `--rcx-value`, `--rcx-up`, `--rcx-down`, `--rcx-spark`, …).
Change them once to retheme every card.

## Notes & limitations

- **Field-name matching**: the code maps each encoding's field to its summary-data
  column by exact name, then by "contains" (so `Total Participation` matches
  `SUM(Total Participation)`). If your field names are unusual and a card shows the
  wrong number, that matcher in `matchColumn()` is the place to adjust.
- **Number formatting** is done in JS (`toLocaleString`). If you'd rather inherit
  Tableau's exact field format, read `formattedValue` from the data cell instead of
  `nativeValue` in `numeric()` — note you then can't sum across a trend.
- Built against Extensions API viz support (`min-api-version 1.12`). If "Viz
  Extensions" doesn't appear in the Mark Type menu, your Tableau Cloud version may
  predate viz extensions — confirm the site is current.
