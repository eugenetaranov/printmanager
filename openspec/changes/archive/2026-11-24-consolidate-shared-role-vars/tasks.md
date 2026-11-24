# Tasks

## 1. Baseline

- [x] 1.1 Capture the current rendered state on the unmodified tree:
  - every role template rendered locally with the play-wide merged defaults (a scratch playbook in `site.yaml` role order);
  - `tack export site.yaml --no-facts --no-banner-timestamp` for all tasks, commands and `when:` outcomes.

  Verify two exports are byte-identical (deterministic). That pair is the reference later groups compare against. A `--check --diff` against the Pi can't be used: without the sudo password, Tack reports every root-owned file as changed. Also, `tack export` can't find role templates on its own, which is why they are rendered separately.

## 2. Duplicate-default check

- [x] 2.1 Add a `check-vars` task to `Taskfile.yml` that fails when a top-level key appears in more than one `roles/*/defaults/main.yaml`. Verify it fails on today's tree, listing `scan_dir`, `scan_group` and `scan_web_user`.

## 3. Single owner for scan storage settings (D1, D4)

- [x] 3.1 In `scan-share/defaults`, rename `scan_samba_user` to `scan_user` and update `scan-share/tasks` and `smb.conf.j2`. Verify `grep -rn scan_samba_user roles` returns nothing.
- [x] 3.2 Delete `scan_dir`, `scan_group` and `scan_web_user` from `scan-server/defaults` and `web-ui/defaults`, and replace `scan_web_user` with `scan_user` in scan-server and web-ui tasks and templates (`scan-web.service.j2`). Verify `task check-vars` passes and `grep -rn scan_web_user roles` returns nothing.
- [x] 3.3 Add `scan_web_data_dir: /var/lib/scan-web` to `scan-server/defaults`. Replace every literal `/var/lib/scan-web` in `scan-server/tasks`, `scan-to-share.sh.j2`, `scan-cleanup.sh.j2`, `web-ui/tasks`, `scan-web-config.yaml.j2` and `scan-web.service.j2`. Verify `grep -rn /var/lib/scan-web roles --exclude=*.py` matches only that default (comments in web-ui defaults updated to name the variable).
- [x] 3.4 Update the defaults comments ("must match …") to say where each shared setting is owned. Verify by reading the three defaults files.

## 4. Scan backend selector (D3)

- [x] 4.1 Replace `scan_brscan4_enabled`/`scan_escl_enabled` with `scan_backend: brscan4-emu` in `scan-server/defaults`, including the comment explaining both values. Verify `grep -rnE "scan_(brscan4|escl)_enabled" roles` returns nothing after 4.2.
- [x] 4.2 Convert every `when:` in `scan-server/tasks` (19 uses) to `scan_backend == "…"`, and the two template conditionals in `scan-to-share.sh.j2` to `eq .scan_backend "escl"`. Verify on a scratch copy of the playbook with `scan_backend: escl` that `--check` plans the eSCL tasks and skips the chroot, saned bridge and AirSane tasks.

## 5. Derived web UI values (D2)

- [x] 5.1 Set `scan_web_print_queue`, `scan_web_default_mode` and `scan_web_default_res` to `""` in `web-ui/defaults`, and compute them in `scan-web-config.yaml.j2` as described in D2. Verify the rendered config still contains `print_queue: "DCP1511"`, `default_mode: "24bit Color"` and `default_res: 300`.
- [x] 5.2 Verify the derivation in a scratch playbook. With a second `printers:` entry marked default, the rendered `print_queue` is that entry's name. With `scan_backend: escl`, `default_mode` is `Color`. With explicit overrides, the override wins.

## 6. Guards (D5)

- [x] 6.1 Create `roles/preflight` (tasks only) and add it first in `site.yaml` with tags `[base, watchdog, print, scan, share, web]`. Its `command` guards fail on:
  - an unknown `scan_backend`;
  - no or several default printers when the queue is derived;
  - any of `scan_samba_user`, `scan_web_user`, `scan_brscan4_enabled` or `scan_escl_enabled` being defined, naming the replacement.

  Verify each failure with a scratch override, and verify that it runs and skips cleanly on the stock config.
- [x] 6.2 Add a presence guard at the top of `scan-server` and `web-ui` for each shared setting they read but don't own (`scan_dir`, `scan_group`, `scan_user`, and for web-ui also `scan_backend`, `scan_mode`, `scan_escl_mode`, `scan_resolution`, `scan_web_data_dir`, `printers`). Verify `tack run roles/web-ui -c local:// --check` fails naming the missing settings.

## 7. Documentation

- [x] 7.1 Update `README.md` for the new names:
  - the scan-server backend paragraph uses `scan_backend`;
  - the "Secrets" note on the `scans` user refers to `scan_user`;
  - add a short "Shared settings" note saying which role owns which setting and that overrides go in `site.yaml` `vars:`.

  Also update the commented override example in `site.yaml`. Verify `grep -nE "scan_(brscan4|escl)_enabled|scan_samba_user|scan_web_user" README.md site.yaml` returns nothing.

## 8. Integration check

- [x] 8.1 Run `task check-vars` and `tack validate site.yaml`. Then re-render the templates and re-export the tasks, and verify they match the 1.1 baseline:
  - every rendered template is byte-identical;
  - the export differs only by the renamed `when:` conditions and the added preflight and guard tasks;
  - no command, package, user, firewall rule or service changes.
- [x] 8.2 Apply to the Pi (`task apply`) and verify a web-UI scan lands in `/srv/scans` with its thumbnail, and that a document prints to `DCP1511`.

## Workflow follow-up

- Archive the change once it is applied on the Pi and 8.2 passes.
- The `scan-to-share.sh` → `scan-web.py` move can then read `scan_backend`, `scan_jpeg_quality` and `scan_ocr_langs` via `scan-web-config.yaml.j2`, replacing `_ocr_langs()`'s parsing of the script.
