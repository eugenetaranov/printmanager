# Proposal

## Why

Several settings are used by more than one Tack role and are currently re-declared in each role's `defaults/` with "must match" comments, or hardcoded as literals. Tack merges every role's defaults into one play-wide namespace before any task runs, and the **last role in `site.yaml` wins**. So the copies are not independent: editing `scan_dir` in `scan-share/defaults` is silently overridden by `web-ui/defaults`. Other values that must agree (print queue name, scan user, default scan mode) are separate variables that can drift with no error. This is also the groundwork for moving `scan-to-share.sh` into `scan-web.py`, which needs scanner settings passed to the web UI.

## What Changes

- Each cross-role setting gets **one owning role** that declares its default. All other `defaults/` copies are deleted.
  - `scan-share` owns `scan_dir`, `scan_group`, and a new `scan_user`.
  - `scan-server` owns `scan_backend`, `scan_mode`, `scan_escl_mode`, `scan_resolution`, `scan_jpeg_quality`, `scan_ocr_enabled`, `scan_ocr_langs`, and a new `scan_web_data_dir`.
  - `print-server` owns `printers`.
  - `web-ui` keeps only UI settings.
- **BREAKING (host overrides only):** `scan_samba_user` and `scan_web_user` are merged into `scan_user`. A host that overrides either old name must rename the override.
- **BREAKING (host overrides only):** `scan_brscan4_enabled` and `scan_escl_enabled` are replaced by `scan_backend: brscan4-emu | escl`, using the backend names from the `network-scanning` spec. This removes the invalid state where both flags are true or both are false. The default stays `brscan4-emu`.
- Derived defaults replace copies:
  - `scan_web_print_queue` defaults to the `printers:` entry marked `default: true`.
  - `scan_web_default_mode` and `scan_web_default_res` default to the active backend's scan mode and `scan_resolution`.
  - An explicit override still wins.
- The hardcoded `/var/lib/scan-web` path (scan-server tasks, the scan and cleanup scripts, web-ui tasks, config and unit) is replaced by `scan_web_data_dir`.
- Each role that reads another role's setting starts with a guard task. The guard fails with a clear message when a shared setting is missing (for example, when a role is run directly with `tack run roles/<name>`) or invalid (for example, an unknown `scan_backend`).
- With no host overrides, every rendered file and every provisioned resource is byte-identical to today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `device-configuration`: adds a requirement that each setting shared between roles is declared once and applies everywhere when overridden once. Inconsistent or missing shared settings must fail provisioning before any change is made.

## Impact

- `roles/*/defaults/main.yaml`: scan-share, scan-server, web-ui and print-server are edited, and duplicates are removed.
- `roles/scan-server/tasks/main.yaml` and its templates (`scan-to-share.sh.j2`, `scan-cleanup.sh.j2`): switch from the backend flags to `scan_backend` and use `scan_web_data_dir`.
- `roles/scan-share/tasks/main.yaml`, `templates/smb.conf.j2`: rename `scan_samba_user` to `scan_user`.
- `roles/web-ui/tasks/main.yaml`, templates `scan-web-config.yaml.j2` and `scan-web.service.j2`: use `scan_user`, `scan_web_data_dir`, and the derived queue, mode and resolution.
- `site.yaml` comments and `README.md`: describe the renamed and derived variables.
- `scan-web.py` is unchanged: it already reads the data dir from its config.
- Known spec drift, not fixed here: the `network-scanning` and `device-configuration` specs describe a `scanners:` list with `escl` as the default. The code still has one scanner with `brscan4-emu` as the default. `scan_backend` uses the spec's names, so a later move to a `scanners:` list is a smaller step.
