# Design

## Context

How Tack (the version installed here) handles variables. Each point was checked with a throwaway two-role playbook:

- All role `defaults/` are merged into one play-wide namespace **before any task runs**. A role can read a default declared only by another role, whether that role comes before or after it.
- When two roles declare the same default, the **last role in `site.yaml` wins everywhere**, including inside the earlier role.
- Defaults of roles skipped by `--tags` are still loaded.
- Play-level `vars:` in `site.yaml` override every role default.
- Role-level `vars:` (under a `- role:` entry) are also play-wide, visible to roles before and after it.
- `-e key=value` ranks **below** role defaults in `tack run`, although `tack export -e` honours it. So overrides belong in `site.yaml` `vars:`.
- Running a role directory on its own (`tack run roles/web-ui`) loads only that role's defaults.
- Tack has no `assert`/`fail`/`set_fact` module. A `command` task that exits 1, gated by `when:`, works as a guard. `when:` supports `is not defined`, `==`, `!=`, `and` and `or`.
- Task interpolation knows `length` but not `map`, `selectattr` or JSON filters. An undefined variable renders as `<nil>`, and a list renders in Go's `[map[k:v …]]` form.
- `changed_when:` passes validation but has no effect. The special `always` tag works on a role.
- `.j2` templates are Go templates. `range` over `printers` and `eq` work, so derived values can be computed while rendering.

See proposal.md for the list of duplicated and hardcoded settings.

## Goals / Non-Goals

**Goals:**
- One declaration per shared setting, so editing it in one place is enough.
- Settings that must agree are derived from each other, not copied.
- Bad or missing shared settings fail before the host is changed.
- Without host overrides, the rendered output is identical to today's.

**Non-Goals:**
- Moving `scan-to-share.sh` into `scan-web.py`. This change only makes the settings it would need available in one place.
- Implementing the `scanners:` list from the `network-scanning` spec. `scan_backend` uses that spec's value names so a later move is a smaller step.
- Changing `scan-web.py`, including its hardcoded Brother mode list (`MODES`).

## Decisions

### D1. Owner role's `defaults/` holds the declaration, not a shared vars file

Each shared setting is declared in the role that creates the thing it describes:
- `scan-share`: `scan_dir`, `scan_group`, `scan_user`.
- `scan-server`: `scan_backend`, the scan modes, resolution, JPEG quality, OCR, `scan_web_data_dir`.
- `print-server`: `printers`.

Consumers read them without redeclaring. This relies on the tested play-wide merge.

*Alternative:* a top-level `vars:` block or a `vars_files:` file holding all shared settings. This was rejected because it separates a setting from the role that documents and uses it, and it leaves play-level `vars:` unable to signal "this is a host override". Play-level `vars:` stay reserved for per-host overrides, as the commented `printers:` example in `site.yaml` already does.

### D2. Derive dependent values inside the template that consumes them

`scan-web-config.yaml.j2` computes:
- `print_queue`: `scan_web_print_queue` if set, otherwise the `name` of the `printers` entry with `default: true`.
- `default_mode`: `scan_web_default_mode` if set, otherwise `scan_escl_mode` when `scan_backend` is `escl`, else `scan_mode`.
- `default_res`: `scan_web_default_res` if set, otherwise `scan_resolution`.

The web-ui defaults for those three become empty strings, meaning "derive".

*Alternative:* compute them in a task. This was rejected because Tack has no `set_fact`, and the template is the only consumer.

### D3. `scan_backend` enum replaces the two booleans

`scan_backend: brscan4-emu | escl`, defaulting to `brscan4-emu`:
- Tasks use `when: scan_backend == "brscan4-emu"` or `"escl"`.
- Templates use `{{ if eq .scan_backend "escl" }}`.
- `airsane_enabled` stays a separate flag, still only meaningful on `brscan4-emu`.

The values match the `network-scanning` spec's `backend` names.

### D4. Merge `scan_samba_user` and `scan_web_user` into `scan_user`

The scan pipeline runs as the web UI service user and must own the share directory, so they are the same account by construction. Its value stays `scans`.

### D5. Validation runs in a `preflight` role first in `site.yaml`; per-role guards only check presence

- **`preflight` role.** A new role, tagged `always`, so any `--tags` run passes through it (`-r <role>` filtering still skips it). Its tasks only run `command` guards, so they change nothing on the host. It checks:
  - `scan_backend` is `brscan4-emu` or `escl`;
  - when `scan_web_print_enabled` and `scan_web_print_queue` is empty, exactly one `printers:` entry is marked `default: true`. Tack has no list filters, so this counts the `default:true` pairs in the list's rendered form. It is the only guard that runs on a stock config, and it shows as "changed" because commands always do.

  Validating in the first role is the only way to fail before `base` changes anything.
- **Per-role guards.** Each consuming role (`scan-server`, `web-ui`) starts with a guard that fails when a shared setting it reads `is not defined`. It names exactly the missing ones by checking which values rendered as `<nil>`. This covers a direct `tack run roles/<name>`, where the preflight role and the owner's defaults are absent.

*Alternative:* guards only at the start of each consuming role. This was rejected because by the time `web-ui` runs, `base` through `scan-server` have already changed the host.

### D5a. Guarding against reintroduced duplicates

The last-role-wins merge makes a re-added duplicate default silently override the owner. A `task check-vars` Taskfile target lists any top-level key declared in more than one `roles/*/defaults/main.yaml` and exits non-zero.

## Risks / Trade-offs

- **[Host overrides use the old names]** A host overriding `scan_samba_user`, `scan_web_user`, `scan_brscan4_enabled` or `scan_escl_enabled` would be silently ignored. → The preflight role fails when any of those old names `is defined`, naming the new setting.
- **[Behavior relies on an undocumented Tack merge rule]** A Tack upgrade could scope defaults per role. → The per-role presence guards (D5) turn that into a clear failure instead of empty paths. The scratch test is described in Context so it can be re-run.
- **[`escl` default mode vs the web UI's Brother mode list]** Under `escl`, the derived default mode `Color` is not in `scan-web.py`'s `MODES`. `run_scan` still passes it through (an unknown mode falls back to the default, which is `Color`), but the Scan tab's dropdown has no matching option to preselect. → This is accepted. It is the same as today when someone sets `scan_escl_enabled`, and it is the natural fix point for the `scan-to-share.sh` move.
- **[Derived queue when no printer is marked default]** → Caught by the preflight check (D5).

## Migration Plan

1. Land the change. For a host with no overrides, nothing else is needed.
2. Verify locally: re-render all role templates and re-run `tack export`, and compare them against the pre-change baseline. A `--check --diff` against the Pi isn't usable without the sudo password, because every root-owned file reads as changed. On the next apply, expect exactly one changed file, the `smb.conf` comment, which restarts Samba.
3. Hosts with overrides: rename them in `site.yaml` `vars:` (the preflight names each one).
4. Rollback: revert the commit. Nothing on the host changes in either direction.
