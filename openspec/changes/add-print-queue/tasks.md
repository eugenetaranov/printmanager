# Tasks

## 1. Backend (`roles/web-ui/files/scan-web.py`)

- [x] 1.1 Queue store under `DATA_DIR/queue/` (json + per-item PDF), lock, 7-day sweep, 20-item cap
- [x] 1.2 `GET /queue` (items, worker state, per-target readiness, heartbeat) and `POST /queue/add|update|remove|release|stop`
- [x] 1.3 USB presence check for `usb://` CUPS queues (sysfs manufacturer vs URI brand)
- [x] 1.4 Release worker: ordered, one at a time, label via reconnect+print, A4 via wait-for-USB + `lp` + completion poll, pause on failure, heartbeat timeout, stop
- [x] 1.5 Refuse `do_document`/`do_print` to an absent USB printer (`offline` error code)

## 2. Label rendering (`niimbot.py`)

- [x] 2.1 Code 128 encoder + `barcode` render kind (digits underneath, no dither); preview supports it

## 3. Web UI

- [x] 3.1 `queue` route/tab, queue context with 3 s visible-only polling, header queue button with count
- [x] 3.2 QueueTab: paste field + Add, Choose file, drag-drop; item cards with target select, copies stepper, barcode toggle, two-click remove
- [x] 3.3 Readiness chips, Print all / Resume / Stop, per-item states
- [x] 3.4 Print tab: Add to queue secondary action + offer it on an `offline` error
- [x] 3.5 Labels tab thermal text: Add to queue secondary action
- [x] 3.6 Update `web-ui-src/CLAUDE.md` (tabs list, copies stepper exception to the slider rule)

## 4. Verify

- [x] 4.1 `npm run build` clean
- [x] 4.2 Backend smoke test locally (store, add/remove, worker against a stubbed printer)
- [ ] 4.3 Deploy with `task apply -- web` and test on the Pi with the B1 and the DCP-1511  _(needs live host)_
