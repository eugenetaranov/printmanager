# Tasks

## 1. Backend (`roles/web-ui/files/scan-web.py`)

- [x] 1.1 `/queue/state` returns `labels` (address, name, model, model_label, label_mm, active, connected)
- [x] 1.2 `/queue/add` returns the new item `ids`
- [x] 1.3 `/queue/release {ids}` limits the worker to those items

## 2. Web UI

- [x] 2.1 Router: tabs Scan · Queue · Print; `/` and unknown paths open Queue; `/labels` redirects to `/queue`
- [x] 2.2 Move the Labels tab body into `components/LabelComposer.tsx` (printer state from the queue poll); remove `LabelsTab.tsx`
- [x] 2.3 Queue tab: label printer row with live status, Reconnect, and a picker for several printers
- [x] 2.4 Quick add: Print now (primary when connected) → add + release ids; Add to queue otherwise
- [x] 2.5 Collapsed "Customize a label" row that swaps the paste box for the composer; the page's image paste goes to the composer while it's open
- [x] 2.6 Dev proxy forwards `/queue/*`; update `web-ui-src/CLAUDE.md`

## 3. Verify

- [x] 3.1 `npm run build` clean; backend `py_compile`
- [x] 3.2 Visual check against a mock backend (connected, disconnected, Customize open; `/labels` redirect)
- [ ] 3.3 Deploy with `task apply -- web` and test on the Pi: Print now with the D110/B1, Reconnect, Customize print, A4 sheet  _(needs live host)_
