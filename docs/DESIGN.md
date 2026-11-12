# Tokenscope design guide

## 1. What this is and how to use it

The visual system lives in four files under `src/Tokenscope/ui/design/` plus this guide:

| File | Use it for |
|---|---|
| `tokens.css` | The only place raw values live (colours for both themes, type, spacing, radii, shadows, blur, motion, layers). Each token has a "use when" comment. |
| `components.css` | One commented block per component: purpose, anatomy, modifiers, states. Built from tokens only. |
| `gallery.html` | Every component in every state, light and dark, with markup to copy. Open it in the dev preview. |
| `docs/DESIGN.md` | This index: rules, which token or component to pick, motion, recipes. |

Rule of thumb: **tokens → components → gallery → this guide.** The CSS files are the source of values; this guide names tokens and never restates their numbers. If this guide and the CSS disagree, the CSS wins. Fix the guide.

## 2. Principles

- **Grouped background, floating cards.** The page is `--color-bg-grouped`; all content sits in `ts-card` or `ts-list` surfaces (`--color-bg`) with `--radius-lg` corners. In light, depth comes from `--shadow-card`. In dark, `--shadow-card` is `none` and the lighter surface does the work.
- **No hard borders.** Separate things with space, a surface change, or a `--color-separator` hairline (inset rows, table rules, chart grid). Never draw a box around something.
- **One tint.** `--color-tint` is the only accent: links, plain and tinted buttons, selection, focus. Status colours (`--color-positive`, `--color-negative`, `--color-warning`) carry meaning only. Agents use the `--cat-*` palette.
- **Depth by material, elevation and motion.** Use translucent materials with backdrop blur for chrome (sidebar, top bar, tooltip). Raised things (sheet, popover, segmented thumb) are `--color-bg-2` with their own shadow token. Use the `--z-*` tokens for layering.
- **Generous spacing on a 4 px grid.** Use the `--space-*` scale only. Cards are padded with `--space-5`, sections are separated by `--space-6`, and screens have `--space-7` side padding.
- **Figures are tabular.** `html` sets `font-variant-numeric: tabular-nums`; never turn it off. Big numbers use `--text-large-title` with `--tracking-tight`.
- **Calm motion.** Springs without overshoot for everything except rare celebratory accents. Animate only transform/opacity/filter. Under reduced motion everything becomes a short fade.

## 3. Hard rules (enforced by `tests/design.test.mjs`)

| Rule | Why | Fix |
|---|---|---|
| No raw colour outside `tokens.css`: no hex, `rgb()`/`rgba()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color-mix()` in any ui `.css`, `.js` or `.html`; no named colours (`white`, `red`…) in CSS values or as JS string literals. | Theming: a literal does not switch with dark mode and bypasses the contrast check. | Reuse a token, or add one to `tokens.css` (both themes). `color-mix()` counts too, so a derived shade needs its own token. |
| Every `.ts-*` class in `components.css` appears in `gallery.html`. | The gallery is the visual regression check and the copy source. | Add a gallery example for the new class (in every state). |
| Every `var()` name in CSS (ui `.css` files and `<style>` blocks) is defined in `tokens.css` or in the same file. | A typo'd token silently falls back to nothing. | Fix the name, or define it. Component-private properties start with `--_` and live in their component. |
| Themed tokens (`--color-*`, `--cat-*`, `--heat-*`, `--shadow-*`) exist in the light `:root`. If the light value is raw, they also need a dark value. The two dark blocks must be identical, and no token may exist only in dark. | Both themes must always be complete. | Add the token to `:root` and to **both** dark blocks with the same value. A token derived only from other tokens (`var()`/`color-mix()` of tokens) needs no dark value. |
| No `innerHTML`, `outerHTML` or `insertAdjacentHTML` anywhere in ui `.js`/`.html`, even in a comment. | Project names, model names and stderr come from disk and are untrusted. | Build DOM with `h()`/`svg()` from `dom.js` (string children become text nodes). |
| `transition`/`transition-property` and `@keyframes` may only name `transform`, `translate`, `scale`, `rotate`, `opacity`, `filter`. | Compositor-only animation stays smooth. Layout properties drop frames. | Animate `scale`/`translate` instead of size or position. For colour changes, fade an overlay (see Motion). Always write the property first (`transition: scale var(--spring-snappy)`), never `all` or a bare token. |

Run: `node --test "tests/*.test.mjs"`.

## 4. Token index

Names only. Values and exact comments are in `tokens.css`.

### Colour roles

| Token | Use when |
|---|---|
| `--color-label` | Primary text, figures, titles |
| `--color-label-2` | Secondary text: subtitles, card titles, axis labels, list headers |
| `--color-label-3` | Tertiary: placeholders, chevrons, captions under captions |
| `--color-bg-grouped` | Page background behind cards and grouped lists |
| `--color-bg` | Card / list / table surface |
| `--color-bg-2` | Raised surface above a card: sheet, popover, segmented thumb, select options |
| `--color-fill` | Recessed well: switch off, progress track, sheet grabber, pressed rows, nav pill |
| `--color-fill-2` | Lighter well: fields, segmented track, neutral chips/badges, skeletons, table row hover |
| `--color-separator` | Hairlines between rows, table rules, chart grid and axis |
| `--color-hover` | Hover overlay on any surface or filled control |
| `--color-material` / `--color-material-thick` | Translucent bar (top bar, tooltip) / sidebar, always paired with a `--blur-*` |
| `--color-scrim` | Dimmed backdrop behind a sheet |
| `--color-shimmer` | Moving highlight inside skeletons |
| `--color-on-accent` | Glyphs on coloured icon tiles; switch thumb |
| `--color-tint` / `--color-tint-contrast` | The accent for text, icons and strokes on surfaces / text on a solid `--color-tint` area (rare) |
| `--color-tint-fill` / `--color-tint-fill-contrast` | Vivid blue behind filled controls (primary button, selected chip, default icon tile) / its white label (AA in both themes) |
| `--color-positive` / `--color-negative` / `--color-warning` | Good news (cost down, switch on) / bad news (cost up, errors, over limit) / caution (unpriced, nearing limit) |
| `--color-tint-soft`, `--color-positive-soft`, `--color-negative-soft`, `--color-warning-soft` | Backgrounds of tinted buttons, selected chips, badges, banners. Derived, so they follow the theme |
| `--color-focus` | `:focus-visible` ring (set globally; do not restyle) |

Which one do I pick?
- **Label levels:** content the user reads → `--color-label`; describes content → `--color-label-2`; hint or decoration → `--color-label-3`. Never put coloured text on a fill well. Coloured text goes on a background or its own `*-soft`.
- **Background levels:** page → `--color-bg-grouped`; a card or list on the page → `--color-bg`; something floating above a card → `--color-bg-2`.
- **Fill levels:** a track or well that must read clearly (switch off, progress, pressed) → `--color-fill`; a soft input or neutral pill → `--color-fill-2`. A pointer hover → `--color-hover` overlay, never a fill swap.

### Agent palette, heat ramp

| Token | Use when |
|---|---|
| `--cat-1` … `--cat-8` | One per agent/source, assigned in order and never reordered: `--cat-1` Claude, `--cat-2` Codex, `--cat-3`–`--cat-7` further sources, `--cat-8` "other". Colour-blind-safe set. |
| `--heat-0` … `--heat-4` | Heatmap levels from no usage to highest. Use through `.ts-chart-cell[data-level]`, not directly. |

### Type

| Token | Use when |
|---|---|
| `--text-large-title` | Screen title; big stat figures |
| `--text-title-1` | Sheet title; hero numbers in a panel |
| `--text-title-2` | Section headings inside a screen |
| `--text-title-3` | Sidebar app name; empty-state title; sheet header |
| `--text-headline` | Emphasised body: leading row titles, banner title, selected nav item |
| `--text-body` | Default reading text, nav labels |
| `--text-callout` | Row titles in dense lists, field text |
| `--text-subhead` | Buttons, table cells, card headers |
| `--text-footnote` | Secondary lines, list headers, chips |
| `--text-caption` | Badges, axis labels, tooltip fine print |
| `--tracking-tight` / `--tracking-snug` | Letter-spacing for large-title, title-1 and figures / title-2 and title-3 |
| `--font-sans` / `--font-mono` | All UI text / ids, stderr, code |

The `--text-*` tokens are `font` shorthands: write `font: var(--text-footnote)`, then override `font-weight` after it if needed.

### Spacing, radii, sizes

| Token | Use when |
|---|---|
| `--space-1` | Icon-to-text inside a chip or badge |
| `--space-2` | Between related controls |
| `--space-3` | Icon to label in rows; inner padding of small controls |
| `--space-4` | Row padding; gap between cards in a grid |
| `--space-5` | Card padding |
| `--space-6` | Between sections of a screen |
| `--space-7` | Screen side padding; space above a large title |
| `--space-8` | Empty-state breathing room; large-title collapse distance |
| `--radius-sm` | Icon tiles, bar tops, skeleton lines |
| `--radius-md` | Fields, non-pill buttons, banners, tooltips, nav pill |
| `--radius-lg` | Cards, grouped lists, tables |
| `--radius-xl` | Sheet top corners |
| `--radius-pill` | Buttons, chips, badges, switches, progress |

Fixed sizes (`--hairline`, `--size-row`, `--size-control`, `--size-tile`, `--size-icon`, `--size-dot`, `--size-line`, `--size-sidebar`, `--size-topbar`, `--size-pane-narrow`, `--size-content-max`, `--size-sheet-max`, `--size-tooltip-max` and the switch, grabber, focus and banner sizes) are listed with comments in `tokens.css`. Use `--size-row` as the minimum height of anything clickable in a list and `--size-control` for buttons and fields.

### Shadows, materials, layers

| Token | Use when |
|---|---|
| `--shadow-card` | Cards, grouped lists, banners (`none` in dark) |
| `--shadow-sheet` | Bottom sheet panel |
| `--shadow-popover` | Tooltip, popover, segmented thumb, switch thumb |
| `--blur-bar` | Top bar, tooltip (with `--color-material`) |
| `--blur-sidebar` | Sidebar (with `--color-material-thick`) |
| `--blur-sheet` | Backdrop behind a sheet (with `--color-scrim`) |
| `--z-bar` / `--z-sheet` / `--z-tooltip` | Sticky top bar and headers / sheet and backdrop / tooltips above everything |

### Motion

| Token | Use when |
|---|---|
| `--spring-snappy` | Controls: thumbs, switches, presses, pills, tooltip glide. No overshoot |
| `--spring-smooth` | Screens, sheets, entrances, chart draw-in, progress fill |
| `--spring-bouncy` | Celebratory accents only (slight overshoot). Rare |
| `--dur-fast` | Hover overlays, colour cross-fades (with `ease-out`); every reduced-motion fade |
| `--dur-base` | Opacity fade of popovers and tooltips |
| `--dur-slow` | One skeleton shimmer sweep |
| `--stagger-step` | Delay per item in a staggered entrance (index capped at 12) |
| `--press-scale` | Scale of a pressed control or card |
| `--rise` | Entrance travel distance |
| `--opacity-pressed` / `--opacity-disabled` / `--opacity-dimmed` / `--opacity-area` | Pressed control / disabled control / non-hovered chart marks / fill under a chart line |

Which spring? If the user's pointer caused it and it is small (a control), use `--spring-snappy`. If content moves or appears (a screen, sheet, list, chart), use `--spring-smooth`. Use `--spring-bouncy` only for a one-off moment of delight, never for routine UI. Springs are `<duration> <easing>` pairs: `transition: translate var(--spring-smooth)`.

## 5. Component index

Conventions (from the `components.css` header): prefix `ts-`; parts are `ts-<component>-<part>`; modifiers `ts-<component>--<name>`. State comes from native attributes (`:checked`, `:disabled`, `aria-current`, `aria-pressed`, `aria-sort`, `aria-expanded`, `aria-invalid`, `data-open`, `data-active`). There are no `is-*` classes. Public knobs (`--tile`, `--dot`, `--series`, `--value`, `--i`) are custom properties set inline. Copy full markup from `gallery.html`.

**Base** (no class): `html` sets font, colours, tabular figures, focus ring and thin scrollbars. Do not restyle these per screen.

**`ts-enter`**: fade and rise when an element is inserted (cards, rows). Runs on insertion via `@starting-style`, no JS. Knob `--i` = stagger index (capped at 12); `stagger(parentEl)` in `dom.js` sets it.
```html
<article class="ts-card ts-enter" style="--i: 3">…</article>
```

**`ts-app`**: the window layout: fixed-width translucent `ts-sidebar` beside the content pane. Put it directly in `<body>`. It fills the viewport (`100dvh`), works from 960×640 up, and the window never scrolls: only `ts-app-main` scrolls (overscroll contained), with `ts-topbar` sticky inside it. `ts-app-pane` is the non-scrolling, `position: relative` wrapper that hosts the `ts-sheet`. `ts-app-main` is also the inline-size container `ts-grid` responds to. Gallery: `gallery.html?shell` shows the screen fragment alone at window size.
```html
<body>
  <div class="ts-app">
    <nav class="ts-sidebar">…</nav>
    <div class="ts-app-pane">
      <div class="ts-app-main">
        <header class="ts-topbar">…</header>
        <div class="ts-app-content">
          <h1 class="ts-large-title">Overview</h1>
          …cards, ts-grid rows…
        </div>
      </div>
      <div class="ts-sheet" inert>…</div>
    </div>
  </div>
</body>
```

**`ts-sidebar`**: app navigation column (translucent material).
```html
<nav class="ts-sidebar">
  <h2 class="ts-sidebar-title">Tokenscope</h2>
  <div class="ts-nav" style="--index: 0">
    <span class="ts-nav-pill"></span>
    <a class="ts-nav-item" href="#overview" aria-current="page">
      <span class="ts-nav-icon" style="--tile: var(--cat-1)"><svg>…</svg></span>
      <span class="ts-nav-label">Overview</span>
    </a>
  </div>
</nav>
```
`ts-nav-item`: one screen link. States: hover, `:active`, `aria-current="page"`. The single `ts-nav-pill` must be the first child of `ts-nav`. It slides to `--index`. **JS contract: set `--index` (0-based position of the current item) on `ts-nav`, in markup and on every selection change** (a pure-CSS `:has()` index left the pill at stale positions in Chromium). Knob `--tile` on `ts-nav-icon` takes a `--cat-*` or `--color-*` token. JS contract: set `aria-current="page"` on exactly one item.

**`ts-topbar`**: sticky compact bar at the top of the scrolling content pane. Material, hairline and title fade in as the large title scrolls away (scroll-driven, no JS).
```html
<header class="ts-topbar">
  <h2 class="ts-topbar-title">Overview</h2>
  <div class="ts-topbar-actions">…buttons, chips, segmented…</div>
</header>
```

**`ts-large-title`**: the screen title at the top of the content. It fades as it scrolls under the top bar.
```html
<h1 class="ts-large-title">Overview</h1>
```

**`ts-card`**: the container all content sits in. Use `<a>`/`<button class="ts-card">` for a pressable card (hover overlay and press scale come free).
```html
<article class="ts-card">
  <div class="ts-card-header">
    <h3 class="ts-card-title">Cost by agent</h3>
    <button class="ts-button ts-button--plain">See all</button>
  </div>
  …
</article>
```

**`ts-grid`**: responsive card grid. Default: as many columns of at least 280 px as fit. Modifiers: `ts-grid--stats` (4-up stat row, 2-up when narrow), `ts-grid--split` (2:1 row, stacks when narrow), `ts-grid--halves` (1:1 row of equal-height cells, stacks when narrow; nest one inside a half to line up with the four `--stats` columns, as Overview does). Narrow = the nearest inline-size container (`ts-app-main`, `ts-sheet-body`) is under `--size-pane-narrow` (880 px; repeated literally in the `@container` query because a query cannot read `var()`).
```html
<div class="ts-grid ts-grid--stats"><article class="ts-card ts-stat">…</article>…×4</div>
<div class="ts-grid ts-grid--split"><section class="ts-card">…</section><a class="ts-card">…</a></div>
```

**`ts-list`**: inset grouped list (Settings sections, recent sessions). On the page it is its own rounded surface. Inside a `ts-card` it bleeds to the card edges.
```html
<p class="ts-list-header">Appearance</p>
<ul class="ts-list">
  <li class="ts-row">…</li>
</ul>
<p class="ts-list-footer">Applies on next refresh.</p>
```

**`ts-row`**: one list row (minimum `--size-row`), with an inset hairline and none on the last row. Use `<a>`/`<button class="ts-row">` (or `<li><button class="ts-row">`) for a pressable row. States: hover/press overlay (pressable only), `aria-disabled="true"`.
```html
<li><button class="ts-row">
  <span class="ts-row-leading"><span class="ts-nav-icon" style="--tile: var(--cat-2)"><svg>…</svg></span></span>
  <span class="ts-row-content">
    <span class="ts-row-title">claude-api-usage-costs-translator</span>
    <span class="ts-row-subtitle">Claude · 5m ago</span>
  </span>
  <span class="ts-row-trailing">$12.40</span>
  <svg class="ts-row-chevron">…</svg>
</button></li>
```

**`ts-segmented`**: pick one of 2–6 equal options (range presets, Daily/Weekly/Monthly, theme). Built on radios, so arrow keys work. The thumb slides to `--index`. **JS contract: set `--index` (0-based position of the checked radio) on `ts-segmented`, in markup and on every `change`.** `ts-segmented-thumb` must be the first child. States: `:checked`, `:disabled`, press.
```html
<div class="ts-segmented" role="radiogroup" aria-label="Range" style="--index: 0">
  <span class="ts-segmented-thumb"></span>
  <label class="ts-segmented-item"><input type="radio" name="range" value="7" checked><span>7 d</span></label>
  <label class="ts-segmented-item"><input type="radio" name="range" value="30"><span>30 d</span></label>
</div>
```

**`ts-switch`**: on/off setting, a native checkbox. States: `:checked`, `:active`, `:disabled`.
```html
<input type="checkbox" role="switch" class="ts-switch" aria-label="Offline pricing">
```

**`ts-button`**: actions. Default is filled (primary). Modifiers: `ts-button--tinted` (secondary), `ts-button--plain` (text only, "See all", "Done"). States: hover, `:active`, `:disabled`.
```html
<button class="ts-button"><svg>…</svg>Refresh</button>
```

**`ts-chip`**: legend entries (static `<span>`) and filter toggles (`<button aria-pressed>`). Knob `--dot` on `ts-chip-dot` takes a `--cat-*` token. States: `aria-pressed="true"`, hover, `:active`. Inside `ts-chart-legend` chips lose their fill.
```html
<button class="ts-chip" aria-pressed="true"><span class="ts-chip-dot" style="--dot: var(--cat-1)"></span>Claude</button>
```

**`ts-badge`**: tiny status pill: deltas, "Unpriced", counts. Neutral by default. Modifiers: `ts-badge--positive`, `ts-badge--negative`, `ts-badge--warning`, `ts-badge--tint`.
```html
<span class="ts-badge ts-badge--negative">▲ 12%</span>
```

**`ts-stat`**: widget-like figure, always on a card. `ts-stat-value` is the `countUp()` target. `ts-stat-spark` holds a `ts-chart-line`.
```html
<article class="ts-card ts-stat">
  <span class="ts-stat-label">Today</span>
  <span class="ts-stat-value">$12.40</span>
  <span class="ts-stat-meta"><span class="ts-badge ts-badge--positive">▼ 8%</span> vs yesterday</span>
  <svg class="ts-stat-spark"><path class="ts-chart-line" d="…"/></svg>
</article>
```

**`ts-table`**: sortable data tables (Reports, Sessions, Blocks history), placed in a `ts-card`. Header sticks below the top bar. Numeric cells get `ts-table-num`. A long text column gets `ts-table-clip` on its `th` and every `td`: it takes the leftover width and truncates with an ellipsis, so the table never outgrows its card (`dataTable()` in `kit.js`: `clip: true` on the column). States: `aria-sort="ascending|descending"` on `th`, `aria-expanded` on expandable rows, row hover. JS contract: toggle `aria-sort` on the sorted `th` (remove from others), and toggle `aria-expanded` plus the detail row's `hidden`.
```html
<table class="ts-table">
  <thead><tr>
    <th aria-sort="descending"><button class="ts-table-sort">Cost<svg class="ts-table-caret">…</svg></button></th>
  </tr></thead>
  <tbody>
    <tr class="ts-table-row" aria-expanded="false"><td><svg class="ts-table-caret">…</svg>2026-11-10</td><td class="ts-table-num">$4.20</td></tr>
    <tr class="ts-table-detail" hidden><td colspan="2"><div class="ts-table-detail-body">…</div></td></tr>
  </tbody>
  <tfoot><tr><td>Total</td><td class="ts-table-num">$4.20</td></tr></tfoot>
</table>
```

**`ts-sheet`**: detail and picker panels that slide up over a dimmed, blurred backdrop. It lives in the content pane's non-scrolling, `position: relative` wrapper. JS contract: `data-open` opens it; when closed also set `inert`; dismiss on backdrop click and Escape. `openSheet(titleText, contentEl)` / `closeSheet()` in `dom.js` do all of this. Do not hand-roll it.
```html
<div class="ts-sheet" data-open>
  <div class="ts-sheet-backdrop"></div>
  <section class="ts-sheet-panel" role="dialog" aria-labelledby="sheet-title">
    <div class="ts-sheet-grabber"></div>
    <header class="ts-sheet-header">
      <h2 class="ts-sheet-title" id="sheet-title">Session</h2>
      <button class="ts-button ts-button--plain">Done</button>
    </header>
    <div class="ts-sheet-body">…</div>
  </section>
</div>
```

**`ts-tooltip`**: chart hover readout. JS contract: position with `style.translate = "120px 40px"` (never `left`/`top`) and set `data-open`. It fades and scales in and glides between positions. `tooltip(targetEl, getContentEl)` in `dom.js` handles this.
```html
<div class="ts-tooltip" role="tooltip" data-open>
  <div class="ts-tooltip-title">10 Nov</div>
  <div class="ts-tooltip-row"><span class="ts-chip-dot" style="--dot: var(--cat-1)"></span>Claude<span class="ts-tooltip-value">$4.20</span></div>
</div>
```

**`ts-progress`**: share or limit bars. JS contract: knob `--value` = 0…1 set inline (values above 1 show full). Also set `aria-valuenow`. Optional `ts-progress-label` row above. Modifiers: `ts-progress--warning` (nearing limit), `ts-progress--over` (over limit).
```html
<div class="ts-progress-label"><span>Block tokens</span><strong>6.2M of 10M</strong></div>
<div class="ts-progress" role="progressbar" aria-valuenow="62" style="--value: .62"><span class="ts-progress-fill"></span></div>
```
`ts-progress-label`: the optional label row directly above the bar: what it measures (`span`, secondary) and the figure (`strong`, primary).

**`ts-skeleton`**: loading placeholder in the final layout (never a blank window). Default is a text line. Set width inline. Modifiers: `ts-skeleton--title` (large figure line), `ts-skeleton--block` (chart or card body).
```html
<span class="ts-skeleton" style="width: 60%"></span>
```

**`ts-empty`**: nothing to show (no data, filter matches nothing, no active block).
```html
<div class="ts-empty">
  <div class="ts-empty-glyph"><svg>…</svg></div>
  <h3 class="ts-empty-title">No usage yet</h3>
  <p class="ts-empty-text">Run an agent, then refresh.</p>
  <button class="ts-button">Refresh</button>
</div>
```

**`ts-banner`**: page-level message above content (engine error with Retry, notices). Informational (tint) by default. Modifiers: `ts-banner--warning`, `ts-banner--negative`. Put stderr in `ts-banner-detail` via `textContent`.
```html
<div class="ts-banner ts-banner--negative" role="alert">
  <svg class="ts-banner-icon">…</svg>
  <div class="ts-banner-content">
    <span class="ts-banner-title">Could not load usage</span>
    <p class="ts-banner-text">Showing the last good data.</p>
    <pre class="ts-banner-detail">…stderr…</pre>
  </div>
  <button class="ts-button ts-button--tinted">Retry</button>
</div>
```

**`ts-field`**: text input or select (search, timezone, token limit, refresh interval). Modifier: `ts-field--search` (leading magnifier, pill). States: `:focus-within`, `aria-invalid="true"` on the input (red ring, shows the message), `:disabled`. JS contract: validation sets `aria-invalid="true"` and fills `ts-field-message`, which must directly follow the field.
```html
<label class="ts-field ts-field--search">
  <svg class="ts-field-icon">…</svg>
  <input class="ts-field-input" type="search" placeholder="Search sessions">
</label>
<p class="ts-field-message">Enter a number or "max".</p>
```

**`ts-chart`**: styles for hand-drawn SVG charts. `charts.js` draws the geometry. Knob `--series` = a mark's colour, set on the mark or its `<g>` as `var(--cat-n)`. Parts: `ts-chart-grid`, `ts-chart-axis`, `ts-chart-label`, `ts-chart-bar`, `ts-chart-area`, `ts-chart-line`, `ts-chart-cell` (heatmap, `data-level="0"`…`"4"`), `ts-chart-hover` (vertical cursor), `ts-chart-dot` (hover point), `ts-chart-legend` (wraps `ts-chip`s). States: `:hover` or `data-active` on a bar or cell dims its siblings. Entrances: `ts-chart-grow` (bars rise from the baseline), `ts-chart-grow--x` (grow from the left), `ts-chart-trace` (on the `<rect>` of a `clipPath`, slides in to reveal a line). Both stagger by `--i`.
```html
<svg class="ts-chart" viewBox="0 0 600 200">
  <line class="ts-chart-grid" …/><line class="ts-chart-axis" …/><text class="ts-chart-label" …>Mon</text>
  <g style="--series: var(--cat-1)"><rect class="ts-chart-bar ts-chart-grow" style="--i: 0" …/></g>
  <line class="ts-chart-hover" …/><circle class="ts-chart-dot" r="4" …/>
</svg>
<div class="ts-chart-legend"><span class="ts-chip"><span class="ts-chip-dot" style="--dot: var(--cat-1)"></span>Claude</span></div>
```

**`ts-stack`**: the vertical run a view renders into (standard gap). `app.js` gives each view one; use it inside sheets too.
```html
<div class="ts-stack">…cards, ts-grid rows, ts-toolbar…</div>
```

**`ts-toolbar`**: one row of controls above content (the source/range filter row, a view's Daily/Weekly/Monthly switch, a search field with a count). A leading and an optional trailing `ts-toolbar-group`; wraps when narrow. A group alone is an inline cluster of buttons. Builder: `toolbar(leading, trailing)` in `kit.js`.
```html
<div class="ts-toolbar">
  <div class="ts-toolbar-group">…chips…</div>
  <div class="ts-toolbar-group">…segmented, buttons…</div>
</div>
```

**Chart parts added by `charts.js`** (see the chart block in `components.css` and the live examples in the gallery): `ts-chart-hit` (a bar column's hover/focus area), `ts-chart-fade` and `ts-chart-scale` (entrances), `ts-rank` with `ts-rank-row`, `ts-rank-head`, `ts-rank-label`, `ts-rank-value`, `ts-rank-share` (ranked HTML bars; with more than 8 items the last row is an "Other (n)" button, `ts-rank-toggle` with a `ts-rank-chevron`, that expands `ts-rank-more` to list the folded items), `ts-timeline-track` and `ts-timeline-now` (block timeline). Charts are drawn in CSS pixels: the SVG `viewBox` equals the container's width × the chart height, and the chart redraws when the width changes, so `ts-chart-label` text is always its real size.

## 6. Motion

- **Springs.** Use `--spring-snappy` for controls and presses, `--spring-smooth` for screens, sheets, entrances and chart draw-in, and `--spring-bouncy` for celebratory accents only. Hover and colour fades use `--dur-fast ease-out`. Popover and tooltip opacity uses `--dur-base ease-out`.
- **Entrances.** Add `ts-enter` to inserted cards and rows. Call `stagger(parent)` to set `--i` (one `--stagger-step` per item, capped at 12). Charts use `ts-chart-grow` / `ts-chart-trace`. Stat figures count up with `countUp(el, to, formatFn)`. When data changes, charts re-flow by interpolating, never by snapping.
- **Press feedback.** Pressable things scale to `--press-scale` on `:active` with `--spring-snappy`. Buttons also dim to `--opacity-pressed`, instantly (`transition-duration: 0s` while active).
- **Compositor only.** Animate `transform`/`translate`/`scale`/`rotate`, `opacity`, `filter`. Never width, height, top, left, margin, colour or background. Sliding indicators (nav pill, segmented thumb, progress fill) move by `translate` driven by a custom property.
- **Colour changes use the overlay trick.** Put a `::before`/`::after` with `content: ""; position: absolute; inset: 0; border-radius: inherit;` and the target colour (`--color-hover`, `--color-tint-soft`, `--color-positive`…) on top of the element, and transition its `opacity`. `ts-button`, `ts-chip`, `ts-switch`, `ts-row` and pressable `ts-card` all do this. Copy one of them.
- **Reduced motion.** `components.css` collapses every transition and animation to a `--dur-fast` opacity fade. Travel, scale, shimmer and springs are removed, and chart entrances become fades. New components inherit this. Do not add your own `prefers-reduced-motion` block unless something would still move.
- **Screen changes** go through `transition(updateFn)` in `dom.js` (View Transitions API, with a plain call when unsupported or under reduced motion). Never call `document.startViewTransition` directly.
- **Scroll-driven effects** (large title fade, top bar material) are pure CSS with `animation-timeline: scroll(nearest block)`. Keep the scroll container the content pane.

## 7. Do / Don't

| Don't | Do |
|---|---|
| `color: #005FCC` or `rgb(…)` in a component or view | `color: var(--color-tint)`. Add a token if none fits |
| `color-mix()` outside `tokens.css` for a lighter shade | Use the `*-soft` token, or add a derived token to `tokens.css` |
| `transition: width …` / animate `height`, `left`, `background` | Animate `scale`/`translate`, or fade an overlay's `opacity` |
| `transition: all …` or `transition: var(--spring-snappy)` | `transition: scale var(--spring-snappy)` (property named first) |
| A new one-off rounded white box with its own shadow | `ts-card` (or `ts-list` for rows) |
| A border around a card or between rows | Surface contrast and `--color-separator` hairlines as `ts-row`/`ts-table` do |
| `el.innerHTML = project.name` | `h('span', null, project.name)` (text node) |
| Chart series colour `'#D55E00'` or `'orange'` | `'var(--cat-1)'` passed as the series colour and set as `--series` |
| Reordering `--cat-*` or giving an agent a new colour per screen | One fixed order everywhere: `--cat-1` Claude, `--cat-2` Codex, then in order |
| Coloured text on `--color-fill`/`--color-fill-2`, or `--color-label-3` for content | Coloured text only on a background or its own `*-soft`; content in `--color-label`/`-2` |
| `margin: 13px`, `border-radius: 10px`, `font-size: 14px` | `--space-*`, `--radius-*`, `font: var(--text-*)` |
| `class="is-active"` | Native state: `aria-pressed`, `aria-current`, `aria-expanded`, `data-active`, `:checked` |

## 8. Recipes

Each recipe ends with: run `node --test "tests/*.test.mjs"` (must pass), then look at it in light and dark in the dev preview (Settings theme, or `data-theme` on `<html>`).

### Add a screen
1. Create `src/Tokenscope/ui/views/<id>.js`. Copy the smallest existing view (`projects.js`) as the pattern. Export:
   - `id`, `title`, `tile` (the sidebar tile colour, a `var(--cat-n)` string) and `icon` (a function returning `icon('<name>')` from `kit.js`; add the glyph's path to `ICONS` there).
   - `render(el, ctx, params)`: fill `el` (a `ts-stack` the shell provides) with `el.replaceChildren(…)`. It runs on navigation and on every data or filter change, so it must be idempotent. Add `ts-enter` (via `card({ enter: ctx.animate })`) only when `ctx.animate` is true.
   - Optional: `renderLive(el, ctx)` (called on the periodic blocks-only refresh; replace just the live part, marked `data-live`), `reset()` (clear per-visit state such as a search box), `filters = false` (no source/range row), `agentFilter = false` (no source chips), `machineFilter = false` (no PC chips; for a screen that selects PCs itself, like Machines), `needsData = false` (render even before data exists).
2. Register it in the `VIEWS` array in `app.js`. The sidebar pill supports 8 items; the number shortcuts follow the array order.
3. Build from `kit.js`, not from raw markup: `card`, `stat`, `row` + `list`, `dataTable`, `segmented`, `switchInput`, `chip`, `toolbar`, `empty`, `modelList`. Lay out with `ts-grid ts-grid--stats` / `ts-grid--split`. Always handle the empty case with `empty({ … })`.
4. Read data from `ctx.vm` (already filtered; `ctx.vm.all` is unfiltered) and derive with `shape.js` helpers (`totals`, `aggregate`, `modelSplit`…). Format with `format.js`. If a derivation is missing, add a pure, tested function to `shape.js`. Do not compute in the view.
5. Charts: create an empty `h('div')`, put it in a card, and call the chart function **after** `el.replaceChildren(…)` (charts measure their container). Time series go through `fillDays()` first so the axis has no gaps.
6. Local view state (a sort, a toggle) lives in module variables; re-render only the part that changes (see `update()` in `reports.js`) so controls keep their animation and focus.
7. Views never call the engine or `bridge.js`. Use `ctx.actions` (`navigate`, `setFilter`, `setSetting`, `refresh`, `exportData`, `openExternal`).
8. Verify (tests, then light and dark, at 1280×820 and 960×640).

### Screen layout patterns
- **Stat row first.** A screen that summarises opens with `ts-grid ts-grid--stats` (four `stat()` cards). Everything below should sit on those four columns.
- **Lower cards on the same columns.** Use `ts-grid--halves`, and nest a second `ts-grid--halves` inside one half for quarter-width cards. Overview does this: Recent sessions (half) above Activity and Active block (a quarter each), beside Models (half, full height). Do not use `ts-grid--split` under a stat row; its 2:1 columns do not line up with it.
- **Cards in a row share a height.** `--halves` and `--stats` stretch their cells, so a short card grows rather than leaving a gap beside a tall one. Put the card whose content can grow (a ranked list) in the cell that sets the height.
- **Small cards carry small charts.** In a quarter-width card pass fewer points (Overview's heatmap shows 16 weeks) and drop legends (`legend: false`).
- **The filter row** holds source chips, then PC chips (only when a second PC exists), then the range control. It wraps when narrow; do not add a third chip group.

### Add a component
1. Check the tokens. Every value must come from `tokens.css`. If one is missing, add it first (see the last recipe).
2. Add a block to `components.css` with the standard header comment: `/* ── Name ── */`, then `Purpose:`, `Anatomy:`, `Modifiers:`, `States:` and any `Knob:`. Follow the naming conventions, use native-attribute states, use `--_` for private properties, use the overlay trick for colour changes, and press with `--press-scale`.
3. Show **every** class and state in `gallery.html` with copyable markup (the test fails otherwise).
4. Add an entry to the component index in this guide: use-for line, minimal markup, modifiers/states, JS contract.
5. Verify (tests, then light and dark).

### Add a chart
1. Add a function to `charts.js` with the shared shape `(el, data, options)`. It fills `el` with an SVG sized to it, re-renders on resize and animates in.
2. Build the SVG with `svg()` from `dom.js`, with root class `ts-chart`. Use the primitives (`ts-chart-grid`, `ts-chart-axis`, `ts-chart-label`, `ts-chart-bar`/`-line`/`-area`/`-cell`, `ts-chart-hover`, `ts-chart-dot`).
3. Colours are strings `'var(--cat-n)'` (or a `--color-*` token) set as `--series` on the mark or its `<g>`. Never a literal.
4. Entrance: bars get `ts-chart-grow` (or `ts-chart-grow--x`), lines get a `clipPath` whose `<rect>` has `ts-chart-trace`, and both get `--i`. Data changes interpolate.
5. Hover: set `data-active` on the hovered mark and show a `ts-tooltip` via `tooltip()`. Add a `ts-chart-legend` of `ts-chip`s when there is more than one series.
6. Give the chart a text equivalent (a `ts-table` of the same data, or an `aria-label` summary).
7. Verify (tests, then light and dark).

### Add a setting
1. Add the default to the settings defaults object in `app.js` (stored under localStorage key `tokenscope.settings`).
2. Add the control in `views/settings.js`: a `ts-row` in a `ts-list` section with a `ts-switch` (boolean), `ts-segmented` (2–6 choices) or `ts-field` (text/select) in `ts-row-trailing`. Write changes through `ctx.actions.setSetting(key, value)`.
3. If it changes engine flags, map it in `ui/args.js` (`engineArgs(settings)`, pure and tested in `tests/dom.test.mjs`; add a test case). Then extend the host's flag allow-list (`ArgPolicy` in `src/Tokenscope/Engine.cs`). The host rejects any flag it does not know, so both sides change together.
4. Verify (tests, then light and dark).

### Add or change a colour token
1. Add it to `:root` in `tokens.css` with a one-line "use when" comment, in the right group.
2. If its value is raw, add the dark value to **both** dark blocks, identically. If it is derived only from other tokens, it follows the theme and needs no dark entry.
3. Check contrast: text and semantic colours must meet WCAG AA (4.5:1) on `--color-bg`, `--color-bg-2`, `--color-bg-grouped` and on their own `*-soft`, in both themes.
4. Add it to the token index above, and show it in the gallery if it is a new role.
   The Windows title bar copies two tokens by value: `ApplyTheme` in `MainForm.cs` sets the caption and border to `--color-bg-grouped` and the title text to `--color-label` (Windows 11). If you change either token, change those constants too.
5. Verify (tests, then light and dark).

## 9. Where things live (`src/Tokenscope/ui/`)

```
index.html        the ts-app shell: sidebar, top bar, <main id="content">, the sheet host
app.js            settings, engine loads + cache, filters, router (VIEWS registry), frame, shortcuts
kit.js            view kit: icons, agent labels/colours, date helpers, card/stat/row/list/dataTable/…
bridge.js         host messaging; fixture fallback from /tests/fixtures/ when not hosted (?mock=slow|error|empty)
args.js           pure: settings → engine argument arrays
shape.js          pure: engine JSON → view models (all engine data goes through here)
format.js         pure: money, tokens, duration, relative, pct
dom.js            h(), svg(), openSheet/closeSheet, tooltip, countUp, stagger, chunked, transition
charts.js         stackedBars, lineChart, sparkline, rankBars, heatmap, blockTimeline
views/<id>.js     overview, reports, sessions, blocks, projects, machines, settings
design/           tokens.css, components.css, gallery.html
```

### Module interfaces (check the source if in doubt)

```js
// dom.js
h(tag, props, ...children)     // props: class, dataset, attrs (any attribute), on<Event>; strings become text nodes
svg(tag, attrs, ...children)
openSheet(titleText, contentEl); closeSheet()   // makes everything behind the sheet inert; Escape and backdrop close
tooltip(targetEl, getContentEl)                 // getContentEl(event) -> element, or null to hide
countUp(el, to, formatFn)
stagger(parentEl)              // sets --i on up to 12 children
chunked(container, items, renderItem, size = 60)
transition(updateFn)           // View Transitions wrapper; plain call if unsupported or reduced motion

// kit.js
icon(name, cls?)               // our 24 px stroke glyphs; names are the keys of ICONS
agentLabel(agent); agentColor(agent, agents); seriesColor(i)      // colours are 'var(--cat-n)' strings
addDays(iso, n); dayLabel(iso); monthLabel(iso); stamp(isoInstant); clock(isoInstant)
fillDays(rows, since, until)   // zero-filled day rows (at most 800, keeping the latest)
RANGES; rangeLabel(filter)
card({title, action:{label,onClick}, enter, tag, attrs, cls}, ...children)
stat({label, value, format, delta, meta, animate}); deltaBadge(delta)
empty({glyph, title, text, action:{label,onClick}})
row({tile, glyph, title, subtitle, trailing, onClick}); list(header, rows, footer)
segmented({name, label, options:[{value,label}], value, onChange})   // owns its --index
switchInput({label, checked, onChange}); chip({label, dot, pressed, onClick})
modelList(models)              // per-model breakdown as a ts-list
dataTable(columns, rows, {sort, detail, onRow, footer, empty})
  // columns: [{key, label, num, clip, value(row), render(row)}]; pass a module-level
  // sort object {key, dir} to remember the user's sort across re-renders
toolbar(leading, trailing)

// charts.js — each fills el, redraws on resize (no entrance replay), shows ts-empty when there is nothing
stackedBars(el, {labels /*ISO days*/, series:[{name, color, values}], format, height})
lineChart(el, {labels /*ISO days*/, values, format, height, color, tipLabel(iso, i)})
sparkline(el, values, {color})
rankBars(el, [{label, value, share, color, badge}], {format})     // HTML; more than 8 items: 7 listed, the rest in an expandable "Other (n)" row
heatmap(el, cells /*from heatmapCells()*/, {format, today, legend = true})   // legend: false drops the Less/More scale (small cards)
blockTimeline(el, blocks, nowMs, {hours, format})

// bridge.js (app.js only; never from views)
hosted; run(args); save(name, content); setTray(text, closeToTray, theme); openExternal(url); onRefresh(fn)
syncInfo(); syncPick(); syncOff()   // -> {folder | null, machine}; the host owns the folder path
sync(snapshotJson | null)           // writes this PC's snapshot, resolves to the other PCs' (untrusted)

// views/<id>.js
export const id, title, tile; export const icon = () => svgElement;
export function render(el, ctx, params);
// optional: renderLive(el, ctx), reset(), filters = false, agentFilter = false, machineFilter = false, needsData = false

// ctx passed to every view
{ vm:{daily, sessions, agents, unpriced, blocks, active, projects, all,    // filtered; vm.all = unfiltered
      machines},   // every PC [{name, local, savedAt, daily, sessions, …}], range- and source-filtered, ignoring the PC filter
  filter:{agent, machine, preset, since, until}, settings, today, nowMs,
  sync:{folder, machine, error},   // machine sync state for Settings and Machines
  status:{loading, error, updatedAt}, animate,
  actions:{navigate(id, params), setFilter(patch), setSetting(key, value), refresh(),
           exportData(what /*'daily'|'sessions'*/, format /*'csv'|'json'*/), openExternal(url),
           pickSyncFolder(), syncOff()} }

// settings defaults (localStorage 'tokenscope.settings')
{theme:'system', timezone:'', costMode:'auto', offline:false, weekStart:'sunday',
 tokenLimit:'', refreshSec:60, closeToTray:true, machineName:''}
```

`shape.js` (pure): `shapeMain`, `prettyProject`, `shapeBlocks`, `shapeProjects`, `filterDaily`, `filterSessions` (takes `timeZone`), `aggregate`, `totals`, `periodStats`, `agentSeries`, `modelSplit`, `heatmapCells`, `projectTotals`, `recentSessions`, `trayText`, `toCsv`, and for machine sync `shapeSnapshot`, `shapeMachines`, `mergeMachines`, `machineTotals`. Types: `Usage = {input, output, cacheWrite, cacheRead, tokens, cost}`, plus `Row`, `Session`, `Block` built on it (see the head of `shape.js`). `format.js`: `money`, `tokens`, `duration`, `relative`, `pct`.

### How data reaches a view

With a sync folder set (Settings → Machines), each refresh also writes this PC's snapshot `{v, machine, savedAt, raw}` to `<folder>/<PC name>-<install id>.tokenscope.json` and reads the other PCs' files. `shapeMachines` validates them (they are untrusted input) and `mergeMachines` builds `all` from the PCs the machine filter selects, so every screen works on merged data unchanged. Sessions and projects carry a `machine` field. Blocks and the tray stay local. `all.machines` is the full per-PC list; the Machines screen reads it through `ctx.vm.machines` and makes its own selection (`machineFilter = false` hides the shared PC chips there).

`app.js` runs four engine calls (`args.js`), shapes them once (`shape.js`) into `all`, and builds `ctx.vm` by applying the source filter and date range in the UI, so filter changes never call the engine. The last good payloads are cached in localStorage (key `tokenscope.cache`, versioned by `CACHE_VERSION` in `app.js`: bump it when payload or view-model shapes change) and shown at start-up while a fresh load runs. Every `settings.refreshSec` seconds only the blocks call re-runs and the current view's `renderLive` is called.
