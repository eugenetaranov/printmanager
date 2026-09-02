# Web UI — design system & conventions

Guidance for anyone (human or LLM) changing the print/scan web UI. These rules were
distilled from a UI/UX review; follow them so the interface stays coherent across
iterations. When a change would break a rule here, update this file in the same commit
and say why — don't silently diverge.

## Stack & deploy

- **React 19 + TypeScript + Vite 6 + Tailwind v4 + DaisyUI 5.** Single-page app in
  `src/`, served as static `dist/` by the Python backend (`../roles/web-ui/files/scan-web.py`).
- **Build-on-Pi, upload-from-local deploy model.** Deploy with `tack run site.yaml --tags web`
  **from the repo root**: the `web-ui` role `copy`s this local `web-ui-src/` tree up to the Pi
  (the `src/` sync uses `delete:true`; `node_modules/`+`dist/` are never referenced, so they're
  not uploaded), which then runs `npm ci && vite build` *itself*. So a deploy ships whatever is
  checked out locally — **no `git push`/clone round-trip**, and branches/uncommitted changes
  deploy as-is. The copy `src` paths are working-directory-relative, so run tack from the repo
  root. If you add a new root-level build input (a Tailwind/PostCSS config, `.env`, etc.), add it
  to the build-inputs `loop` in `roles/web-ui/tasks/main.yaml` — only `src/` and the listed files
  are uploaded.
- Always `npm run build` (`tsc -b && vite build`) before committing UI changes — the Pi
  build is strict and a type error there means a failed deploy.
- **Build version (the `Build:` footer).** `vite.config.ts` bakes `git describe` into
  `__APP_VERSION__` at build time. The Pi builds from uploaded files (no git checkout), so a
  **deployed** build shows `dev`; a local `npm run build` shows the real commit. (The web-ui role
  removes the stale git clone older deploys left in the build dir — otherwise `git describe` there
  walked into it and reported a wrong, always-`-dirty` commit.)

## Theming — DaisyUI, not raw colors

- Themes: **`nord` (light)** and **`dim` (dark)**, auto-switched by `prefers-color-scheme`
  (declared in `src/index.css`). There is no manual theme toggle.
- **Never hard-code colors.** Use DaisyUI semantic tokens so both themes stay correct:
  `base-100/200/300` (surfaces), `base-content` (text), `primary` (accent/CTA),
  `error`, `warning`, `success`. Dim a token with `/NN` opacity (`text-base-content/45`),
  not a new gray.
- Page background is `base-200`; cards/tables sit on `base-100` with a `border-base-300`.

## Typography

The type scale is a **closed set of tokens** in `src/index.css @theme`. Do not introduce
arbitrary `text-[Npx]` values — pick the nearest token:

| Token        | Size  | Use                                    |
|--------------|-------|----------------------------------------|
| `text-2xs`   | 11px  | micro labels, meta, badges, hints      |
| `text-xs`    | 12px  | secondary data (stock Tailwind step)   |
| `text-body`  | 13px  | default body / table text              |
| `text-title` | 15px  | section headings, modal titles         |
| `text-hero`  | 19px  | page title                             |

- **Uppercase field/section labels → the `field-label` utility.** One recipe (mono,
  11px, 600, `0.04em` tracking, uppercase, muted) lives in `index.css`. Never re-spell it
  inline; if a label needs a tweak, change the utility.
- **`font-mono` is for data, not chrome.** Apply monospace to filenames, sizes,
  dimensions (`80×50 mm`), DPI, addresses, timestamps, paths, and the *values inside*
  form inputs/selects — things where the mono grid aids scanning. Do **not** put
  `font-mono` on prose (help text, error/status sentences, empty states) or on buttons.
  Data columns of numbers also get `tabular-nums`.
- Weight for hierarchy: headings `600–700`, body `400`, labels `500–600`.
- **Muted text is one tier: `text-base-content/60`.** Don't scatter `/40`/`/45`/`/70`;
  secondary/meta text uses `/60` (matches the `field-label` mix). Essential text that must
  meet WCAG AA — filenames, primary values — stays full-contrast `text-base-content` (no
  opacity). Note: nord's dark-on-light palette means small text below ~`/80` doesn't hit a
  strict 4.5:1, so keep anything load-bearing at full contrast rather than dimming it.

## Components & patterns

- **Tooltips: DaisyUI `tooltip` with a *vertical* direction only** (`tooltip-top`,
  `tooltip-bottom`). Horizontal tooltips (`tooltip-left/right`) or tooltip bubbles inside
  an `overflow-x-auto` container create a horizontal scrollbar — a bug we hit repeatedly.
  Row action tooltips point `top`; modal-header actions point `bottom`. Don't fall back to
  the native `title` attribute — its ~1s delay feels broken.
- **Icon-only buttons** (`btn btn-ghost btn-xs btn-square`) must carry a `tooltip` +
  `data-tip` (and an `aria-label` for screen readers). Icons come from one SVG set — no
  emoji as icons.
- **Tables use `table-fixed` + a `<colgroup>`** with pinned widths, so changing content
  (a badge showing/hiding) can never reflow columns. Do **not** wrap the table in
  `overflow-x-auto`; the fixed layout already fits its container, and the wrapper
  reintroduces the tooltip scrollbar. **Make it responsive** by dropping non-essential
  columns below `sm` — hide the `<th>`/`<td>` with `hidden sm:table-cell` *and* collapse
  the matching `<col>` to `w-0 sm:w-[..]` (in `table-fixed`, a `<col>` width is reserved
  even when its cells are hidden, so `display:none` on the `<col>` alone isn't enough).
  The Recent-scans table keeps select/thumb/name/size/actions on mobile and hides
  DPI/When plus the Download/Rename row actions.
- **Interactive SVG must be keyboard-operable.** The label-grid cells
  (`SheetComposer.tsx`) are `<g tabIndex={0} role="checkbox" aria-checked aria-label>` with
  Enter/Space to toggle and arrow keys to rove focus (via `data-cell` lookup), plus a drawn
  focus-ring `<rect>` (SVG `:focus-visible` styling is unreliable, so render the ring from
  a `focusIdx` state). Any new SVG interaction follows the same pattern — don't ship
  click-only SVG.
- **Modals** go through `src/components/Modal.tsx` (DaisyUI `modal-box`, `overflow-x-hidden`,
  `max-w-[380px]` normal / `max-w-[640px]` wide). Pass `labelledBy` for the a11y title link.
  It moves focus into the dialog on open, **traps Tab** inside it, closes on Esc/backdrop,
  and restores focus to the trigger on close — so any new modal gets this for free; don't
  hand-roll another dialog.
- **Loading**: show `skeleton` rows/fields (not a blocking spinner) for anything that can
  arrive late; reserve the final height so content doesn't jump (CLS).
- **Tab route path must equal the tab name** (Scan → `/scan`, Labels → `/labels`) — see
  `src/lib/router.ts`. A path that disagrees with its tab label is a bug.

## Interaction & UX principles

- **Every destructive or bulk action is undoable.** The backend moves files to a trash dir
  keyed by an undo token and restores on `POST /undo`; the UI records the action in the
  **Activity log** (`src/components/ActivityLog.tsx`) with an Undo button. New destructive
  actions must follow this: return an undo token, push an activity entry. The Activity
  footer is provided at the app root so it persists across tab switches, but is only shown
  on the Scan tab.
- **Two-click arm/confirm** for immediate destructive buttons (Remove, Clear all): first
  click arms + relabels ("Click again to delete all") and disarms after a few seconds.
  Use this instead of a confirm dialog for low-stakes single actions; use the Undo path for
  recoverability.
- **Prefer sliders to fiddly numeric inputs** for coarse settings. Size caps use a
  `range range-sm`, integer MB `0–10`, `0 = "No limit"` — no decimals.
- **One primary CTA per view** (`btn-primary btn-block btn-lg` for the main action);
  secondary actions are `btn-ghost`/`btn-outline` and visually subordinate.
- **Respect `prefers-reduced-motion`** — the global rule in `index.css` neutralizes the
  infinite pulse/slide loops; don't add motion that ignores it.
- **No horizontal scroll, ever** (see tooltip/table notes above). The `<html>` reserves a
  stable scrollbar gutter so content doesn't shift when it appears.

## When reviewing or extending the UI

Rank findings by user impact, P1→P2, in this order (from the review that produced this doc):
accessibility (contrast 4.5:1, focus rings, keyboard nav, aria-labels) → touch/interaction
(≥44px targets, loading feedback) → performance/CLS → style consistency → layout/responsive
→ typography/color tokens → animation → forms/feedback → navigation. A change that "looks
unprofessional" is usually a violation high in that list, not a color choice.

The review's structural a11y items are now done: responsive/mobile table, modal focus
trap, SVG-grid keyboard access, and the muted-tier contrast cleanup (see above). What
remains is a **strict WCAG-AA contrast pass** — verifying every foreground/background pair
with a tool and darkening the secondary palette if AA on small text is required (currently
only load-bearing text is guaranteed full-contrast).
