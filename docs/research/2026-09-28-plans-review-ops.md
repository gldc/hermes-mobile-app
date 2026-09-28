# Adversarial ops review of Plans P (plugin) and D (gateway bump), 2026-09-28

Scope:
- Plan P: `docs/superpowers/plans/cross-repo/2026-09-28-P-plugin-store-lock-and-pushes.md`.
- Plan D: `…/2026-09-28-D-gateway-bump-0.21.5.md`.
- Cross-checked against spec §6.5/§9/§10.2/§11, the assessment, the deploy runbook Phase B, the plugin at `65e6efd`, and upstream at `v2026.8.18`/`v2026.9.24`.

How the evidence was gathered:
- Read-only ssh to dc1-1 worked for the first few calls. After that, the 1Password agent refused signatures (`agent refused operation` / `communication with agent failed`), so a few box facts are unverified. Those are now pre-checked with STOPs in the plans.
- Nothing was written on the box.

Fixes were applied surgically to both plans. Each has a `## Revision log (review 2026-09-28)` at the top. The spec was not edited.

## Counts

| Plan | Critical | Major | Minor | Nit/Info |
|---|---|---|---|---|
| P | 0 | 1 | 7 | 4 |
| D | 0 | 5 | 9 | 4 |

## Box facts verified (read-only ssh, before the agent lapsed)

- `stat -f -c %T`: `/mnt/user/appdata` and `/mnt/user/appdata/hermes/data` = `fuse`. `mount` gives `shfs on /mnt/user type fuse.shfs`. `/mnt/cache` = btrfs. `mountpoint -d /mnt/user` = `0:45`, i.e. `/proc/locks` device `00:2d`.
- `/proc/locks` on shfs (`00:2d`): 15 POSIX locks, including SQLite's lock bytes at 128 and 1073741826 on hermes DBs, plus **one FLOCK, held by qdrant** (pid 26656). There is **no hermes flock on shfs**.
- The Slack token lock file `data/.local/state/hermes/gateway-locks/slack-app-token-*.lock` is a JSON pid record. Upstream implements it with `O_CREAT|O_EXCL` (8.18 `gateway/status.py:1597`), not flock. So the spec §9.1 / assessment §3 claim "flock already works on shfs, per the Slack token lock" rests on a wrong premise. qdrant's flock shows that acquiring one works. Exclusion across processes on shfs is still unproven, and Plan P Task 8 proves it.
- `data/mobile/devices.json`: `-rw------- 10000 10000`; `mailbox/` 0700 10000.

## Upstream facts verified (git show at both tags)

- Plugin `refresh_session`: anything that is not a `RefreshTokenError` becomes `ProviderError` (`auth_provider.py:108-109`). `DeviceStoreError` is not a `RefreshTokenError`.
- Core: `ProviderError` from a refresh gives a 503 and the cookies are kept:
  - 8.18 `middleware.py:462-468`;
  - 9.24 `middleware.py:192-196`, where the refresh runs in `run_in_threadpool`;
  - 9.24 `refresh_singleflight.py:73`: `ProviderError` is not cached.
  - So a lock timeout never forces a re-pair, at either tag.
- `pre_tool_call`:
  - 9.24 `plugins_dispatch.py`: `pre_tool_call` is in `_HOOK_TIMEOUT_FAIL_CLOSED_HOOKS`. A raise or a timeout becomes a block directive, and every call runs on a bounded worker thread.
  - 8.18: exceptions are logged and ignored.
  - At both tags, `_get_pre_tool_call_directive_details` passes `tool_name, args, task_id, session_id, tool_call_id, turn_id, api_request_id, middleware_trace`, and 9.24 adds `telemetry_schema_version`. Plan P's contract is correct.
- Clarify with **no** attached client: at 9.24 it waits in `open_requests` (`tui_gateway/session_transports.py:38-47`). It resolves empty at once only when every attached client is a pre-capabilities build. Plan P's comment implied the opposite; it is fixed.
- The upstream image has **no tailscale** and ships its own s6 `dashboard` service that honours `HERMES_DASHBOARD*`. The basic-auth env names are correct (`plugins/dashboard_auth/basic/__init__.py:195-223`). So the throwaway cannot join the tailnet.
- The seeded `.env` names at 9.24 match Plan D's list (11 names from `.env.example`, plus `API_SERVER_KEY`). `.dockerignore` keeps `!.env.example`.
- Both tags ship SQLite 3.53.4 (`SQLITE_AUTOCONF_VERSION=3530400`), so the in-image integrity checks are valid.
- The v29/v30 FTS migration runs inside `SessionDB.__init__` (the schema path), so Plan D's dry-run times the real thing. Caveat: a DB that still has legacy inline FTS returns True early, so `T_MIG` may be tiny.
- `messages.timestamp` is `REAL NOT NULL` epoch seconds (`hermes_state_common.py:411`).
- `dashboard-auth.log` is JSON lines (`audit.py`).
- The plugin repo is PUBLIC, so the anonymous https clone on the box works.

## Plan P findings

**P-M1 (Major, FIXED).** Task 0 step 4 copied the plan from the session scratchpad. The scratchpad is ephemeral, and after this review it is stale. The repo would have kept the pre-review text. It now copies from the app repo's reviewed copy, and it STOPs if the revision log is missing.

**P-m1 (Minor, FIXED; spec text is for the controller).** The flock evidence premise was wrong (see above). Plan P already treats shfs as a risk, and its tests have teeth: if flock is a no-op, both the cross-process test and the killed-holder test fail. Review Focus 1 now carries the real evidence. **Spec §9.1 and assessment §3 should drop "per the Slack token lock".**

**P-m2 (Minor, FIXED).** `_locked` gave the thread-lock wait and the flock wait each the full `lock_timeout`, so the worst case was 20 s. At 8.18 the refresh runs **on the dashboard event loop** (8.18 `middleware.py:457`). That 20 s would stall every dashboard request, and it happens only under cross-process contention such as a wedged CLI. Now one deadline covers both waits (`_flock(fd, deadline)`). There is no dedicated test: the existing timeout tests pass either way. Optional: add one if the implementer wants to pin it.

**P-m3 (Minor, FIXED).** Task 8 step 2 rsyncs into `/mnt/cache/compat/…`, and rsync creates only the last path component. Plan D Task 4 creates `/mnt/cache/compat` *later*. Added `mkdir -p`.

**P-m4 (Minor, FIXED).** Task 8 step 3 pulls the old base digest and never removes it, while Plan D budgets the vdisk tightly (15 GB free, STOP below 8 GB). Added:
- a `df` gate (≥11G);
- a record of whether the old base was present before;
- `docker rmi` in cleanup, only when this run pulled it.

The layers are shared with `hermes-dc1:local`, so the real cost is probably small.

**P-m5 (Minor, FIXED).** The cooldown comment and Review Focus 4 were wrong about when a 0.21.5 clarify resolves empty; see above. The push matters exactly when no client is attached, and then the question waits.

**P-m6 (Minor, FIXED).** Merging P arms it for the live box's **next restart on 0.20.4**, because boot pulls plugin `main`. There was no live check until the bump. The PR body now says so and carries the one-line `ls -ln /opt/data/mobile/` check plus a refresh.

**P-m7 (Minor, FIXED).** ssh goes through the 1Password agent, which prompts him per connection. It refused mid-review. Added a Global Constraint: get his approval first, use a ControlMaster connection, and treat a refused signature as a STOP.

Nit/Info:
- **P-n1 (FIXED):** Task 8's cleanup is now also required on the failure path.
- **P-n2 (Info):** a pure `os.fork()` without exec would inherit the flock's open file description and keep the lock held until the child exits. Python's `os.open` fds are non-inheritable across exec, and `subprocess` uses exec, so the risk is low. Waiters would get a transient 503, never a re-pair.
- **P-n3 (Info):** if root creates the store **directory** (a fresh install with root `pair`), it stays root-owned 0700. This is pre-existing and not the case on dc1-1.
- **P-n4 (Info):** lock ordering is consistent (thread lock, then flock; release in reverse), so there is no deadlock. There is no nesting: `_save` and `_open_lock_file` never re-enter `_locked`, and readers are lock-free. Lock-file creation races are benign: `O_CREAT` without `O_EXCL`, the file is never unlinked, and root's chown follows the open. The same process on another fd conflicts, as flock semantics require (the provider test relies on this).

Checked and fine:
- The `on_pre_tool_call` design: it returns None on every path, catches Exception on the hook path, pushes on a daemon thread, and the non-clarify path touches nothing.
- The `(device, route)` cooldown keying, and the device targeting that reuses `resolve(session_id, task_id)` exactly as `on_session_end` does.
- The coalesced skip.
- The Task 6 mutation proof.
- Task 8's uid-10000 and root runs: the plugin is mounted ro, everything is written to container `/tmp` or the dedicated shfs scratch dir, and exit codes are gated.
- The Spec line, Global Constraints, Review Focus, and the PR plus adversarial-review gate are present.

## Plan D findings

**D-M1 (Major, FIXED).** Task S step 5 captured `gen-password-hash.sh`'s stdout into `HASH`. The script's `read -rsp …; echo` prints an **empty line first**, so `HASH` began with `\n`, and `case scrypt\$*` could never match. The result was a false STOP every time, or a hand-edited hash. It now extracts the value with `grep -o 'scrypt[$][^[:space:]]*'`.

**D-M2 (Major, FIXED).** Task 1 step 3 copied the plan and the assessment from the ephemeral scratchpad, which holds the pre-review text. It now copies from the app repo's reviewed copies, with a STOP if they are missing. It also creates `docs/superpowers/plans`.

**D-M3 (Major, FIXED).** Exit-code gates: the pytest runs in Tasks 1.2, 3.9, 4.2 and 11.6 were `… 2>&1 | tail -1`, and the dry-run in 5.5 was `| tee`. That breaks the plan's own Global Constraint and his standing rule (the PR #2 red-merge lesson). Each now captures and prints `exit=`. Task 4.2's expectation is corrected to the **root** figure (`193 passed, 1 skipped`), because those containers run as root.

**D-M4 (Major, FIXED).** Task 8 step 4's `tar` of 21 named paths STOPs on any missing path. That check happened **mid-outage**, and nothing verified the list first. The reviewer could not re-check it after the ssh lapse. New Task 7 step 5 checks every path before the stop, with a rule to drop a genuinely absent path from both the tar list and the runbook text.

**D-M5 (Major, FIXED).** Task 13 step 2 (the post-QA burst check, which **gates the merge**) ran the Python-log timestamp `awk` over `dashboard-auth.log`. That file is JSON lines. `{` sorts after digits, so every historic line passes, and the grepped strings are not the logged event names (`refresh_failure`). The outcome was either a false alarm that blocks the merge, or a silent pass. It now:
- uses `jq` with `.ts >= BOOT_TS(ISO)` and `.event`;
- requires the file to exist;
- requires a non-zero `refresh_success` count, proving the burst ran;
- requires `refresh_failure` = 0.

Minor:
- **D-m1 (FIXED).** Task 0 step 2 gated only on A and B. Spec §11 item 5 says the bump runs only after "2–4" (A, B **and C**) are verified. C is added.
- **D-m2 (FIXED; runbook change, see decisions).** Downtime: the build ran after the stop. It is now a pre-build in new Task 7 step 4. This is safe:
  - containers are pinned to image IDs;
  - `pre-0.21.5` is already tagged;
  - a restart-policy restart keeps the old ID;
  - it is guarded by "never `compose up` until Task 8" and by assertions (old container still on the old ID; `:local` new; rollback tag = running image).

  Task 8.9's build is then a cache hit. The outage estimates and the step 9 failure path are updated: `start` still works, and if `up` already removed the container, check the schema version before choosing a plain retag or the full Task 10.
- **D-m3 (FIXED).** CI first ran in Task 12, **after** the deploy. New Task 3 step 11 pushes the branch, opens a **draft** PR and gates on `gh pr checks --watch` `exit=0`. Task 6 requires a clean worktree whose HEAD equals the PR head. Task 12 now edits the body and runs `gh pr ready`.
- **D-m4 (FIXED).** Task 8 step 3's WAL loop used a bare glob. A clean last close may delete `-wal`, which gave a literal `*.db-wal` and a stat error that read like a failure. It now uses `nullglob`, and "absent" counts as clean.
- **D-m5 (FIXED).** The autonomous rollback "before his QA traffic" was an assumption, and Slack is live from boot. Added a measured count of post-boot `messages` rows: non-zero makes the rollback his call. Also a `skills/` restore note (if the curator archived something).
- **D-m6 (FIXED).** Plan P's hand-off check (`devices.json` and `devices.json.lock` owned by 10000) was not in acceptance. It is added to A8; a `0:0` owner is a STOP.
- **D-m7 (FIXED, unverified facts).** Host `jq`/`openssl`/`nsenter`/`ss`, and the live plugin checkout's owner and remote, were assumed. Task S step 1 now checks the tools. Task 7 step 3 prints the owner and remote. A root-owned tree or an ssh remote is a STOP (git "dubious ownership" / no key for uid 10000), never an auto-fix.
- **D-m8 (FIXED).** The throwaway ran Plan P's *branch*. If review fixes move it, A/B signed off against stale code. Added `S_PLUGIN_SHA`, recorded and handed to A/B, with a fast-forward-and-restart procedure. Task 0 requires the SHA in the sign-offs.
- **D-m9 (FIXED).** ssh uses 1Password approvals. Plan D issues dozens of ssh calls, including inside the outage. Added a ControlMaster procedure and "approve before Task 8 step 2; a refusal mid-outage is a STOP for him". Task 8 step 1 now checks the master (`ssh -O check`).

Nit/Info:
- **D-n1:** Task 8 has no step 7 (5, 6, 8, 9, 10). Cosmetic, left alone: renumbering would break about ten cross-references.
- **D-n2 (FIXED):** the throwaway runs real commands with LAN egress and live provider keys, so the §10.2 "dangerous command" scenario must use a harmless target.
- **D-n3 (Info):** memory says dc1-1 has run Unraid 7.3.2's **built-in Tailscale plugin** since 2026-09-18. The runbook B6 / A12 text says "dc1-1 has no host tailscale". This does not affect the throwaway: the publish is 127.0.0.1-only, and step 7 asserts nothing on `0.0.0.0:19119`. The runbook sentence may be stale; see decision 4.
- **D-n4 (Info):** the dry-run does not copy `SOUL.md`, so config-migration step 41 is not rehearsed. The assessment already found it a no-op.

Checked and fine:
- The throwaway's secrets:
  - env filtered by name to 4 provider keys, with no `SLACK_*`/`TS_*`/dashboard credentials;
  - the file is 0600 root and removed at teardown, and a `$$` check is present;
  - the password lives only in a 0600 scratch file and never in chat.
- The publish is `127.0.0.1:19119` with a LAN negative check. There is no tailscale in the image.
- A fresh data dir, and nothing mounted from the live tree.
- The dry-run is isolated:
  - the snapshot uses the SQLite backup API from a `mode=ro` connection into the container's `/tmp`, then `docker cp`s to a separate shfs dir;
  - `HERMES_HOME=/w`, so there is no shared WAL and nothing is written under `…/hermes/data`;
  - the copy is deleted in step 9.
- The config edits are exact, rehearsed on a copy, applied before first boot, each with its own `.bak`, and verified by a semantic diff.
- Rollback:
  - the label is asserted;
  - `config.yaml`, `state.db` and `kanban.db` are restored;
  - `-wal`/`-shm` and the seeded `.env` are moved aside;
  - `mobile/` is never restored;
  - the conversation loss is stated.
- Merge happens only after `qa pass`, with CI exit 0.
- The wiki follows `AGENTS.md`: `pull --rebase`, one `sync:` commit, push, `updated:` bumped. The pages and line refs exist.
- Privileged gates stay his: the newer tag, pruning, Tailscale on the Mac, the rollback after QA, and the QA itself.

## Needs a human decision / the controller

1. **Spec §9.1 and assessment §3:** delete "flock already works on this shfs path, per the Slack token lock". The Slack lock is an `O_EXCL` pid record. Replace it with: "acquisition works on shfs (qdrant holds one); exclusion proven by Plan P Task 8". The approved spec was not edited.
2. **ssh approvals:** Plans P (Task 8) and D (Task S, and Tasks 4–10 including the outage) need him to approve the 1Password ssh agent, ideally for the whole session. Otherwise the executor stalls, possibly mid-outage. The plans now say to get approval up front and to use ControlMaster.
3. **Build-before-stop (D Task 7 step 4)** changes his Phase B runbook: `:local` points at 0.21.5 while the 0.20.4 container still serves. It is safe by construction and it shortens the outage, but he may prefer the old order. The change is revertible by deleting that step.
4. **Host tailscale on dc1-1:** confirm whether Unraid's Tailscale plugin is active. If it is, the runbook's "dc1-1 has no host tailscale" is stale, and the host itself could serve as an A12 cross-node probe source only if it is a *different* node from the container.
5. **Unverified box facts** (ssh lapsed): the host tools, the plugin checkout's owner and remote, the backup-list paths, and the vdisk free space. Each is now a pre-check with a STOP. If any fails, the call is his.
