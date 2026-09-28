# Plan D — Gateway bump to hermes 0.21.5 (v2026.9.24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> This is mostly an **ops runbook**. Code-changing steps are RED→GREEN. Ops steps give the exact command, the expected output, and a **STOP** condition. A STOP means: do not run the next step; record what you saw; if the STOP names Gianluca, message him with the evidence and a ready-to-run next command, then wait.

## Revision log (review 2026-09-28)

Adversarial ops review; findings in the controller's scratchpad `plans-review-ops.md`. Changes:
1. **Task S step 5:** `scripts/gen-password-hash.sh` prints an empty line (the `echo` after `read -rsp`) before the hash. So `HASH` began with a newline, and the `scrypt$*` check failed **every** time. The hash is now extracted with `grep -o`.
2. **Task 1 step 3:** it copied this plan and the assessment from the ephemeral session scratchpad, which holds the pre-review text. It now copies from the app repo's committed copies.
3. **Exit-code gates:** these pytest runs piped `| tail -1` and so gated on nothing:
   - Task 1.2, 3.9, 4.2 and 11.6. Each now prints its own `exit=`, per this plan's Global Constraint.
   - Task 5.5 (`| tee`): it now captures the exit code.
4. **New Task 7 step 5:** a pre-stop check that every path in the cold-backup list exists. Task 8 step 4's `tar` STOPs on a missing path, and before this it did so **during the outage**.
5. **New Task 7 step 4:** the image is built **before** the stop.
   - This is safe: a container is pinned to its image ID, and `pre-0.21.5` is already tagged.
   - Task 8 step 9's build then becomes a cache hit, so the build leaves the downtime window.
6. **Task 3 step 11 (new):** push the branch and open a **draft** PR, then gate the box sync (Task 6) on CI `exit=0`. Before, CI first ran after the deploy. Task 12 now marks the draft ready.
7. **Task 0 step 2:** the gate now also requires Plan C. Spec §11 item 5 says deploy only after 2–4 are verified.
8. **Task 8 step 3:** a `-wal` file deleted by a clean close counts as clean; the bare glob printed a false alarm.
9. **Task 9 A8:** a `mobile/` ownership check (Plan P's hand-off: `devices.json` and `.lock` owned by 10000).
10. **Task 10:** before an autonomous rollback, check for post-bump conversations. Slack is live, so a rollback would lose them, and then the rollback is his call. The `skills/` restore note is added.
11. **Task 13 step 2:** `dashboard-auth.log` is **JSON lines** (`{"ts":…,"event":"refresh_failure"}`, `hermes_cli/dashboard_auth/audit.py`). The Python-log awk passed every historic line (`{` sorts after digits), and the grep strings are not event names. It now uses `jq` on `.ts`/`.event`, and it gates the merge.
12. **Task S step 1 and Task 7:** check the host tools (`jq`, `openssl`, `nsenter`, `ss`) and the ownership and remote of the live plugin checkout **before** relying on them. The reviewer could not re-verify these: the 1Password ssh approval lapsed mid-review. The ssh-approval note is added to the Global Constraints.
13. **Task S:** if Plan P's branch head moves after its review, refresh the throwaway checkout, and record the SHA that A/B tested against.

**Goal:** Move the live dc1-1 gateway from hermes 0.20.4 (`v2026.8.18`) to 0.21.5 (`v2026.9.24`) through runbook Phase B, with the assessment's ★ additions, a rehearsed one-way migration, a DB-restoring rollback, and his on-device QA as the gate.

**Architecture:** Merge PR #29 first, branch `chore/base-bump-2026.9.24` off the new `main`, re-pin `IMAGE` + `ARG BASE` (RED→GREEN sync test), prove compat in the new base, rehearse the migration on an online copy of the live DB on the same `shfs` filesystem, then do Phase B B3→B6 on the box. A throwaway 0.21.5 container on dc1-1 (loopback-only, SSH-tunnelled) serves Plans A/B's integration testing before any of that.

**Tech Stack:** Docker Compose v2.40.3 on Unraid 7.3.2 (dc1-1), s6-overlay, SQLite 3.53.4 (in-image), Python 3.13 (in-image; dc1-1 has **no** host python3), pytest + ruff 0.14.10 (CI), `gh` CLI, rsync over SSH.

**Spec:** `~/Developer/hermes-mobile-app/docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md` §9.2 (NORMATIVE: executes the bump assessment's **Steps** and **Acceptance** verbatim, plus additions) and §10.2 (throwaway container). The bump assessment (`docs/research/2026-09-28-bump-0.21.5-assessment.md` once committed in Task 1) is the normative step/acceptance list; spec review `docs/research/2026-09-28-spec-review.md` M9, m18, m19, m20 in the app repo. Runbook: `docs/dc1-runbook.md` Phase B (and L2/L8 for the rsync + preflight it reuses). Executors read the spec §9.2 + §10.2 and the assessment §5b/§6 alongside this plan.

## Global Constraints

Values used verbatim throughout (shell variables are written as `$NAME`; define them once per shell):

```bash
NEW_DIGEST=sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7
NEW_IMAGE=nousresearch/hermes-agent@$NEW_DIGEST          # index digest of tag v2026.9.24
NEW_REV=f97608f178d1ffeca59860195ab7da295f7c8e5f         # label revision = tag commit
OLD_DIGEST=sha256:22e37bb4ed1b0f50cb6bd991dca7ecacd6c9f29df9b4a20fc989d32bc763ccf6
OLD_REV=e624e9fde561e1add9388384012b295fde669ade         # label on hermes-dc1:local today (= v2026.8.18)
BOX=/mnt/user/appdata/hermes                              # deploy tree on dc1-1 (shfs)
WT=~/Developer/hermes-deploy-bump-0215                    # git worktree for this plan (Task 1)
BRANCH=chore/base-bump-2026.9.24
SCRATCH=<the executing session's scratchpad dir>          # never commit anything from here
P_SHA=<gldc/hermes-mobile-plugin main SHA recorded in Task 0 step 1>
```

- PR-only; **never push `main`**. This repo squash-merges (`… (#NN)` subjects). `gh` must be the `gldc` account.
- CI is gated on **exit codes**: `gh pr checks <N> -R gldc/hermes-deploy --watch; echo "exit=$?"` must print `exit=0`. Never `| tail`, never `cmd && echo OK`.
- Target is **`v2026.9.24` only**. Never stop on 0.21.0 (8.31) or 0.21.1 (9.7). A newer `v2026.9.2x`/`v2026.10.x` tag on execution day is a STOP for Gianluca, not an auto-upgrade.
- rsync to the box **never** uses `--delete`; `docker compose config` is **never** run outside a pipe (it prints every secret).
- Tenant checks run as uid 10000 **via `bash -lc`** in the live container (a login shell restores the shim PATH); exec-permission proofs only via `/command/s6-setuidgid`.
- Rollback target is **only** `hermes-dc1:pre-0.21.5`. `pre-0.20.4`, `pre-L`, `preperuid` are 0.18.2 builds (label `5988fe6c`). **`preperuid` is never retagged to `:local`.**
- Rollback restores `config.yaml`, `state.db` (no `-wal`/`-shm`), `kanban.db` from the tarball and **states that post-bump conversations are lost**. It **never restores `mobile/`** (old RT hashes bounce every phone to re-pair).
- Config edits on the box: `cp -p data/config.yaml data/config.yaml.bak-YYYYMMDD-<reason>` **before each edit**; the file stays `0640 10000:10000`.
- His decisions: `compression.threshold_tokens: null`; `curator.prune_builtins: false` (the migrated 14/30-day windows stay); `plugins.enabled` keeps **both** `hermes-mobile` and `mobile` (#67069 still open).
- **No second profile** ever (`data/profiles` must not exist): multiplex would arm a secret scope built only from `<profile>/.env`, and every secret here is container-env only.
- Integrity checks use the **in-image SQLite 3.53.4**. The host `sqlite3` on dc1-1 is **3.53.3** — never use it on these DBs.
- Secrets: never print values. Env files are filtered **by name**. The throwaway container gets **no** `SLACK_*`, `TS_*` or dashboard credentials from the live `.env`.
- Acceptance means **bodies and real calls, never status codes alone**.
- dc1-1 docker vdisk: **15 GB free of 50 GB** at planning time; base + build + probe ≈ 7–9 GB. Any docker-heavy step checks `df` first (STOP below 8 GB; pruning old tags or build cache is his call).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Deployed ≠ done: his on-device QA (spec §10.3) is the gate for merging the bump PR.
- ssh to dc1-1 signs through the **1Password agent**, which asks Gianluca to approve each connection. During the 2026-09-28 review it began refusing mid-session (`agent refused operation`). Handle it this way:
  - Before Task S and again before Task 8, message him to approve.
  - Keep one master open, and pass the same `ControlPath` on every later ssh. `ssh -O exit` closes it at the end.

    ```bash
    ssh -o ControlMaster=auto -o ControlPersist=60m \
        -o ControlPath="$HOME/.ssh/cm-%r@%h:%p" -fN root@dc1-1.local
    ```

  - **During the outage (Task 8), a refused signature is a STOP for him.** Have him approve before Task 8 step 2, never after.

## Review Focus

Most likely to bite first. Each line has a check in the owning task.

1. **The migration runs long while the box is down.** The v30 trigram-FTS rebuild on the 178 MB `state.db` over `fuse.shfs`, under a 600 s startup lease. Expect a measured, bounded outage. → Task 5 times it on an online copy **on shfs**, and STOPs above 450 s. Task 8 step 10 watches it with a deadline and forbids a restart mid-migration.
2. **The FTS rebuild fails or starts from a malformed index.** This happened in June and August. A failed v29/v30 holds `schema_version` back and repeats on every boot. → Task 5: `integrity_check` before and after the migration on the copy, schema must reach 30. Task 8 step 5: `integrity_check` on the cold backup, with a rebuild under 0.20.4 if it is malformed. Task 9 A4: `hermes doctor`, schema 30, `integrity_check` on a post-boot copy. A schema stuck below 30 is a rollback trigger.
3. **The control socket on shfs (#123761).** An AF_UNIX bind on a bind-mounted `fuse.shfs` HERMES_HOME may fail with EOPNOTSUPP. It should be non-fatal, but it must not be mistaken for (or mask) a gateway that never reached `running`. → Task S step 7 observes it first on a shfs data dir. Task 9 A7 records it and requires `gateway_state: running` independently.
4. **The multiplex/secret-scope hazard.** A second profile flips the box to multiplex, and `UnscopedSecretError` then kills provider auth and Slack. → Task 8 step 9: the preflight refuses to build if `data/profiles` exists. Task 9 A5: `multiplex_standalone_reason` + no `data/profiles`, plus the log grep in A7. Task 11 adds a STATE.md gotcha.
5. **The plugin pull fails at boot**, and 0.21.5 runs the old unlocked DeviceStore under threadpool refresh. `04-install-plugins` only prints "pull skipped" and carries on. → Task 7 step 3 pre-pulls as uid 10000 and asserts `P_SHA`. Task 9 A8 re-asserts the SHA and `✓ mobile connected`, and checks the `/me` JSON with a real device session.
6. **(Found while planning) First boot seeds `/opt/data/.env` from `.env.example`.** At 9.24 the example is no longer dockerignored, and the file loads with `override=True`. The assessment says "holds only `API_SERVER_KEY`", which is wrong. A seeded line naming a compose secret would silently override it. → Task S step 6 captures the exact seeded key set. Task 9 A6 requires the live `.env` to hold exactly that set plus `API_SERVER_KEY` and **no** compose env name. Task 11 corrects the assessment and STATE.md.

---

## Task S — Throwaway 0.21.5 integration container on dc1-1 (spec §10.2)

**Runs before Task 0**, as soon as Plan P's branch is pushed. It is the environment Plans A and B use for their §10.2 scenarios. Tear it down (step 11) once A and B have signed off their §10.2 lists, and in any case before Task 8.

**Files:** none in the repo. On the box: `/mnt/user/appdata/hermes-test-0215/` (data dir) and `/mnt/user/appdata/hermes-test-0215.env` (0600 root). On the Mac: `$SCRATCH/throwaway-0215.creds` (0600).

**Interfaces:**
- Consumes: `PLUGIN_REF`, Plan P's branch name. After Plan P merges, use `main`.
- Produces: URL `http://127.0.0.1:19119` (through the tunnel), user `qa`, password in `$SCRATCH/throwaway-0215.creds`; container `hermes-test-0215`; `$SCRATCH/env-example-keys-0215.txt`, the seeded `.env` key set that Task 9 A6 compares against; control-socket evidence for Task 9 A7.

- [ ] **Step 1: Preconditions**

```bash
ssh root@dc1-1.local 'df -BG --output=avail /var/lib/docker | tail -1
ss -ltn | grep -c ":19119 " || true
test ! -e /mnt/user/appdata/hermes-test-0215 && test ! -e /mnt/user/appdata/hermes-test-0215.env && echo absent
docker ps -a --filter name=^hermes-test-0215$ -q | wc -l
for t in jq openssl nsenter ss git; do command -v "$t" >/dev/null || echo "MISSING $t"; done; echo tools-checked'
git ls-remote https://github.com/gldc/hermes-mobile-plugin "refs/heads/$PLUGIN_REF"
```
Expected: `≥8G` (e.g. `15G`), `0`, `absent`, `0`, `tools-checked` with no `MISSING` line before it, and one `<sha>\trefs/heads/<PLUGIN_REF>` line. **STOP** if:
- avail < 8G (pruning is his call);
- any tool is `MISSING`. This plan uses the host's `jq`/`nsenter`/`ss` throughout, and the review could not re-verify them;
- the ref is missing. The plugin repo is PUBLIC, so the anonymous https clone works.

- [ ] **Step 2: Pull the target image and prove what it is**

```bash
ssh root@dc1-1.local "docker pull $NEW_IMAGE >/dev/null && docker image inspect $NEW_IMAGE --format '{{index .Config.Labels \"org.opencontainers.image.revision\"}} {{.Config.User}} {{json .Config.Entrypoint}}'
docker run --rm --entrypoint /opt/hermes/.venv/bin/hermes $NEW_IMAGE --version | head -1
docker run --rm --entrypoint /usr/bin/python3 $NEW_IMAGE -c 'import sqlite3;print(sqlite3.sqlite_version)'
df -BG --output=avail /var/lib/docker | tail -1"
```
Expected: `f97608f178d1ffeca59860195ab7da295f7c8e5f root ["/opt/hermes/docker/entrypoint-dispatch.sh"]`, then `Hermes Agent v0.21.5 (2026.9.24)`, `3.53.4`, and roughly 3 GB less free. **STOP** if the revision or version differs.

- [ ] **Step 3: Fresh data dir + plugin checkout of Plan P's code**

```bash
ssh root@dc1-1.local "bash -s -- $PLUGIN_REF" <<'SH'
set -eu
D=/mnt/user/appdata/hermes-test-0215
install -d -o 10000 -g 10000 -m 0700 "$D" "$D/plugins"
git clone --quiet --branch "$1" https://github.com/gldc/hermes-mobile-plugin "$D/plugins/hermes-mobile"
git -C "$D/plugins/hermes-mobile" log -1 --format='%H %s'
chown -R 10000:10000 "$D"
stat -c '%a %u:%g' "$D"
SH
```
Expected: the SHA from step 1 and its subject, then `700 10000:10000`. Record the SHA as `S_PLUGIN_SHA`: A/B's sign-off is against that code.

**If Plan P's branch head moves later** (review fixes), fast-forward the throwaway's checkout and restart it. Tell the A/B executor the new `S_PLUGIN_SHA`, because scenarios run before the move tested old code.

```bash
ssh root@dc1-1.local 'docker exec -u 10000 hermes-test-0215 git -C /opt/data/plugins/hermes-mobile pull --ff-only --quiet \
  && docker exec -u 10000 hermes-test-0215 git -C /opt/data/plugins/hermes-mobile log -1 --format=%H \
  && docker restart hermes-test-0215 >/dev/null && echo restarted'
```

- [ ] **Step 4: Env file: model-provider keys only, filtered by name**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -eu; umask 077
E=/mnt/user/appdata/hermes-test-0215.env
grep -E '^(KIMI_API_KEY|OPENROUTER_API_KEY|GOOGLE_API_KEY|DASHSCOPE_API_KEY)=' /mnt/user/appdata/hermes/.env > "$E"
cat >> "$E" <<EOF
HERMES_HOME=/opt/data
HERMES_DASHBOARD=1
HERMES_DASHBOARD_HOST=0.0.0.0
HERMES_DASHBOARD_PORT=9119
HERMES_DASHBOARD_BASIC_AUTH_USERNAME=qa
HERMES_DASHBOARD_BASIC_AUTH_SECRET=$(openssl rand -base64 32)
HERMES_GATEWAY_BOOTSTRAP_STATE=running
HERMES_DISABLE_LAZY_INSTALLS=1
TERMINAL_BACKEND=local
EOF
chmod 0600 "$E"
sed 's/=.*//' "$E"
grep -c '[$][$]' "$E" || true
grep -cE '^(SLACK_|TS_|HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH)' "$E" || true
SH
```
Expected: 13 names (`KIMI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DASHSCOPE_API_KEY`, then the nine above), then `0`, then `0`. **STOP** if the `$$` count is not 0. Compose un-escapes `$$` and `docker run --env-file` does not, so such a key would arrive broken.
`HERMES_DASHBOARD_HOST=0.0.0.0` is **inside the container's netns**. It is required so Docker's port publish can reach the dashboard, and the loopback-only exposure comes from `-p 127.0.0.1:…` in step 6.

- [ ] **Step 5: Throwaway password + hash (the repo's script, run against the new image)**

```bash
umask 077
PW=$(openssl rand -base64 18 | tr -d '/+=')
printf 'url=http://127.0.0.1:19119\nuser=qa\npassword=%s\n' "$PW" > "$SCRATCH/throwaway-0215.creds"
# The script's `read -rsp …; echo` prints an EMPTY LINE before the hash on stdout, so take the
# scrypt token itself rather than the whole output (review 2026-09-28).
HASH=$(printf '%s\n' "$PW" | ssh root@dc1-1.local "bash /mnt/user/appdata/hermes/scripts/gen-password-hash.sh $NEW_IMAGE" 2>/dev/null \
  | grep -o 'scrypt[$][^[:space:]]*' | head -n1)
case "$HASH" in scrypt\$*) echo hash-ok ;; *) echo "STOP: no scrypt hash" ;; esac
printf 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH=%s\n' "$HASH" | ssh root@dc1-1.local 'cat >> /mnt/user/appdata/hermes-test-0215.env'
```
Expected: `hash-ok`. The hash is written **without** `$$` doubling, because `--env-file` is literal. **STOP** on `STOP: no scrypt hash`, which means `plugins.dashboard_auth.basic.hash_password` moved at 0.21.5. Locate it with `docker run --rm --entrypoint /bin/sh $NEW_IMAGE -c 'grep -rn "def hash_password" /opt/hermes/plugins/dashboard_auth'`, then fix `scripts/gen-password-hash.sh` in Task 3's commit as a RED→GREEN item.

- [ ] **Step 6: Start (first boot seeds config.yaml + .env) and capture the seeded .env key set**

```bash
ssh root@dc1-1.local "docker run -d --name hermes-test-0215 --restart no \
  -p 127.0.0.1:19119:9119 \
  --env-file /mnt/user/appdata/hermes-test-0215.env \
  -v /mnt/user/appdata/hermes-test-0215:/opt/data \
  $NEW_IMAGE gateway run && sleep 60 && docker logs hermes-test-0215 2>&1 | tail -30"
ssh root@dc1-1.local 'bash -s' <<'SH' | tee "$SCRATCH/env-example-keys-0215.txt"
docker exec hermes-test-0215 stat -c '%a %U:%G' /opt/data/.env
docker exec hermes-test-0215 sh -c "grep -vE '^[[:space:]]*(#|\$)' /opt/data/.env | cut -d= -f1 | sort"
SH
```
There is **no `--init`**, and there must never be one (PID-1 guard).
Expected: the logs show stage2 lines including `[stage2] Generated API_SERVER_KEY for the loopback gateway api_server`. The first line of the tee'd output is `600 hermes:hermes`, and the names are exactly `API_SERVER_KEY BROWSERBASE_ADVANCED_STEALTH BROWSERBASE_PROXIES BROWSER_INACTIVITY_TIMEOUT BROWSER_SESSION_TIMEOUT IMAGE_TOOLS_DEBUG MOA_TOOLS_DEBUG TERMINAL_LIFETIME_SECONDS TERMINAL_MODAL_IMAGE TERMINAL_TIMEOUT VISION_TOOLS_DEBUG WEB_TOOLS_DEBUG` (one per line, sorted). **STOP** if any name from the live compose `.env` appears (`KIMI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DASHSCOPE_API_KEY`, `SLACK_*`, `HERMES_*`, `TS_AUTHKEY`, `TERMINAL_BACKEND`). With `override=True` it would shadow the container env on the live box. That is Review Focus 6: take it to Gianluca before Task 8.

- [ ] **Step 7: Seed the config to mirror live behaviour, restart, verify**

```bash
ssh root@dc1-1.local 'docker exec -i -u 10000 hermes-test-0215 /opt/hermes/.venv/bin/python -' <<'PY'
import pathlib, yaml
p = pathlib.Path("/opt/data/config.yaml")
c = yaml.safe_load(p.read_text()) or {}
c["model"] = {"provider": "kimi-coding", "default": "k3", "base_url": "https://api.kimi.com/coding"}
c["fallback_providers"] = [{"provider": "openrouter", "model": "z-ai/glm-5.2",
                            "base_url": "https://openrouter.ai/api/v1"}]
en = c.setdefault("plugins", {}).setdefault("enabled", [])
for n in ("hermes-mobile", "mobile"):
    if n not in en:
        en.append(n)
c.setdefault("approvals", {})["mode"] = "manual"
c.setdefault("agent", {})["clarify_timeout"] = 600
c.setdefault("display", {})["busy_input_mode"] = "interrupt"
c.setdefault("compression", {})["threshold_tokens"] = None
p.write_text(yaml.safe_dump(c, sort_keys=False))
print("seeded")
PY
ssh root@dc1-1.local 'bash -s' <<'SH'
docker restart hermes-test-0215 >/dev/null; sleep 60
D=/mnt/user/appdata/hermes-test-0215
docker exec hermes-test-0215 hermes --version | head -1
docker exec -u 10000 hermes-test-0215 hermes config get compression.threshold_tokens
nsenter -t "$(docker inspect -f '{{.State.Pid}}' hermes-test-0215)" -n ss -ltn | awk 'NR>1{print $4}' | sort
ss -ltn | awk '$4 ~ /:19119$/ {print "host:", $4}'
jq -c '{gateway_state, multiplex_standalone_reason, platforms: (.platforms|map_values(.state))}' "$D/gateway_state.json"
grep -hi "control socket" "$D"/logs/*.log | tail -3
grep -h "mobile connected" "$D"/logs/gateway.log | tail -1
test ! -e "$D/profiles" && echo "no profiles dir"
docker exec -u 10000 hermes-test-0215 hermes chat -q "reply with the word ok" 2>&1 | tail -5
SH
```
Expected, in order:
- `seeded`;
- `Hermes Agent v0.21.5 (2026.9.24)`;
- `None` (or `null`);
- listeners including `0.0.0.0:9119` and `127.0.0.1:8642`;
- `host: 127.0.0.1:19119` (and nothing on `0.0.0.0:19119`);
- `{"gateway_state":"running","multiplex_standalone_reason":"…only one profile…","platforms":{"mobile":"connected"}}` (no `slack`);
- the control-socket line, **recorded verbatim** (bound, or EOPNOTSUPP: either is acceptable; record which for Task 9 A7 and STATE.md);
- a `✓ mobile connected` line;
- `no profiles dir`;
- a reply containing `ok`.

**STOP** if `gateway_state` is not `running`, if `mobile` is not `connected`, or if 19119 is bound on anything but 127.0.0.1.

- [ ] **Step 8: SSH tunnel from the Mac + dashboard smoke (bodies, not codes)**

```bash
ssh -f -N -o ExitOnForwardFailure=yes -L 19119:127.0.0.1:19119 root@dc1-1.local
PW=$(sed -n 's/^password=//p' "$SCRATCH/throwaway-0215.creds")
curl -s http://127.0.0.1:19119/login | grep -o '<title>[^<]*</title>'
curl -s -H 'Host: localhost:19119' http://127.0.0.1:19119/login | grep -o '<title>[^<]*</title>'
curl -m 5 -s -o /dev/null -w 'lan=%{http_code}\n' http://dc1-1.local:19119/login
rm -f "$SCRATCH/tt.jar"
curl -s -c "$SCRATCH/tt.jar" -H 'Content-Type: application/json' \
  -d "{\"provider\":\"basic\",\"username\":\"qa\",\"password\":\"$PW\"}" http://127.0.0.1:19119/auth/password-login; echo
curl -s -b "$SCRATCH/tt.jar" -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:19119/api/auth/ws-ticket | jq -r 'has("ticket")'
curl -s -b "$SCRATCH/tt.jar" http://127.0.0.1:19119/api/plugins/mobile/me; echo
```
Expected:
- `<title>Sign in — Hermes Agent</title>` twice. The Host guard accepts both loopback spellings because the dashboard is bound `0.0.0.0` in-container.
- `lan=000` (refused: no LAN exposure).
- A login body with `"ok": true`.
- `true`.
- `{"detail":"mobile device session required"}`. That is the plugin's own 403 body, which proves the #67069 gate mounted the route. `{"detail":"Not Found"}` = **STOP**.

- [ ] **Step 9: Device-session `/me` and a scripted concurrent-refresh smoke (lost-update detector)**

```bash
ssh root@dc1-1.local 'docker exec -i -u 10000 hermes-test-0215 bash -s' <<'SH'
set -eu
B=http://127.0.0.1:9119; T=$(mktemp -d)
for n in 1 2 3 4; do
  P=$(hermes mobile pair --name "burst-$n" --url "$B" | grep -m1 -o '{.*}')
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); open(sys.argv[2],"w").write(d["rt"]); print(d["device_id"])' "$P" "$T/rt$n" >> "$T/ids"
done
for n in 1 2 3 4; do   # four different RTs refresh concurrently -> four threadpool refreshes
  curl -s -c "$T/jar$n" -b "hermes_session_rt=$(cat "$T/rt$n")" "$B/api/plugins/mobile/me" > "$T/me$n" &
done; wait
for n in 1 2 3 4; do   # each device presents ONLY its rotated RT; a lost update makes it unknown
  RT2=$(awk '$6 ~ /hermes_session_rt$/ {print $7}' "$T/jar$n")
  curl -s -b "hermes_session_rt=$RT2" "$B/api/plugins/mobile/me" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("name"), d.get("revoked"))'
done
while read -r id; do hermes mobile revoke "$id" >/dev/null; done < "$T/ids"
rm -rf "$T"; echo burst-done
SH
```
Expected: `burst-1 False`, `burst-2 False`, `burst-3 False`, `burst-4 False`, `burst-done`. A `None None` line, or a traceback, is a lost rotation. **STOP**, and send it to Plan P with the output. This is a smoke test. P's threaded unit test is the proof.

- [ ] **Step 10: Hand-off to Plans A/B**

Tell the Plan A/B executor:
- URL `http://127.0.0.1:19119`;
- user `qa`, with the password in `$SCRATCH/throwaway-0215.creds`;
- the tunnel command from step 8;
- `S_PLUGIN_SHA`.

The §10.2 scenario list is theirs: approval, clarify batch + push, secure entry, Stop mid-tool, steer, kill mid-clarify, reconnect mid-turn, two-device burst. The throwaway runs real commands inside its container, with LAN egress and live provider keys. So the "dangerous command" scenario uses a harmless target (e.g. `rm -rf /tmp/qa-x`), and it is denied or run only inside the container.

Also give them the live-0.20.4 legacy list. Record their sign-off (PR links) for Task 0.

- [ ] **Step 11: Teardown (after A+B sign-off; before Task 8 regardless)**

```bash
ssh root@dc1-1.local 'docker rm -f hermes-test-0215 >/dev/null
rm -rf /mnt/user/appdata/hermes-test-0215 /mnt/user/appdata/hermes-test-0215.env
test ! -e /mnt/user/appdata/hermes-test-0215 && test ! -e /mnt/user/appdata/hermes-test-0215.env && echo GONE
ss -ltn | grep -c ":19119 " || true'
pkill -f 'ExitOnForwardFailure=yes -L 19119' || true
lsof -nP -iTCP:19119 -sTCP:LISTEN || echo "tunnel closed"
rm -f "$SCRATCH/throwaway-0215.creds" "$SCRATCH/tt.jar"
```
Expected: `GONE`, `0`, `tunnel closed`. **Keep `$NEW_IMAGE`**: it is the `FROM` of the bump build (Tasks 4–8).

---

## Task 0 — Preconditions gate

**Files:** none. **Interfaces:** produces `P_SHA`.

- [ ] **Step 1: Plan P is merged to plugin `main`, and it carries the three fixes**

```bash
git -C ~/Developer/hermes-mobile-plugin fetch --quiet origin
git -C ~/Developer/hermes-mobile-plugin log -1 --format='%H %s' origin/main
git -C ~/Developer/hermes-mobile-plugin grep -cE 'fcntl\.flock|mkstemp' origin/main -- hermes_mobile/device_store.py
git -C ~/Developer/hermes-mobile-plugin grep -c 'coalesced' origin/main -- hermes_mobile/
git -C ~/Developer/hermes-mobile-plugin grep -c 'pre_tool_call' origin/main -- hermes_mobile/
```
Expected: Plan P's squash commit (record its full SHA as **`P_SHA`**), then a count ≥ 2, then ≥ 1, then ≥ 1. **STOP** if P is not merged.

- [ ] **Step 2: Plans A, B and C are verified on the throwaway container AND on live 0.20.4**

Spec §11 item 5 says the bump runs only after "2–4" (App A, B **and C**) are verified. Open all three PRs; their numbers come from Plans A/B/C:
`gh pr view <A_PR> -R gldc/hermes-mobile-app --json state,body --jq '.state'`, and the same for `<B_PR>` and `<C_PR>`.

Read each body. Expected:
- A and B tick the §10.2 throwaway checklist and the "against live 0.20.4" checklist (legacy approval, Stop, best-effort steer, normal chat), with screenshots;
- C ticks its polish acceptance with dark and light screenshots;
- each A/B sign-off names the `S_PLUGIN_SHA` it ran against.

**STOP** if any list is missing or unticked.

- [ ] **Step 3: The app build is on his phone, and the throwaway is gone**

`ssh root@dc1-1.local 'docker ps -a --filter name=^hermes-test-0215$ -q | wc -l'` → `0`, or run Task S step 11. Spec §11 "order on the box" step 2: the app must be installed on his phone before the bump (it works on 0.20.4). Confirm this with him in the step 4 message.

- [ ] **Step 4: Gianluca is available for QA: his go**

Message him: *"Ready to bump dc1-1 hermes 0.20.4 → 0.21.5. Plugin P (`<P_SHA>`) merged; A+B+C verified on the throwaway and live 0.20.4. Is the new app build on your phone? The image is built before the stop, so the outage is about the backup + the migration measured in Task 5 + boot; I'll send the exact figure before I stop the box. Rollback restores the DBs and loses anything said after the bump. Reply `go` when you can QA today."* **STOP** until he replies `go`.

---

## Task 1 — Merge PR #29, branch off the new `main`

**Files:** Create `$WT/docs/research/2026-09-28-bump-0.21.5-assessment.md` and `$WT/docs/superpowers/plans/2026-09-28-D-gateway-bump-0.21.5.md`.
**Interfaces:** produces the worktree `$WT` on `$BRANCH`.

- [ ] **Step 1: Gate #29 on CI exit code, then squash-merge**

```bash
gh auth status 2>&1 | grep -E 'Logged in to github.com (account )?gldc'
gh pr view 29 -R gldc/hermes-deploy --json state,mergeable,mergeStateStatus --jq '[.state,.mergeable,.mergeStateStatus]|join(" ")'
gh pr checks 29 -R gldc/hermes-deploy --watch; echo "exit=$?"
```
Expected: a `gldc` login line, `OPEN MERGEABLE CLEAN`, `exit=0`. **STOP** on any other output.

```bash
gh pr merge 29 -R gldc/hermes-deploy --squash
gh pr view 29 -R gldc/hermes-deploy --json state,mergeCommit --jq '.state+" "+.mergeCommit.oid'
```
Expected: `MERGED <sha>`.

- [ ] **Step 2: Worktree on the new branch; baseline suite**

```bash
git -C ~/Developer/hermes-deploy fetch --quiet origin
git -C ~/Developer/hermes-deploy worktree add "$WT" -b "$BRANCH" origin/main
cd "$WT" && git log -1 --format='%h %s'
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest credexec/tests/ -q -p no:cacheprovider > "$SCRATCH/pytest-baseline.txt" 2>&1; echo "exit=$?"
tail -1 "$SCRATCH/pytest-baseline.txt"
```
Expected: `<sha> chore(dc1): bump hermes base to v2026.8.18 (0.20.4); guard PID-1 ownership (#29)`, then `exit=0`, then `724 passed, 1 skipped, …`. **STOP** on any other `exit=`.

- [ ] **Step 3: Preserve the assessment and this plan in the branch immediately (the scratchpad is ephemeral)**

```bash
mkdir -p "$WT/docs/research"
# Sources = the REVIEWED copies committed in the app repo (the session scratchpad is ephemeral
# and holds pre-review text).
A=$HOME/Developer/hermes-mobile-app/docs/superpowers/plans/cross-repo
test -s "$A/2026-09-28-bump-0.21.5-assessment.md" && grep -q '^## Revision log (review 2026-09-28)' "$A/2026-09-28-D-gateway-bump-0.21.5.md" \
  || { echo "STOP: reviewed sources not found"; exit 1; }
mkdir -p "$WT/docs/superpowers/plans"
cp "$A/2026-09-28-bump-0.21.5-assessment.md" "$WT/docs/research/2026-09-28-bump-0.21.5-assessment.md"
cp "$A/2026-09-28-D-gateway-bump-0.21.5.md" "$WT/docs/superpowers/plans/2026-09-28-D-gateway-bump-0.21.5.md"
cd "$WT" && git add docs/research/2026-09-28-bump-0.21.5-assessment.md docs/superpowers/plans/2026-09-28-D-gateway-bump-0.21.5.md
git commit -m "docs: 0.21.5 bump assessment and Plan D, verbatim

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
**STOP** if the source paths are gone. Ask the controller for the files, because the spec requires the assessment in this PR.

---

## Task 2 — B0: re-diff on execution day

**Files:** none. **Interfaces:** confirms `OLD_REV`, `NEW_REV`, `NEW_DIGEST` still hold.

- [ ] **Step 1: The deployed commit comes from the running image's label**

```bash
ssh root@dc1-1.local 'docker image inspect hermes-dc1:local --format "{{index .Config.Labels \"org.opencontainers.image.revision\"}}"; docker exec hermes hermes --version | head -1'
```
Expected: `e624e9fde561e1add9388384012b295fde669ade`, then `Hermes Agent v0.20.4 (2026.8.18)`.

- [ ] **Step 2: Diff from the deployed commit; confirm the assessment's §1 table**

```bash
cd ~/Developer/hermes-agent && git fetch --quiet upstream --tags
git rev-parse 'v2026.9.24^{commit}'
git diff --stat e624e9fd..v2026.9.24 -- Dockerfile docker/ | tail -5
git diff e624e9fd..v2026.9.24 -- Dockerfile | grep -E '^[-+](ENTRYPOINT|CMD|USER)' || echo "entrypoint/cmd/user unchanged"
git diff --name-status e624e9fd..v2026.9.24 -- docker/cont-init.d/ ; echo "cont-init diff end"
git show v2026.9.24:Dockerfile | grep -nE 'useradd -u 10000|^ENV PATH=|SQLITE_AUTOCONF_VERSION=|S6_OVERLAY_VERSION'
git ls-remote --tags upstream 'v2026.9.2*' 'v2026.10*' | awk '{print $2}' | grep -v '\^{}'
```
Expected:
- `f97608f178d1ffeca59860195ab7da295f7c8e5f`;
- exactly `Dockerfile`, `docker/SOUL.md`, `docker/main-wrapper.sh`, `docker/stage2-hook.sh` changed (4 files);
- `entrypoint/cmd/user unchanged`;
- `cont-init diff end` with nothing before it;
- the `useradd -u 10000 -m -d /opt/data hermes`, `ENV PATH=/opt/hermes/bin:…`, `3530400` and s6 `3.2.3.0` lines;
- only `refs/tags/v2026.9.24`.

**STOP** if a newer tag exists (his call), or if any contract line differs.

- [ ] **Step 3: The tag's digest is unchanged in the registry**

```bash
TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:nousresearch/hermes-agent:pull" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -sI -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json' \
  https://registry-1.docker.io/v2/nousresearch/hermes-agent/manifests/v2026.9.24 | tr -d '\r' | awk -F': ' '/^[Dd]ocker-[Cc]ontent-[Dd]igest/{print $2}'
```
Expected: `sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7`. **STOP** on mismatch: a retagged release.

- [ ] **Step 4: Fresh upstream issues on our topology**

`gh search issues --repo NousResearch/hermes-agent --state open --limit 40 "state.db OR migration OR docker OR fts OR control socket OR multiplex" --json number,title,createdAt --jq '.[]|select(.createdAt>"2026-09-24")|"\(.number) \(.title)"'` → read every title. **STOP** on any data-loss or boot-loop report against 9.24 (his call). #123761 and #126304 are already known.

---

## Task 3 — B1: pin the new digest (RED→GREEN), update the 0.20.4 wording

**Files:**
- Modify: `IMAGE`, `Dockerfile:9-14` (pin comment + `ARG BASE`), `Dockerfile:410`, `docker-compose.yml:16-17`, `credexec/tests/_bindscan.py:261`, `credexec/tests/test_broker.py:4157-4161`, `.github/workflows/credexec-tests.yml` (`paths` lists)
- Test: `credexec/tests/test_broker.py` (new test after `_repo_text`, before `test_dockerfile_bakes_the_package_at_the_policys_pythonpath`)

**Interfaces:** Consumes `_repo_text(name)` (`test_broker.py:4046`) and `re`, already imported. Produces `test_image_file_and_dockerfile_arg_base_pin_the_same_digest`, which the runbook and STATE.md cite.

- [ ] **Step 1: Write the sync guard (today both files hold the old digest)**

Insert into `credexec/tests/test_broker.py` directly above `def test_dockerfile_bakes_the_package_at_the_policys_pythonpath():`:

```python
# --- base pin: IMAGE and ARG BASE are one fact written twice ---------------
# The Dockerfile says "keep these two in sync" and nothing enforced it:
# scripts/resolve-digest.sh writes only IMAGE, so a bump that runs the script
# and forgets the ARG builds from the OLD base while IMAGE claims the new one.
_BASE_PIN = re.compile(r"^nousresearch/hermes-agent@sha256:[0-9a-f]{64}$")


def test_image_file_and_dockerfile_arg_base_pin_the_same_digest():
    image = _repo_text("IMAGE").strip()
    args = re.findall(r"^ARG BASE=(\S+)\s*$", _repo_text("Dockerfile"), re.M)
    assert len(args) == 1, args  # exactly one global BASE arg
    assert _BASE_PIN.match(image), image  # a digest, never a floating tag
    assert args[0] == image
```

- [ ] **Step 2: Run it: green on the synced old pin (it reads both files)**

Run: `cd "$WT" && python3 -m pytest credexec/tests/test_broker.py::test_image_file_and_dockerfile_arg_base_pin_the_same_digest -q -p no:cacheprovider`
Expected: `1 passed`.

- [ ] **Step 3: Do the half-bump that `resolve-digest.sh` does (IMAGE only)**

```bash
printf 'nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7\n' > "$WT/IMAGE"
```

- [ ] **Step 4: Run it: RED**

Run: the same command as step 2.
Expected: `FAILED … assert 'nousresearch/hermes-agent@sha256:22e37bb4…' == 'nousresearch/hermes-agent@sha256:fca358f1…'`.

- [ ] **Step 5: Update `ARG BASE` and its pin comment (Dockerfile:9-14)**

Replace:
```
# Pinned 2026-08-19 to the RELEASE TAG v2026.8.18 (hermes 0.20.4), not to :main.
# The previous pin was a :main snapshot (2026-07-18, 0.18.2, upstream 5988fe6c);
# a floating branch resolves to whatever was green that hour, while a release tag
# is a thing upstream chose to ship and can be read back from the tag. Re-resolve
# with `scripts/resolve-digest.sh <tag>` and pass the tag, never the default :main.
ARG BASE=nousresearch/hermes-agent@sha256:22e37bb4ed1b0f50cb6bd991dca7ecacd6c9f29df9b4a20fc989d32bc763ccf6
```
with (`PIN_DATE` = `date +%F` today):
```
# Pinned PIN_DATE to the RELEASE TAG v2026.9.24 (hermes 0.21.5, upstream
# f97608f1), not to :main. History: v2026.8.18 (0.20.4, sha256:22e37bb4…) from
# 2026-08-19; before that a :main snapshot (2026-07-18, 0.18.2, upstream 5988fe6c).
# A floating branch resolves to whatever was green that hour, while a release tag
# is a thing upstream chose to ship and can be read back from the tag. Re-resolve
# with `scripts/resolve-digest.sh <tag>` and pass the tag, never the default :main.
# The script writes only IMAGE; the ARG below must be updated by hand, and
# test_image_file_and_dockerfile_arg_base_pin_the_same_digest fails until it is.
ARG BASE=nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7
```

- [ ] **Step 6: Run it: GREEN**

Run: the same command as step 2. Expected: `1 passed`.

- [ ] **Step 7: The 0.20.4 wording (comments only; no assertion text changes)**

- `Dockerfile:410`: `# Entrypoint is inherited and, as of the 0.20.4 base, is no longer `/init`` → `# Entrypoint is inherited and, from the 0.20.4 base on (unchanged at 0.21.5), is no longer `/init``.
- `docker-compose.yml:16-17`: `… As of the` / `# 0.20.4 base the ENTRYPOINT is docker/entrypoint-dispatch.sh, which execs` → `… As of the` / `# 0.20.4 base (unchanged at 0.21.5) the ENTRYPOINT is docker/entrypoint-dispatch.sh, which execs`.
- `credexec/tests/_bindscan.py:261`: `#: ENTRYPOINT. From the 0.20.4 base that entrypoint is` → `#: ENTRYPOINT. From the 0.20.4 base on (unchanged at 0.21.5) that entrypoint is`.
- `credexec/tests/test_broker.py:4157`: `# --- PID-1 guard fixtures (the 0.20.4 base's entrypoint dispatcher) ---------` → `# --- PID-1 guard fixtures (entrypoint dispatcher, 0.20.4 base onward) -------`.
- `credexec/tests/test_broker.py:4159-4161`: replace the three lines with:
```
# ENTRYPOINT as a child. From the 0.20.4 base on (unchanged at 0.21.5) that
# entrypoint is docker/entrypoint-dispatch.sh, which checks `[ "$$" -eq 1 ]` and,
# when it is NOT PID 1, deliberately skips s6-overlay and execs main-wrapper directly.
```
Then confirm nothing else claims "the 0.20.4 base" as current:
`cd "$WT" && grep -rn "0\.20\.4 base" Dockerfile docker-compose.yml credexec/` → only the lines above, each now carrying `unchanged at 0.21.5` or `onward`.

- [ ] **Step 8: CI must run on an IMAGE-only change**

In `.github/workflows/credexec-tests.yml` add `'IMAGE',` after `'Dockerfile',` in **both** `paths:` lists. Append one comment line after the `**/*.md` paragraph: `# `IMAGE` is in the filter because test_image_file_and_dockerfile_arg_base_pin_the_same_digest reads it: a PR that runs resolve-digest.sh touches only IMAGE.`

- [ ] **Step 9: Full suite + lint**

```bash
cd "$WT" && PYTHONDONTWRITEBYTECODE=1 python3 -m pytest credexec/tests/ -q -p no:cacheprovider > "$SCRATCH/pytest-b1.txt" 2>&1; echo "pytest=$?"
tail -1 "$SCRATCH/pytest-b1.txt"
uvx ruff@0.14.10 check credexec; echo "check=$?"; uvx ruff@0.14.10 format --check credexec; echo "format=$?"
```
Expected: `pytest=0`, `725 passed, 1 skipped, …`, `check=0`, `format=0`.

- [ ] **Step 10: Commit**

```bash
cd "$WT" && git add IMAGE Dockerfile docker-compose.yml credexec/tests/_bindscan.py credexec/tests/test_broker.py .github/workflows/credexec-tests.yml
git commit -m "chore(dc1): pin hermes base v2026.9.24 (0.21.5); guard IMAGE == ARG BASE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Draft PR now, and CI gates the box (review 2026-09-28)**

The code synced to the box in Task 6 must be the code CI passed. Before this step, CI first ran in Task 12, after the deploy.
```bash
cd "$WT" && git push -u origin "$BRANCH"
printf 'Draft: 0.21.5 base bump. Body is replaced in Task 12 with the deploy evidence.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' > "$SCRATCH/pr-body-0215-draft.md"
gh pr create -R gldc/hermes-deploy --draft --base main --head "$BRANCH" \
  --title "chore(dc1): bump hermes base to v2026.9.24 (0.21.5)" --body-file "$SCRATCH/pr-body-0215-draft.md"
NN=$(gh pr view "$BRANCH" -R gldc/hermes-deploy --json number --jq .number); echo "PR #$NN"
gh pr checks "$NN" -R gldc/hermes-deploy --watch; echo "exit=$?"
```
Expected: `PR #<NN>` (use it as `#NN` everywhere from here on), then `exit=0`. **STOP** on any other exit. Nothing is synced to the box until this passes.

---

## Task 4 — B2: compat in the NEW base, before anything is stopped

**Files:** none in the repo. On the box: `/mnt/cache/compat/` (scratch; removed in Task 13). On the Mac: `$SCRATCH/smoke.py`.
**Interfaces:** Consumes `P_SHA` and `$NEW_IMAGE`, which may already have been pulled by Task S. The old side is **`hermes-dc1:local`**: 0.20.4 plus the wrapper, since the bare old base is not on the box and pulling it would cost 3 GB of the 15.

- [ ] **Step 1: Stage the plugin at `P_SHA` on the box**

```bash
ssh root@dc1-1.local "bash -s -- $P_SHA $NEW_IMAGE" <<'SH'
set -eu
install -d -m 0755 /mnt/cache/compat; rm -rf /mnt/cache/compat/hermes-mobile-plugin
git clone --quiet https://github.com/gldc/hermes-mobile-plugin /mnt/cache/compat/hermes-mobile-plugin
git -C /mnt/cache/compat/hermes-mobile-plugin checkout --quiet "$1"
git -C /mnt/cache/compat/hermes-mobile-plugin log -1 --format=%H
docker image inspect "$2" >/dev/null 2>&1 || docker pull "$2" >/dev/null; echo image-present
df -BG --output=avail /var/lib/docker | tail -1
SH
```
Expected: `P_SHA`, `image-present`, `≥8G`.

- [ ] **Step 2: The plugin suite under both cores**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
for IMG in "$1" hermes-dc1:local; do
  echo "== $IMG"
  docker run --rm --entrypoint /bin/sh -e PYTHONDONTWRITEBYTECODE=1 -v /mnt/cache/compat/hermes-mobile-plugin:/plugin "$IMG" -c '
    /usr/local/bin/uv pip install --python /opt/hermes/.venv/bin/python pytest pytest-asyncio >/dev/null 2>&1
    cd /plugin && PYTHONPATH=/opt/hermes /opt/hermes/.venv/bin/python -m pytest tests/ -q -p no:cacheprovider > /tmp/pt.txt 2>&1; rc=$?
    tail -1 /tmp/pt.txt; echo "exit=$rc"'
done
SH
```
Expected, for each image: `exit=0` and a count line. These containers run as **root**, so it matches Plan P's "as root" figure: `193 passed, 1 skipped` for a 194-test suite. Root bypasses the permission test. The count must equal the one Plan P's final report records. **STOP** on any `exit=` other than 0.

- [ ] **Step 3: The differential real-loader smoke**

Write `$SCRATCH/smoke.py`:
```python
from hermes_cli.dashboard_auth import registry
from hermes_cli.plugins import PluginManager

pm = PluginManager()
pm.discover_and_load()
print("mobile ids in _plugins:", sorted(k for k in pm._plugins if "mobile" in k))
print("providers:", sorted(p.name for p in registry.list_providers()))
print("session providers:", sorted(p.name for p in registry.list_session_providers()))
```
```bash
scp -q "$SCRATCH/smoke.py" root@dc1-1.local:/mnt/cache/compat/smoke.py
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
set -eu; S=/mnt/cache/compat/smoke; rm -rf "$S"; install -d "$S/home/plugins"
cp -a /mnt/cache/compat/hermes-mobile-plugin "$S/home/plugins/hermes-mobile"
printf 'plugins:\n  enabled:\n    - hermes-mobile\n    - mobile\n' > "$S/home/config.yaml"
for side in old new; do
  IMG=hermes-dc1:local; [ "$side" = new ] && IMG="$1"
  rm -rf "$S/run"; cp -a "$S/home" "$S/run"
  docker run --rm --entrypoint /opt/hermes/.venv/bin/python -e HERMES_HOME=/h -e PYTHONPATH=/opt/hermes \
    -w /opt/hermes -v "$S/run:/h" -v /mnt/cache/compat/smoke.py:/smoke.py:ro "$IMG" /smoke.py > "$S/out-$side.txt" 2>&1 || true
done
diff "$S/out-old.txt" "$S/out-new.txt" && echo IDENTICAL; cat "$S/out-new.txt"
SH
```
Expected: `IDENTICAL`, and a non-empty `mobile ids in _plugins:` list. **STOP** on a diff, or on an empty list on either side.

- [ ] **Step 4: `hermes plugins compat`, over the mobile plugin and a copy of openrouter-image-gen**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
rm -rf /mnt/cache/compat/openrouter-image-gen
cp -a /mnt/user/appdata/hermes/data/plugins/openrouter-image-gen /mnt/cache/compat/openrouter-image-gen
for p in hermes-mobile-plugin openrouter-image-gen; do
  docker run --rm --entrypoint /opt/hermes/.venv/bin/hermes -v "/mnt/cache/compat/$p:/p:ro" "$1" plugins compat /p
  echo "$p exit=$?"
done
SH
```
Expected: `hermes-mobile-plugin exit=0`, `openrouter-image-gen exit=0`. Exit 1 means a pre-decomposition import, which gets the plugin disabled; **STOP**.

- [ ] **Step 5: `assert_protocol_compliance(MobileDeviceProvider)`**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
docker run --rm --entrypoint /opt/hermes/.venv/bin/python -e PYTHONPATH=/opt/hermes:/plugin \
  -v /mnt/cache/compat/hermes-mobile-plugin:/plugin:ro "$1" -c \
  'from hermes_cli.dashboard_auth import assert_protocol_compliance; from hermes_mobile.auth_provider import MobileDeviceProvider; assert_protocol_compliance(MobileDeviceProvider); print("compliant")'
echo "exit=$?"
SH
```
Expected: `compliant`, `exit=0`.

- [ ] **Step 6: Re-grep bundled `required_credential_files` and the L10 names in the tree that ships**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
docker run --rm --entrypoint /bin/sh "$1" -c '
  test -f /opt/hermes/skills/productivity/google-workspace/SKILL.md && echo control-ok
  grep -rl --include=SKILL.md required_credential_files /opt/hermes/skills /opt/hermes/optional-skills 2>/dev/null | sort
  echo ---; for n in kraken gmaps gws seerr linkedin; do find /opt/hermes/skills /opt/hermes/optional-skills -maxdepth 3 -type d -name "$n" 2>/dev/null; done
  echo ---; find /opt/hermes/skills -maxdepth 2 -type d \( -name maps -o -name himalaya \) | sort'
SH
```
Expected: `control-ok`, then exactly `/opt/hermes/skills/productivity/google-workspace/SKILL.md`, then `---` with nothing after it, then `---` followed by the `maps` and `himalaya` dirs, which keeps the `skills.disabled` entries matching. **STOP** on a second `required_credential_files` skill, or on a bundled dir named after a tenant.

---

## Task 5 — Migration dry-run on a copy, with his decisions rehearsed (no prod writes)

**Files:** none in the repo. On the box: `/mnt/user/appdata/hermes-dryrun-0215/` (0700 10000; **on shfs, like the live DB**; deleted in step 9). `/mnt/cache/compat/cfgdiff.py` and `dryrun.py`.
**Interfaces:** Produces `T_MIG`, the seconds for `SessionDB` open + migrate, which feeds Task 8's deadline and the outage estimate. Also produces `/mnt/cache/compat/cfgdiff.py` (reused by Tasks 8 and 9) and the exact sed commands for his decisions (reused verbatim by Task 8).

- [ ] **Step 1: Write the two helper scripts and ship them**

`$SCRATCH/cfgdiff.py`:
```python
"""Semantic config.yaml diff: flattened key paths, secret-shaped values masked."""
import re
import sys

import yaml

SECRET = re.compile(r"key|token|secret|password", re.I)


def flat(d, p=""):
    out = {}
    if isinstance(d, dict):
        for k, v in d.items():
            out.update(flat(v, f"{p}.{k}" if p else str(k)))
    else:
        out[p] = d
    return out


def show(k, v):
    return "<redacted>" if SECRET.search(k) and v not in (None, "") else repr(v)


a = flat(yaml.safe_load(open(sys.argv[1])) or {})
b = flat(yaml.safe_load(open(sys.argv[2])) or {})
for k in sorted(set(a) | set(b)):
    if k not in b:
        print(f"- {k} = {show(k, a[k])}")
    elif k not in a:
        print(f"+ {k} = {show(k, b[k])}")
    elif a[k] != b[k]:
        print(f"~ {k}: {show(k, a[k])} -> {show(k, b[k])}")
```
`$SCRATCH/dryrun.py`:
```python
import sqlite3
import subprocess
import time
from pathlib import Path

W = Path("/w")
t0 = time.monotonic()
r = subprocess.run(
    ["/opt/hermes/.venv/bin/python", "/opt/hermes/scripts/docker_config_migrate.py"],
    capture_output=True, text=True,
)
print(f"config-migrate rc={r.returncode} {time.monotonic() - t0:.1f}s")
print(r.stdout.strip()[-800:])
print(r.stderr.strip()[-800:])

from hermes_state import SessionDB  # noqa: E402

t1 = time.monotonic()
db = SessionDB(W / "state.db")
getattr(db, "close", lambda: None)()
print(f"T_MIG={time.monotonic() - t1:.1f}")
c = sqlite3.connect(W / "state.db")
print("sqlite", sqlite3.sqlite_version)
print("schema", c.execute("SELECT version FROM schema_version").fetchone()[0])
print("integrity", c.execute("PRAGMA integrity_check").fetchall()[:5])
print("messages", c.execute("SELECT count(*) FROM messages").fetchone()[0])
```
```bash
scp -q "$SCRATCH/cfgdiff.py" "$SCRATCH/dryrun.py" root@dc1-1.local:/mnt/cache/compat/
```

- [ ] **Step 2: A consistent online copy of the live state.db, plus config.yaml**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -eu; W=/mnt/user/appdata/hermes-dryrun-0215
test ! -e "$W"; install -d -o 10000 -g 10000 -m 0700 "$W"
docker exec -u 10000 hermes /usr/bin/python3 -c "import sqlite3,time;t=time.monotonic();s=sqlite3.connect('file:/opt/data/state.db?mode=ro',uri=True);d=sqlite3.connect('/tmp/dryrun-state.db');s.backup(d);d.close();s.close();print('backup %.1fs'%(time.monotonic()-t))"
docker cp hermes:/tmp/dryrun-state.db "$W/state.db"; docker exec hermes rm -f /tmp/dryrun-state.db
cp -p /mnt/user/appdata/hermes/data/config.yaml "$W/config.yaml"; cp -p "$W/config.yaml" "$W/config.orig.yaml"
chown -R 10000:10000 "$W"; ls -l "$W"
SH
```
Expected: `backup N.Ns`, then `state.db` at about 178 MB plus both configs, all `10000 10000`. SQLite's backup API reads a consistent snapshot through the WAL. A `cp` of a live WAL database would be torn.

- [ ] **Step 3: Pre-migration integrity (3.53.4) + row count**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
docker run --rm --user 10000:10000 --entrypoint /usr/bin/python3 -v /mnt/user/appdata/hermes-dryrun-0215:/w "$1" -c \
  "import sqlite3;c=sqlite3.connect('/w/state.db');print(sqlite3.sqlite_version, c.execute('SELECT version FROM schema_version').fetchone()[0], c.execute('PRAGMA integrity_check').fetchall()[:5], c.execute('SELECT count(*) FROM messages').fetchone()[0])"
SH
```
Expected: `3.53.4 26 [('ok',)] <M>`. Record `<M>`. A `malformed …` line is not a STOP here. It **predicts** Task 8 step 6, so note it and carry on to measure.

- [ ] **Step 4: Apply his two decisions to the copy with the exact commands Task 8 will use**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
set -eu; cd /mnt/user/appdata/hermes-dryrun-0215
sed -i '/^compression:/,/^[^ ]/ s/^  threshold: 0\.75$/  threshold: 0.75\n  threshold_tokens: null/' config.yaml
sed -i '/^curator:/,/^[^ ]/ s/^  prune_builtins: true$/  prune_builtins: false/' config.yaml
chown 10000:10000 config.yaml; chmod 0640 config.yaml
grep -c '^  threshold_tokens: null$' config.yaml; grep -c '^  prune_builtins: false$' config.yaml
docker run --rm --entrypoint /opt/hermes/.venv/bin/python -v "$PWD:/w:ro" -v /mnt/cache/compat/cfgdiff.py:/cfgdiff.py:ro "$1" /cfgdiff.py /w/config.orig.yaml /w/config.yaml
cp -p config.yaml config.edited.yaml
SH
```
Expected: `1`, `1`, then exactly:
```
+ compression.threshold_tokens = None
~ curator.prune_builtins: True -> False
```

- [ ] **Step 5: Run the boot-time config migration + SessionDB migration, timed, on shfs**

```bash
ssh root@dc1-1.local "time docker run --rm --user 10000:10000 --entrypoint /opt/hermes/.venv/bin/python \
  -e HERMES_HOME=/w -e PYTHONPATH=/opt/hermes -w /opt/hermes \
  -v /mnt/user/appdata/hermes-dryrun-0215:/w -v /mnt/cache/compat/dryrun.py:/dryrun.py:ro $NEW_IMAGE /dryrun.py" \
  > "$SCRATCH/dryrun-0215.txt" 2>&1; echo "exit=$?"
cat "$SCRATCH/dryrun-0215.txt"
```
Expected:
- `exit=0` (a traceback in `dryrun.py` is a **STOP**, never a partial read);
- `config-migrate rc=0` with `[config-migrate] Migrating config schema 37 -> 46`;
- `T_MIG=<s>` (record it);
- `sqlite 3.53.4`, `schema 30`, `integrity [('ok',)]`;
- `messages <M>`, the same `<M>` as step 3.

**STOP** if:
- `T_MIG` > 450 (a 600 s lease leaves no margin; send Gianluca the figure);
- schema < 30 (the rebuild held the version back; it would repeat on every boot);
- integrity ≠ ok;
- the message count changed.

- [ ] **Step 6: The config diff is exactly steps 40 and 44, and his edits survived the rewrite**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE" <<'SH'
docker run --rm --entrypoint /opt/hermes/.venv/bin/python -v /mnt/user/appdata/hermes-dryrun-0215:/w:ro \
  -v /mnt/cache/compat/cfgdiff.py:/cfgdiff.py:ro "$1" /cfgdiff.py /w/config.edited.yaml /w/config.yaml
SH
```
Expected, exactly these five lines:
```
~ _config_version: 37 -> 46
~ curator.archive_after_days: 90 -> 30
~ curator.stale_after_days: 30 -> 14
- model_catalog.ttl_hours = 1
+ model_catalog.ttl_minutes = 20
```
**STOP** on any other line. Step 45 appending `connections` to a `platform_toolsets.*` list is the known suspect, and a vanished `compression.threshold_tokens` means the rewrite dropped his decision. Both are for Gianluca.

- [ ] **Step 7: Outage estimate to Gianluca**

Send: *"Dry-run done: config 37→46 = exactly steps 40+44; state.db 26→30 in `T_MIG` s on a copy of the live DB (integrity ok, row count unchanged). Expected outage ≈ 1 min backup + `T_MIG` s + 1 min boot (the image is pre-built in Task 7 step 4)."* This is a notification, not a wait (he already said `go`).

- [ ] **Step 8: Record the figures for the docs**

Append `T_MIG`, `<M>`, the backup seconds and both diffs to `$SCRATCH/acceptance-0215.txt` under `## dry-run`.

- [ ] **Step 9: Remove the dry-run copy (it holds every conversation)**

`ssh root@dc1-1.local 'rm -rf /mnt/user/appdata/hermes-dryrun-0215 && test ! -e /mnt/user/appdata/hermes-dryrun-0215 && echo removed'` → `removed`.

---

## Task 6 — B3: sync, preflight, probe-build (old container still serving)

**Files:** none new. The box's deploy tree receives the branch.
**Interfaces:** Consumes `$WT` at Task 3's commit (plus Task 1's docs commit). **Precondition:** Task 3 step 11 printed `exit=0` for that exact HEAD. Check that `git -C "$WT" status --porcelain` is empty and that `git -C "$WT" rev-parse HEAD` equals `gh pr view "$NN" -R gldc/hermes-deploy --json headRefOid --jq .headRefOid`.

- [ ] **Step 1: Disk**

`ssh root@dc1-1.local 'df -BG --output=avail /var/lib/docker | tail -1'` → ≥ 8G. **STOP** below 8G. Offer Gianluca `docker builder prune -f --filter until=720h` or removal of the 0.18.2 tags `pre-0.20.4`/`pre-L`/`preperuid`. That is his call; never retag `preperuid`.

- [ ] **Step 2: Stale-rootfs check (dry-run `--delete`, read only the rootfs lines)**

```bash
cd "$WT" && rsync -a --dry-run --delete --itemize-changes --exclude .git --exclude staging --exclude 'state-*.tgz' \
  --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache ./ root@dc1-1.local:/mnt/user/appdata/hermes/ \
  | grep -i deleting | grep rootfs/ || echo "no stale rootfs"
```
Expected: `no stale rootfs`. **STOP** on any line: a leftover s6 service gets compiled into the image (see runbook L2).

- [ ] **Step 3: rsync (no `--delete`) and confirm the pin landed**

```bash
cd "$WT" && rsync -a --exclude .git --exclude staging --exclude 'state-*.tgz' --exclude __pycache__ \
  --exclude .pytest_cache --exclude .ruff_cache ./ root@dc1-1.local:/mnt/user/appdata/hermes/
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes && cat IMAGE && grep "^ARG BASE=" Dockerfile'
```
Expected: `nousresearch/hermes-agent@sha256:fca358f1…52b7` twice (the second with the `ARG BASE=` prefix).

- [ ] **Step 4: Preflight the MERGED compose config (bindscan + PID-1)**

```bash
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes && docker compose config \
  | docker run --rm -i --entrypoint /usr/bin/python3 -v /mnt/user/appdata/hermes/credexec/tests/_bindscan.py:/_bindscan.py:ro \
      hermes-dc1:local /_bindscan.py --assert-no-package-mount --assert-owns-pid1; echo "scan exit=$?"'
```
Expected: `scan exit=0`. **STOP** otherwise.

- [ ] **Step 5: Probe build (four RUN gates; warms the cache for the real build)**

```bash
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes && time docker build -t hermes-dc1:probe . >/tmp/probe-0215.log 2>&1; echo "build exit=$?"; tail -5 /tmp/probe-0215.log; docker rmi hermes-dc1:probe >/dev/null && echo probe-removed; df -BG --output=avail /var/lib/docker | tail -1'
```
Expected: `build exit=0`, `probe-removed`, avail still ≥ 6G. **STOP** on a failed RUN gate: the `s6-setuidgid cx-kraken id -G` groups, `broker.load_policy`, `s6-rc-compile` over both trees, or the linkedin `rev-parse`. That is a base-contract break. Fix it in the branch; never `--no-cache` past it.

---

## Task 7 — B4: pin the rollback, capture baselines, pre-pull the plugin, pre-build, check the backup list

**Files:** none. On the box: `/mnt/cache/compat/listeners-pre0215.txt`.
**Interfaces:** Produces the image tag `hermes-dc1:pre-0.21.5` (the only rollback target), the listener baseline for Task 9 A6, the pre-built new `hermes-dc1:local` (step 4; the running container stays on the old image ID), and a verified backup list (step 5).

- [ ] **Step 1: Tag and assert**

```bash
ssh root@dc1-1.local 'docker tag hermes-dc1:local hermes-dc1:pre-0.21.5
[ "$(docker image inspect -f {{.Id}} hermes-dc1:local)" = "$(docker image inspect -f {{.Id}} hermes-dc1:pre-0.21.5)" ] && echo SAME
docker image inspect hermes-dc1:pre-0.21.5 --format "{{index .Config.Labels \"org.opencontainers.image.revision\"}}"'
```
Expected: `SAME`, `e624e9fde561e1add9388384012b295fde669ade`.

- [ ] **Step 2: Listener baseline**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
nsenter -t "$(docker inspect -f '{{.State.Pid}}' hermes)" -n ss -ltn | awk 'NR>1{print $4}' | sort | tee /mnt/cache/compat/listeners-pre0215.txt
SH
```
Expected (ports on tailscaled's lines vary per boot): `0.0.0.0:9119`, `100.89.28.11:443`, `100.89.28.11:9120`, `100.89.28.11:<eph>`, `127.0.0.11:<eph>`, `[fd7a:115c:a1e0::2738:1c0c]:<eph>`. There is **no** `127.0.0.1:8642`.

- [ ] **Step 3: Plugin checkout to `P_SHA` as uid 10000 (boot's pull becomes a no-op)**

```bash
ssh root@dc1-1.local "bash -s -- $P_SHA" <<'SH'
set -eu; G="docker exec -u 10000 hermes git -C /opt/data/plugins/hermes-mobile"
# Unverified by the review: ownership and remote. A root-owned tree gives "dubious ownership" as uid 10000,
# and an ssh remote has no key for uid 10000. Both are STOPs, never a chown or a remote rewrite.
stat -c '%u:%g %n' /mnt/user/appdata/hermes/data/plugins/hermes-mobile /mnt/user/appdata/hermes/data/plugins/hermes-mobile/.git
$G remote get-url origin
$G pull --ff-only --quiet
$G log -1 --format=%H
$G branch -vv | sed -n '/^\*/p'
$G branch -D fix/adapter-connect-is-reconnect 2>/dev/null || echo "stale branch already gone"
[ "$($G log -1 --format=%H)" = "$1" ] && echo PLUGIN-AT-P_SHA
SH
```
Expected:
- `10000:10000` twice;
- `https://github.com/gldc/hermes-mobile-plugin(.git)`;
- `P_SHA`;
- `* main <P_SHA7> [origin/main] …`;
- `Deleted branch fix/adapter-connect-is-reconnect (was 47e9175).` (optional hygiene per assessment §5b);
- `PLUGIN-AT-P_SHA`.

**STOP** if:
- the owner is not 10000, or the remote is not https (his call);
- it does not fast-forward.

The running 0.20.4 processes keep the old plugin in memory. Only a process started after this (a crash-restart, or the `hermes mobile` CLI) runs `P_SHA`, and Plan P passes at 8.18.

- [ ] **Step 4: Build the new image while the old container still serves (moves the build out of the outage)**

A container is pinned to its image **ID**. `docker compose build` retags `hermes-dc1:local` to the new image, and the running container, or a restart-policy restart of that same container, stays on the old ID. The rollback target `pre-0.21.5` is already pinned (step 1). Only `docker compose up` would switch images, and that runs only in Task 8 step 9.
```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
cd /mnt/user/appdata/hermes
OLD=$(docker inspect -f '{{.Image}}' hermes)
docker compose build >/tmp/build-0215.log 2>&1; echo "build exit=$?"; tail -3 /tmp/build-0215.log
[ "$(docker inspect -f '{{.Image}}' hermes)" = "$OLD" ] && echo "old container still on old image"
[ "$(docker image inspect -f '{{.Id}}' hermes-dc1:local)" != "$OLD" ] && echo "local = new image"
[ "$(docker image inspect -f '{{.Id}}' hermes-dc1:pre-0.21.5)" = "$OLD" ] && echo "rollback tag = running image"
df -BG --output=avail /var/lib/docker | tail -1
SH
```
Expected:
- `build exit=0`;
- `old container still on old image`;
- `local = new image`;
- `rollback tag = running image`;
- avail ≥ 5G.

**STOP** on any other result. Run `docker tag hermes-dc1:pre-0.21.5 hermes-dc1:local` so `:local` is the old image again, then diagnose.

**From here until Task 8, never run `docker compose up`**. It would recreate the container onto 0.21.5 without the backup.

- [ ] **Step 5: Every path in the cold-backup list exists (before the stop, not during it)**

Task 8 step 4's `tar` exits non-zero on a missing path, and there that is a STOP in the middle of the outage.
```bash
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes/data && for p in config.yaml state.db kanban.db projects.db verification_evidence.db auth.json SOUL.md PERSONA.md \
  channel_directory.json gateway_state.json cron sessions memories platforms pairing hooks mobile plugins skills tailscale; do
  test -e "$p" || echo "MISSING $p"; done; echo backup-list-checked'
```
Expected: `backup-list-checked` with no `MISSING` line. For any `MISSING`:
- if the path genuinely does not exist on this box (a feature never used), drop it from Task 8 step 4's list **and** from the runbook's list in Task 11 step 5. Record which;
- if you cannot tell, **STOP** for Gianluca.

---

## Task 8 — B5: back up, rehearsed edits, build, up (DOWNTIME)

**Files:** `data/config.yaml` on the box (edited). Backups go to `/mnt/cache/backups/`.
**Interfaces:**
- Consumes: `T_MIG` (Task 5), `/mnt/cache/compat/cfgdiff.py`, `hermes-dc1:pre-0.21.5`.
- Produces: `D8` (`date +%Y%m%d` at step 1); the tarball path in `/mnt/cache/backups/.last-pre-0.21.5`; `BOOT_TS` in `/mnt/cache/compat/boot-ts-0215.txt`, consumed by Task 9's log greps.

- [ ] **Step 1: Heads-up + the config backup (before the stop, before any edit)**

Tell Gianluca: *"Stopping hermes now; back in ≈ 1 min + `T_MIG` s + 1 min."* Confirm first that the ssh master from the Global Constraints is up (`ssh -O check -o ControlPath=… root@dc1-1.local`), so no 1Password prompt can land mid-outage.
```bash
D8=$(date +%Y%m%d)
ssh root@dc1-1.local "cd /mnt/user/appdata/hermes && cp -p data/config.yaml data/config.yaml.bak-$D8-pre0215 && stat -c '%a %u:%g %s %n' data/config.yaml data/config.yaml.bak-$D8-pre0215"
```
Expected: two lines, both `640 10000:10000 <same size>`.

- [ ] **Step 2: Stop**

`ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes && docker compose stop 2>&1 | tail -2'` → `Container hermes  Stopped`. **Downtime starts.**

- [ ] **Step 3: Every WAL is 0 bytes**

```bash
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes/data && shopt -s nullglob && n=0
for w in *.db-wal; do n=$((n+1)); printf "%s %s\n" "$(stat -c %s "$w")" "$w"; done; echo "wal-files=$n"'
```
Expected: `0 state.db-wal` and `0 kanban.db-wal` (and `0` for any other `*.db-wal`), then `wal-files=<n>`. A clean last close may **delete** a `-wal` file instead of truncating it, so a missing `-wal` (even `wal-files=0`) is also clean. **STOP** on any non-zero: the writer did not exit cleanly and a tar would be torn. Run `docker compose start`, wait 60 s, then `docker compose stop` once more and re-check. If it is still non-zero, message Gianluca.

- [ ] **Step 4: Cold backup, extended list (assessment §2), 0600**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -eu; cd /mnt/user/appdata/hermes
install -d -m 0700 /mnt/cache/backups
B=/mnt/cache/backups/pre-0.21.5-$(date +%Y%m%d-%H%M%S).tgz
tar -czpf "$B" --numeric-owner -C data \
  config.yaml state.db kanban.db projects.db verification_evidence.db auth.json SOUL.md PERSONA.md \
  channel_directory.json gateway_state.json cron sessions memories platforms pairing hooks \
  mobile plugins skills tailscale
chmod 0600 "$B"; echo "$B" > /mnt/cache/backups/.last-pre-0.21.5
install -m 0600 .env /mnt/cache/backups/pre-0.21.5-compose.env
ls -l "$B" /mnt/cache/backups/pre-0.21.5-compose.env
tar -tzf "$B" | grep -cE '^(state\.db|config\.yaml|kanban\.db|mobile/devices\.json)$'
SH
```
Expected: the tarball `-rw------- root root` at about 100–200 MB, the env copy `-rw-------`, and `4`. **STOP** if tar exits non-zero (a listed path missing) or the count ≠ 4.

- [ ] **Step 5: `integrity_check` on the BACKUP's state.db under 3.53.4**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -eu; I=/mnt/cache/compat/ic-pre0215; rm -rf "$I"; install -d -m 0700 "$I"
tar -xzpf "$(cat /mnt/cache/backups/.last-pre-0.21.5)" -C "$I" state.db
docker run --rm --entrypoint /usr/bin/python3 -v "$I:/w" hermes-dc1:pre-0.21.5 -c "import sqlite3;c=sqlite3.connect('/w/state.db');print(sqlite3.sqlite_version, c.execute('PRAGMA integrity_check').fetchall()[:5])"
rm -rf "$I"
SH
```
Expected: `3.53.4 [('ok',)]` → go to step 8. If the output is `malformed inverted index for FTS5 table main.<T>` → step 6. Any other message → **STOP**, restart the old container (`docker compose start`) and message Gianluca.

- [ ] **Step 6 (only if step 5 reported a malformed FTS5 table): rebuild it with the gateway stopped**

```bash
T=messages_fts_trigram   # the table step 5 named — set it from that output, never guess
ssh root@dc1-1.local "bash -s -- $T" <<'SH'
docker run --rm -i --user 10000:10000 --entrypoint /usr/bin/python3 \
  -v /mnt/user/appdata/hermes/data:/opt/data hermes-dc1:pre-0.21.5 - "$1" <<'PY'
import sqlite3, sys
t = sys.argv[1]
c = sqlite3.connect("/opt/data/state.db")
c.execute(f"INSERT INTO {t}({t}) VALUES('rebuild')")
c.commit()
print(c.execute("PRAGMA integrity_check").fetchall()[:3])
c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
c.close()
PY
stat -c '%s %n' /mnt/user/appdata/hermes/data/state.db-wal
SH
```
If step 5 named more than one FTS5 table, run this once per table. Expected: `[('ok',)]`, then `0 …state.db-wal`. The tarball keeps the pre-rebuild bytes, which is the true pre-bump state for rollback. Record it for STATE.md: "malformed again under 3.53.4" is new information (HANDOFF of 2026-08-19).

- [ ] **Step 8: His decisions, each with its own backup (rehearsed in Task 5 step 4)**

```bash
ssh root@dc1-1.local "bash -s -- $D8" <<'SH'
set -eu; cd /mnt/user/appdata/hermes/data
cp -p config.yaml "config.yaml.bak-$1-compression"
sed -i '/^compression:/,/^[^ ]/ s/^  threshold: 0\.75$/  threshold: 0.75\n  threshold_tokens: null/' config.yaml
cp -p config.yaml "config.yaml.bak-$1-curator"
sed -i '/^curator:/,/^[^ ]/ s/^  prune_builtins: true$/  prune_builtins: false/' config.yaml
chown 10000:10000 config.yaml; chmod 0640 config.yaml; stat -c '%a %u:%g' config.yaml
docker run --rm --entrypoint /opt/hermes/.venv/bin/python -v "$PWD:/w:ro" -v /mnt/cache/compat/cfgdiff.py:/cfgdiff.py:ro \
  hermes-dc1:pre-0.21.5 /cfgdiff.py "/w/config.yaml.bak-$1-pre0215" /w/config.yaml
SH
```
Expected: `640 10000:10000`, then exactly:
```
+ compression.threshold_tokens = None
~ curator.prune_builtins: True -> False
```
The edits go in **before** first boot. That way the first 0.21.5 curator pass never sees `prune_builtins: true` with the new 14/30 windows. **STOP** on any other diff: restore `config.yaml.bak-$D8-pre0215` and message Gianluca.

- [ ] **Step 9: Preflight gate → build → up**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -u; cd /mnt/user/appdata/hermes; FAIL=0
for d in data credexec-creds credexec-lib/chromium credexec-creds/linkedin/profile; do test -d "$d" || { echo "STOP: $d absent"; FAIL=1; }; done
test -s credexec-creds/linkedin/state/state.json || { echo "STOP: linkedin ledger absent/empty"; FAIL=1; }
test ! -e data/profiles || { echo "STOP: data/profiles exists — multiplex would arm the secret scope"; FAIL=1; }
for f in docker-compose.override.yml docker-compose.override.yaml compose.override.yml compose.override.yaml compose.yml compose.yaml; do
  test ! -e "$f" || { echo "STOP: $f is merged into the compose config"; FAIL=1; }; done
test -z "${COMPOSE_FILE:-}" || { echo "STOP: COMPOSE_FILE set"; FAIL=1; }
docker compose config | docker run --rm -i --entrypoint /usr/bin/python3 \
  -v /mnt/user/appdata/hermes/credexec/tests/_bindscan.py:/_bindscan.py:ro hermes-dc1:pre-0.21.5 \
  /_bindscan.py --assert-no-package-mount --assert-owns-pid1 || { echo "STOP: bind/pid1 scan failed"; FAIL=1; }
date -u '+%F %T' > /mnt/cache/compat/boot-ts-0215.txt
[ "$FAIL" = 0 ] && echo "PREFLIGHT OK" && docker compose build >/tmp/build-0215.log 2>&1 && docker compose up -d && echo "UP ISSUED" \
  || { echo "STOP: preflight/build failed — nothing recreated"; tail -20 /tmp/build-0215.log; }
SH
```
Expected: `PREFLIGHT OK`, `UP ISSUED`. The build is a cache hit, because the image was pre-built in Task 7 step 4. **STOP** otherwise. If `up -d` did not run, `docker compose start` brings the old container back: it is still pinned to the old image ID, even though `:local` is now the new image. If `up -d` already removed it, do the following, then diagnose:
1. Read `schema_version` with the in-image python from `hermes-dc1:pre-0.21.5`.
2. If it is still 26, retag `pre-0.21.5` → `:local` and run `up -d`. Skip the DB restore: nothing migrated.
3. If it is not 26, run the full Task 10.

- [ ] **Step 10: Watch the one-way migration; never restart mid-migration**

```bash
DEADLINE=$(python3 -c "print(max(300, int(2*$T_MIG)+120))")
ssh root@dc1-1.local "bash -s -- $DEADLINE" <<'SH'
end=$(( $(date +%s) + $1 ))
while [ "$(date +%s)" -lt "$end" ]; do
  v=$(docker exec -u 10000 hermes /usr/bin/python3 -c "import sqlite3;print(sqlite3.connect('file:/opt/data/state.db?mode=ro',uri=True).execute('SELECT version FROM schema_version').fetchone()[0])" 2>/dev/null)
  s=$(jq -r .gateway_state /mnt/user/appdata/hermes/data/gateway_state.json 2>/dev/null)
  echo "$(date -u +%T) schema=${v:-?} gateway=${s:-?}"
  [ "$v" = 30 ] && [ "$s" = running ] && { echo MIGRATED; break; }
  sleep 15
done
docker compose -f /mnt/user/appdata/hermes/docker-compose.yml logs --tail=60 2>&1 | grep -E "config-migrate|plugins\]|stage2\]|ERROR|Traceback" | tail -20
SH
```
Expected: the progress lines end in `MIGRATED`. The log shows `[config-migrate] Migrating config schema 37 -> 46`, `[plugins] hermes-mobile refreshed` (a no-op pull), and `[stage2] Generated API_SERVER_KEY …`. **Downtime ends at `MIGRATED`.**
If the deadline passes without `MIGRATED`, **do not restart the container**: a restart re-enters the rebuild. Tail `data/logs/agent.log` and `errors.log` for the FTS rebuild. While the log shows progress, extend by `T_MIG` once. If it shows `schema_version` held back or an exception → Task 10 (rollback), and message Gianluca.

---

## Task 9 — B6 acceptance (bodies and real calls; every line of spec §9.2 + assessment "Acceptance")

**Files:** `$SCRATCH/acceptance-0215.txt`: paste every command's output, with no secrets.
**Interfaces:**
- Consumes: `BOOT_TS` (`/mnt/cache/compat/boot-ts-0215.txt`), `/mnt/cache/compat/listeners-pre0215.txt`, `$SCRATCH/env-example-keys-0215.txt` (Task S step 6), `P_SHA`, `D8`.
- Produces: the evidence for the PR body, HANDOFF.md and STATE.md.

**Post-boot log slice.** Every log grep below reads only the lines written after `BOOT_TS`:
`awk -v ts="$TS" 'FNR==1{f=0} f||substr($0,1,19)>=ts{f=1;print}' <files>`. Log lines start `YYYY-MM-DD HH:MM:SS,mmm`; the per-file reset keeps untimestamped traceback lines that follow a post-boot line. `BOOT_TS` is UTC. A7 first asserts that the container logs in UTC too.

**Rollback triggers.** Go to Task 10 on any of these. The gateway is not `running`. Schema < 30. Slack **and** mobile are both down. A broker regression. Any "must" below that fails and cannot be fixed forward without touching the DBs. **Before** his QA traffic, roll back autonomously and tell him. **After** he has used it, rollback loses his conversations, so it is his call.

"Before his QA traffic" is a **measured** fact, not an assumption, because Slack goes live at boot:
```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
TS=$(cat /mnt/cache/compat/boot-ts-0215.txt)
docker exec -i -u 10000 hermes /usr/bin/python3 - "$TS" <<'PY'
import sqlite3, sys
c = sqlite3.connect("file:/opt/data/state.db?mode=ro", uri=True)
print("post-boot messages:", c.execute(
    "SELECT count(*) FROM messages WHERE timestamp >= strftime('%s', ?)", (sys.argv[1],)).fetchone()[0])
PY
SH
```
`messages.timestamp` is `REAL NOT NULL` epoch seconds (`hermes_state_common.py:411` @9.24), and `BOOT_TS` is UTC, which is what `strftime('%s', …)` assumes. A non-zero count means post-bump conversations exist, and then the rollback is his call. If the query errors, treat it as his call.

- [ ] **A1 Version and config**

```bash
ssh root@dc1-1.local "bash -s -- $NEW_IMAGE $D8" <<'SH'
cd /mnt/user/appdata/hermes
docker exec hermes hermes --version | head -1
docker exec hermes /usr/bin/python3 -c 'import sqlite3;print(sqlite3.sqlite_version)'
grep -n '^_config_version' data/config.yaml
grep -A8 '^plugins:' data/config.yaml | grep -E -- '- (hermes-mobile|mobile)$'
docker run --rm --entrypoint /opt/hermes/.venv/bin/python -v "$PWD/data:/w:ro" -v /mnt/cache/compat/cfgdiff.py:/cfgdiff.py:ro \
  "$1" /cfgdiff.py "/w/config.yaml.bak-$2-pre0215" /w/config.yaml
SH
```
Expected: `Hermes Agent v0.21.5 (2026.9.24)`; `3.53.4`; `…:_config_version: 46`; both `- hermes-mobile` and `- mobile`; then exactly these 7 lines:
```
~ _config_version: 37 -> 46
+ compression.threshold_tokens = None
~ curator.archive_after_days: 90 -> 30
~ curator.prune_builtins: True -> False
~ curator.stale_after_days: 30 -> 14
- model_catalog.ttl_hours = 1
+ model_catalog.ttl_minutes = 20
```

- [ ] **A2 Model and fallback, as uid 10000 via `bash -lc`**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
cd /mnt/user/appdata/hermes
grep -A3 '^model:' data/config.yaml | grep -E 'default|provider'
grep -A3 '^fallback_providers:' data/config.yaml | grep -E 'provider|model'
docker exec -u 10000 hermes bash -lc 'hermes status' 2>&1 | head -25
docker exec -u 10000 hermes bash -lc 'hermes fallback list' 2>&1
docker exec -u 10000 hermes bash -lc 'hermes chat -q "reply with the word ok"' 2>&1 | tail -8
SH
```
Expected:
- `default: k3`, `provider: kimi-coding`, then `provider: openrouter`, `model: z-ai/glm-5.2`;
- `hermes status` names k3 / kimi-coding;
- `hermes fallback list` shows **one** entry, openrouter → z-ai/glm-5.2, with no legacy `fallback_model` duplicate;
- the chat output contains `ok` from k3, plus the `📊 Context limit` line if one is printed (see A3).

- [ ] **A3 Effective compression, not only the YAML**

`ssh root@dc1-1.local "docker exec -u 10000 hermes bash -lc 'hermes config get compression.threshold_tokens; hermes config get compression.threshold'"`
Expected: `None` (or `null`), then `0.75`. If A2 printed `📊 Context limit: 1,000,000 tokens (compress at 75% = 750,000)` with no `(capped at 256,000 tokens)`, record it as the effective proof. A `256000` or a `capped at` note = **STOP**: his decision did not take.

- [ ] **A4 Database health**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
docker exec -u 10000 hermes bash -lc 'hermes doctor' > /tmp/doctor-0215.txt 2>&1
grep -iE 'fts|malformed|corrupt|integrity|schema|damage' /tmp/doctor-0215.txt; echo ---
docker exec -u 10000 hermes /usr/bin/python3 -c "import sqlite3;print(sqlite3.connect('file:/opt/data/state.db?mode=ro',uri=True).execute('SELECT version FROM schema_version').fetchone()[0])"
docker exec -u 10000 hermes /usr/bin/python3 -c "import sqlite3;s=sqlite3.connect('file:/opt/data/state.db?mode=ro',uri=True);d=sqlite3.connect('/tmp/pb.db');s.backup(d);print(d.execute('PRAGMA integrity_check').fetchall()[:5]);d.close()"
docker exec hermes rm -f /tmp/pb.db
SH
```
Expected: any matching doctor lines report healthy (no `fts_index` damage, no `malformed`; read the full `/tmp/doctor-0215.txt`). Then `30`, then `[('ok',)]` on the **post-boot copy**. Never run `hermes doctor --fix`.

- [ ] **A5 Profiles: standalone, and no second profile**

```bash
ssh root@dc1-1.local 'cd /mnt/user/appdata/hermes && jq -r .multiplex_standalone_reason data/gateway_state.json; test ! -e data/profiles && echo "no profiles dir"'
```
Expected: a reason naming "only one profile", then `no profiles dir`.

- [ ] **A6 Exposure: listeners and `/opt/data/.env`**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH' > "$SCRATCH/a6-0215.txt"
nsenter -t "$(docker inspect -f '{{.State.Pid}}' hermes)" -n ss -ltn | awk 'NR>1{print $4}' | sort > /tmp/l-post
sed -E 's/:[0-9]+$/:P/' /mnt/cache/compat/listeners-pre0215.txt | sort -u > /tmp/a
sed -E 's/:[0-9]+$/:P/' /tmp/l-post | sort -u > /tmp/b
echo "new:"; comm -13 /tmp/a /tmp/b; grep -xF 127.0.0.1:8642 /tmp/l-post
docker exec hermes stat -c '%a %U:%G' /opt/data/.env
docker exec hermes sh -c "grep -vE '^[[:space:]]*(#|\$)' /opt/data/.env | cut -d= -f1 | sort"
SH
cat "$SCRATCH/a6-0215.txt"
diff <(sed -n '/^[A-Z_]*$/p' "$SCRATCH/env-example-keys-0215.txt") <(sed -n '/^[A-Z_]*$/p' "$SCRATCH/a6-0215.txt") && echo "ENV KEYS = SEEDED SET"
```
Expected:
- `new:` followed by `127.0.0.1:P` only. Ports are normalised because tailscaled's are ephemeral, so the one new line is 8642.
- `127.0.0.1:8642`.
- `600 hermes:hermes`.
- The seeded set from Task S step 6: `API_SERVER_KEY` plus the 11 `.env.example` names.
- `ENV KEYS = SEEDED SET`.

**STOP** if:
- anything new binds `0.0.0.0` or the tailnet IP;
- the `.env` holds any compose env name (`KIMI_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `DASHSCOPE_API_KEY`, `SLACK_*`, `HERMES_*`, `TS_AUTHKEY`, `TERMINAL_BACKEND`).

If Task S was skipped, compare against those 12 names written out literally.

- [ ] **A7 Logs: the post-boot slice only**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
TS=$(cat /mnt/cache/compat/boot-ts-0215.txt)
echo "box-utc=$(date -u '+%F %T') container=$(docker exec hermes date '+%F %T')"
cd /mnt/user/appdata/hermes/data/logs
awk -v ts="$TS" 'FNR==1{f=0} f||substr($0,1,19)>=ts{f=1;print}' gateway.log agent.log errors.log > /tmp/post-0215.log
wc -l < /tmp/post-0215.log
grep -c UnscopedSecretError /tmp/post-0215.log || true
grep -i compat /tmp/post-0215.log | head -5; echo '--- control socket:'
grep -i 'control socket' /tmp/post-0215.log | head -3
cd /mnt/user/appdata/hermes && docker compose logs --since "$(echo "$TS" | sed 's/ /T/')Z" 2>&1 \
  | grep -ciE 'UnscopedSecretError|address already in use' || true
SH
```
Expected: `box-utc` and `container` within a few seconds of each other. If they differ by hours, the container logs in local time: rewrite `boot-ts-0215.txt` in that zone and re-run. Then a non-zero line count; `0` UnscopedSecretError; **no** `compat` lines (any line naming `hermes-mobile`, `openrouter-image-gen` or `disabled` = **STOP**); the control-socket result recorded verbatim (#123761 — non-fatal, and Task 8 step 10 already required `gateway_state: running`); `0` for the compose-log grep.

- [ ] **A8 Mobile plugin: SHA, adapter, and `/api/plugins/mobile/me` with a real device session**

```bash
ssh root@dc1-1.local "bash -s -- $P_SHA" <<'SH'
set -eu; cd /mnt/user/appdata/hermes
[ "$(docker exec -u 10000 hermes git -C /opt/data/plugins/hermes-mobile log -1 --format=%H)" = "$1" ] && echo PLUGIN-AT-P_SHA
jq -r '.platforms.mobile.state, .platforms.slack.state' data/gateway_state.json
stat -c '%u:%g %a %n' data/mobile/devices.json data/mobile/devices.json.lock 2>&1 || true
P=$(docker exec -u 10000 hermes bash -lc "hermes mobile pair --name bump-check-0215 --url http://127.0.0.1:9119" | grep -m1 -o '{.*}')
ID=$(printf %s "$P" | jq -r .device_id); RT=$(printf %s "$P" | jq -r .rt)
docker exec hermes curl -s -b "hermes_session_rt=$RT" http://127.0.0.1:9119/api/plugins/mobile/me | jq -c '{device_id,name,revoked}'
docker exec -u 10000 hermes bash -lc "hermes mobile revoke $ID" >/dev/null && echo "revoked $ID"
SH
```
Expected, in order:
- `PLUGIN-AT-P_SHA`;
- `connected`, `connected`;
- `10000:10000 600 …devices.json`, then `10000:10000 600 …devices.json.lock`. The lock file exists once any refresh has run since boot; if it is not there yet, re-run the `stat` after the pair below. A `0:0` owner = Plan P's chown did not hold, which locks the dashboard out: **STOP**;
- `{"device_id":"<ID>","name":"bump-check-0215","revoked":false}`;
- `revoked <ID>`. `{"detail":"Not Found"}` = the #67069 gate unmounted the route: **STOP**. The temporary device stays in `devices.json` as revoked; say so in HANDOFF.md.

- [ ] **A9 Skills and curator**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
docker exec -u 10000 hermes bash -lc 'hermes skills list' > /tmp/skills-0215.txt 2>&1
grep -E '(^|[^a-z-])(google-workspace|himalaya|seerr-cli|maps)([^a-z-]|$)' /tmp/skills-0215.txt; echo ---
grep -E 'productivity/(kraken|gmaps|seerr|linkedin)|gws-shared' /tmp/skills-0215.txt; echo ---
docker exec -u 10000 hermes bash -lc 'hermes curator status' > /tmp/curator-0215.txt 2>&1
grep -iE 'prune|stale|archive|kraken|gmaps|gws|seerr|linkedin' /tmp/curator-0215.txt
SH
```
Expected:
- `google-workspace`, `himalaya`, `seerr-cli` and `maps` each marked disabled;
- the five tenant skills listed as enabled;
- curator shows prune builtins off, stale 14 and archive 30, and **no** tenant skill in an archived list.

- [ ] **A10 Brokers: one real call and one exit-77 denial per tenant; one uid each**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
docker exec -i -u 10000 hermes bash -l <<'IN'
for c in "kraken server-time" "gmaps tz --at=45.5019,-73.5674" "gws drive files list" "seerr status" "linkedin me"; do
  out=$($c 2>&1); rc=$?; echo "$c -> exit=$rc :: $(printf %s "$out" | tr -d '\n' | head -c 160)"
done
for c in "linkedin invite" "gws auth login" "seerr request approve 1" "kraken add-order" "gmaps search --api-key=x foo"; do
  $c </dev/null >/dev/null 2>&1; echo "$c -> exit=$?"
done
IN
docker exec hermes ps -eo user,args | grep '[b]roker.py' | awk '{print $1}' | sort -u | wc -l
SH
```
Expected: five `exit=0` lines carrying real data (a server time; `America/Toronto`; Drive file JSON; Seerr status; his LinkedIn identity), then five `exit=77` lines, then `5`.

- [ ] **A11 Dashboard, Slack, Tailscale**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
docker exec hermes curl -sk -H "Host: hermes.kite-opah.ts.net" https://100.89.28.11/login | grep -o "<title>[^<]*</title>"
docker exec hermes sh -c 'cat /proc/$(pgrep -f "tailscaled --state" | head -1)/cmdline | tr "\0" " "; echo' | grep -c userspace-networking || true
docker exec hermes tailscale ip -4
TS=$(cat /mnt/cache/compat/boot-ts-0215.txt)
awk -v ts="$TS" 'FNR==1{f=0} f||substr($0,1,19)>=ts{f=1;print}' /mnt/user/appdata/hermes/data/logs/gateway.log \
  | grep -E "✓ (slack|mobile) connected|Socket Mode" | tail -4
SH
```
Expected: `<title>Sign in — Hermes Agent</title>`; `0`; `100.89.28.11`; post-boot `✓ slack connected`, Socket Mode as @claudius, and `✓ mobile connected`.

- [ ] **A12 Cross-node concurrency probe from the Mac (a second tailnet node)**

`tailscale status >/dev/null 2>&1 && echo ts-up || echo ts-down` → if `ts-down`, hand Gianluca `open -a Tailscale` (his machine; his gate) and wait. Then:
`cd "$WT" && ./scripts/concurrency-probe.sh https://hermes.kite-opah.ts.net/ | tail -1` → `PROBE PASS`. An in-container run counts as partial only.

- [ ] **A13 Record + hand to QA**

Append A1–A12 outputs to `$SCRATCH/acceptance-0215.txt`. The remaining acceptance items live in Task 13's QA list, because they need him or his devices:
- a Slack mention answered;
- refresh after more than 15 min in the background;
- a two-device burst;
- a fresh QR pairing, a chat round-trip, and a `send_message` to `mobile:<id>` with a push;
- the app on 0.21.5 per spec §10.3.

---

## Task 10 — Rollback (conditional: only on a Task 8/9 trigger)

**Files:** none in the repo. It restores `data/config.yaml`, `data/state.db` and `data/kanban.db` from the tarball, and moves the 0.21.5 files to `/mnt/cache/backups/failed-0.21.5-<ts>/` for forensics.
**Interfaces:** Consumes `/mnt/cache/backups/.last-pre-0.21.5` and `hermes-dc1:pre-0.21.5`.

**What it costs:** every conversation, session and kanban change made after the bump is lost from the live DB (it is kept in the forensics dir). **`mobile/` is never restored**: refresh tokens rotated after the bump live there, and restoring would bounce every phone to re-pair. The plugin stays at `P_SHA` (Plan P passes under both tags). A plugin-caused fault is fixed forward by reverting on plugin `main`, because boot pulls `main`.

- [ ] **Step 1: Down, assert the target, retag, restore, up**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -eu; cd /mnt/user/appdata/hermes
B=$(cat /mnt/cache/backups/.last-pre-0.21.5); test -s "$B"
[ "$(docker image inspect hermes-dc1:pre-0.21.5 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = e624e9fde561e1add9388384012b295fde669ade ] \
  || { echo "STOP: rollback tag is not the 0.20.4 build"; exit 1; }
F=/mnt/cache/backups/failed-0.21.5-$(date +%Y%m%d-%H%M%S); install -d -m 0700 "$F"
docker compose down
docker tag hermes-dc1:pre-0.21.5 hermes-dc1:local
for f in config.yaml state.db state.db-wal state.db-shm kanban.db kanban.db-wal kanban.db-shm .env; do
  [ -e "data/$f" ] && mv "data/$f" "$F/"; done
tar -xzpf "$B" --numeric-owner -C data config.yaml state.db kanban.db
test ! -e data/state.db-wal && test ! -e data/.env && echo "restored; no wal; no seeded .env"
docker compose up -d && echo UP
SH
```
Expected: `restored; no wal; no seeded .env`, then `UP`. The seeded `/opt/data/.env` is moved aside because 0.20.4 never had one; left in place it would start 0.20.4's api_server and load the template values.

- [ ] **Step 2: Verify the rollback**

```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
sleep 60; cd /mnt/user/appdata/hermes
docker exec hermes hermes --version | head -1; grep -n '^_config_version' data/config.yaml
docker exec -u 10000 hermes /usr/bin/python3 -c "import sqlite3;print(sqlite3.connect('file:/opt/data/state.db?mode=ro',uri=True).execute('SELECT version FROM schema_version').fetchone()[0])"
jq -r '.gateway_state, .platforms.slack.state, .platforms.mobile.state' data/gateway_state.json
docker exec hermes curl -sk -H "Host: hermes.kite-opah.ts.net" https://100.89.28.11/login | grep -o "<title>[^<]*</title>"
docker exec -u 10000 hermes bash -lc 'kraken server-time' | head -c 120; echo
SH
```
Expected: `Hermes Agent v0.20.4 (2026.8.18)`, `_config_version: 37`, `26`, `running connected connected`, the sign-in title, and a Kraken server time. If 0.20.4 logs a schema error on `projects.db` or `verification_evidence.db`, stop the container, restore that file from the same tarball, and start it again. If the 0.21.5 curator archived any skill during the window, restore `skills/` from the same tarball the same way. Check this with `hermes curator status`, or with a diff of `tar -tzf "$B" skills/` against `data/skills/`. With `prune_builtins: false` this should be empty.

- [ ] **Step 3: Tell Gianluca**

Tell him: the rollback reason with evidence, the forensics dir path, "conversations since `<BOOT_TS>` UTC are not in the live DB", and the next step (a re-plan).

---

## Task 11 — Docs in the same PR, and the wiki

**Files:**
- Modify: `$WT/docs/research/2026-09-28-bump-0.21.5-assessment.md`: append a section and do **not** rewrite the original.
- Create: `$WT/CHANGELOG.md`. The repo has none; spec §9.2 item 10 requires one.
- Modify: `$WT/STATE.md`, `$WT/HANDOFF.md`, `$WT/docs/dc1-runbook.md` (Phase B).
- Wiki (`~/Developer/wiki`): `wiki/work/hermes-deploy.md`, `wiki/work/hermes-agent.md`, `wiki/work/hermes-mobile-plugin.md`, `wiki/work/hermes-mobile-app.md`, `index.md`, `log.md`.

**Interfaces:** Consumes `$SCRATCH/acceptance-0215.txt`, `T_MIG`, `D8`, `P_SHA`, the control-socket result, and Task 8 step 6's outcome.

- [ ] **Step 1: Assessment: append "Execution notes (<date>)"**

Append to the assessment, verbatim headings:
- `## Execution notes (YYYY-MM-DD)`
- **Correction to §1 and the Acceptance list:** at 9.24, `.env.example` is no longer dockerignored (`.dockerignore:43-46`), so stage2 `seed_one ".env" ".env.example"` (stage2-hook.sh:455) seeds `/opt/data/.env` with 11 non-secret assignments before appending `API_SERVER_KEY`. Loaded with `override=True`. It is benign here because `terminal.*` is re-asserted from config.yaml (`env_loader.py` `_reapply_terminal_config_bridge`) and the browser values equal config's. The acceptance is "the seeded set plus `API_SERVER_KEY`, and no compose env name".
- **Measured:** `T_MIG`, the backup size, the probe-build time, the control-socket result, and whether Task 8 step 6 ran.
- **Uncertainty register closures:** the plugin suite count (both cores), the loader smoke (identical), the dry-run (steps 40 and 44 exactly; step 45 a no-op), and #123761's result on shfs. Image-only rollback stays unverified by design, because the rollback restores the DBs.

- [ ] **Step 2: CHANGELOG.md (new)**

```markdown
# Changelog

Deploy-affecting changes to hermes-deploy, newest first. STATE.md is the current-state
reference; this is the history.

## YYYY-MM-DD — hermes 0.21.5 (`v2026.9.24`), PR #NN
- Base `v2026.8.18` (0.20.4, `sha256:22e37bb4…`) → `v2026.9.24` (0.21.5, `sha256:fca358f1…`).
- First boot migrated config 37→46 (steps 40, 44) and state.db schema 26→30 (trigram FTS
  rebuild, T_MIG s). **One-way.** Rollback restores the DBs and loses post-bump conversations.
- His decisions: `compression.threshold_tokens: null` (≈750K on k3's 1M window, not 256K);
  `curator.prune_builtins: false` (upstream's new default; 14/30-day windows kept).
- New: keyed loopback api_server on `127.0.0.1:8642`; `/opt/data/.env` now exists (seeded).
- Plugin `hermes-mobile` at `P_SHA7` (DeviceStore lock, coalesced-approval skip, clarify push).
- Guard: `IMAGE` == `ARG BASE` test; CI now runs on `IMAGE`-only changes.
- Runbook Phase B: extended cold backup, migration dry-run on shfs, integrity check on the
  backup, DB-restoring rollback that never restores `mobile/`, `data/profiles` preflight.

## 2026-08-19 — hermes 0.20.4 (`v2026.8.18`), PR #29
- `:main` snapshot (0.18.2) → release tag `v2026.8.18`; `init: false` + `--assert-owns-pid1`
  guard; `messages_fts_trigram` rebuilt (3.46.1 had hidden the corruption).
```

- [ ] **Step 3: STATE.md**

- **"Deployed now → Gateway":** 0.21.5, `sha256:fca358f1…` = `v2026.9.24`, bumped `<date>` from 0.20.4. Rollback tag `hermes-dc1:pre-0.21.5`. Backup `pre-0.21.5-<ts>.tgz`.
- **Model bullet:** add the compression line (`threshold_tokens: null`, effective ≈750K) and the curator line (`prune_builtins: false`, 14/30).
- **Deploy flow step 1:** the example tag becomes `v2026.9.24`. Add: "the script writes only IMAGE; the ARG sync test fails until `ARG BASE` matches".
- **"Bumping the base image":** a rollback **after a one-way schema migration restores `config.yaml`/`state.db`/`kanban.db` from the tarball, never `mobile/`**, and loses post-bump conversations. See runbook Phase B.
- **Gotchas, new bullets:**
  1. multiplex/secret-scope hazard: never create a second profile; the preflight refuses `data/profiles`;
  2. api_server on `127.0.0.1:8642`, keyed from `/opt/data/.env`;
  3. `/opt/data/.env` is seeded from `.env.example` and loaded `override=True`, so never put a compose env name in it;
  4. #67069 still open, keep both plugin entries;
  5. the control-socket result on shfs (#123761);
  6. the host `sqlite3` is 3.53.3, so use the in-image 3.53.4;
  7. #125273 stores reasoning twice, so `state.db` grows faster on k3 (watch its size);
  8. the plugin checkout is on `main` at `P_SHA`, and the stale `fix/adapter-connect-is-reconnect` local branch is deleted.
- **Fix the stale path:** the linkedin ledger is `credexec-creds/linkedin/state/state.json` (box and runbook L8), not `credexec-creds/linkedin-state/state.json`.
- **Open follow-ups:**
  - `015-supervise-perms` is still open;
  - prune the 0.18.2 tags `pre-0.20.4`/`pre-L`/`preperuid` (his call);
  - `hermes sessions optimize-storage` (opt-in) is not run;
  - the Nous `connections` toolset would compete with gws if he ever signs into Nous Portal;
  - drop `hermes-dc1:pre-0.21.5` after a few clean weeks (his call).

- [ ] **Step 4: HANDOFF.md (rewrite, same shape as the 2026-08-19 one)**

- **Title:** "HANDOFF — hermes is on 0.21.5 and live; your QA is the gate".
- **Header:** date, branch `chore/base-bump-2026.9.24`, PR #NN.
- **"What changed" table:** base, config/schema migrations with `T_MIG`, his two decisions, image tags, backups.
- **The `.env` seeding finding**, then **"Verified live, not argued"**, the A1–A12 one-liners.
- **The temp device** `bump-check-0215`, revoked.
- **Rollback:** the Task 10 block, with its data-loss sentence.
- **"Your QA"**, the Task 13 list.
- **The ready-to-run next step.**

- [ ] **Step 5: Runbook Phase B, updated to what this bump learned**

Edit `docs/dc1-runbook.md` from `## Phase B` to the end:
- **Header:** `— **RAN 2026-08-19 (0.18.2 → 0.20.4); RAN <date> (0.20.4 → 0.21.5)**`.
- **B1:** example `TAG=v2026.9.24`, plus the sync-test sentence.
- **B2:**
  - add the ★ checks from Task 4 steps 4–6 verbatim (compat over both plugins, protocol compliance, the `required_credential_files` grep with a positive control);
  - replace "OLD digest" with "the OLD image (`hermes-dc1:local` — the bare old base is usually not on the box)";
  - add a **B2b — migration dry-run** subsection with Task 5 steps 1–6 verbatim, including "on shfs, via the SQLite backup API, never `cp`" and the 450 s STOP.
- **B4:**
  - `pre-<version>` naming, and "never `pre-0.20.4`/`pre-L`/`preperuid` — 0.18.2 builds";
  - a **B4b plugin checkout** subsection (Task 7 step 3);
  - a **B4c build before the stop** subsection (Task 7 step 4, including "never `compose up` until B5");
  - the backup-list existence check (Task 7 step 5).
- **B5:**
  - the extended backup list and the WAL loop (Task 8 steps 3–4);
  - the backup `integrity_check` + the FTS rebuild (steps 5/6);
  - the "each edit gets its own `.bak-YYYYMMDD-<reason>`" rule, with the sed commands (step 8);
  - the preflight with the `data/profiles` guard (step 9);
  - the migration watch loop (step 10).
- **B6:** add A1–A12 from Task 9 verbatim, incl. `cfgdiff.py` (inline its source) and the post-boot log slice.
- **Rollback — Phase B:** replace the "Two minutes, and it does not need the backup" paragraph with Task 10 (restore list, `.env` aside, never `mobile/`, conversation loss, label assertion). Keep the old two-minute retag only for a bump **without** one-way migrations, and state that 0.21.5 is not one.
- **New note:** `/opt/data/.env` seeding; dc1-1 docker vdisk budget (15 GB free at this bump; STOP below 8 GB).

- [ ] **Step 6: The suite still passes (docs are CI-guarded), then commit**

```bash
cd "$WT" && PYTHONDONTWRITEBYTECODE=1 python3 -m pytest credexec/tests/ -q -p no:cacheprovider > "$SCRATCH/pytest-docs.txt" 2>&1; echo "exit=$?"
tail -1 "$SCRATCH/pytest-docs.txt"
git add CHANGELOG.md STATE.md HANDOFF.md docs/dc1-runbook.md docs/research/2026-09-28-bump-0.21.5-assessment.md
git commit -m "docs: 0.21.5 deployed — STATE, CHANGELOG, HANDOFF, runbook Phase B, assessment execution notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: `exit=0`, `725 passed, 1 skipped, …`. Commit only after `exit=0`. (a `test_docs_policy_coherence` failure means a doc edit broke a policy-prose invariant: fix the prose). Then a commit.

- [ ] **Step 7: Wiki (per `~/Developer/wiki/AGENTS.md`: pull --rebase, one commit, push)**

```bash
cd ~/Developer/wiki && git pull --rebase
```
Edits (integrate, don't append; bump `updated:` on every page touched):
- **`wiki/work/hermes-deploy.md`:**
  - line 15: git state is `main` after #29 plus the bump PR #NN on `chore/base-bump-2026.9.24` (OPEN until his QA);
  - add a Facts entry for the 0.21.5 bump (the CHANGELOG bullets, `T_MIG`, the `.env` finding, the multiplex hazard);
  - **correct the stale 2026-07-24 sentence** "The live checkout was never re-pointed … still tracks that branch" to: the checkout was re-pointed to `main` by 2026-08-19 (STATE.md), and on the bump day it is `main` at `P_SHA`, with the stale local branch deleted;
  - **delete** the Open-follow-ups bullet "Re-point the live `hermes-mobile` plugin checkout to `main`", keeping only its last sentence about dropping the double entry once #67069 ships.
- **`wiki/work/hermes-agent.md` line 19:** "hermes **0.21.5** (release tag `v2026.9.24`) since <date> (was 0.20.4/2026-08-19, 0.18.2/2026-07-18, …)", plus one sentence noting #67069 is still open at 9.24.
- **`wiki/work/hermes-mobile-plugin.md`:**
  - Facts: the test count at `P_SHA`, and "live at `P_SHA` on 0.21.5";
  - a Status entry: DeviceStore path-keyed lock + flock + mkstemp (refresh moved into a threadpool at 0.21.3 #110061), the coalesced-approval skip, the clarify push.
- **`wiki/work/hermes-mobile-app.md`:** one line saying the gateway is now 0.21.5 (the server-request path is live). Leave app details to Plans A/B.
- **`index.md`:** refresh the `hermes-deploy` and `hermes-agent` one-liners. The "0.20.4 … PR #29 still OPEN" wording becomes "0.21.5/`v2026.9.24` live since <date>, PR #NN awaiting QA".
- **`log.md`:** append `## [YYYY-MM-DD] sync | hermes 0.21.5 bump on dc1-1`, with one or two lines naming the pages touched and the stale-checkout correction.

```bash
git add -A wiki/work/hermes-deploy.md wiki/work/hermes-agent.md wiki/work/hermes-mobile-plugin.md wiki/work/hermes-mobile-app.md index.md log.md
git commit -m "sync: YYYY-MM-DD"; git push
git log -1 --format='%h %s' && git status -sb | head -1
```
Expected: `<sha> sync: YYYY-MM-DD` and `## main...origin/main` (no ahead/behind).

---

## Task 12 — PR, adversarial review, CI gate

**Files:** `$SCRATCH/pr-body-0215.md`. **Interfaces:** produces PR number `#NN` (fill it into CHANGELOG/HANDOFF/wiki with a follow-up commit if it was unknown when those were written).

- [ ] **Step 1: Push and open**

The draft PR already exists (Task 3 step 11). Push the docs commits, replace the body and mark the PR ready:
```bash
cd "$WT" && git push origin "$BRANCH"
gh pr edit "$NN" -R gldc/hermes-deploy --body-file "$SCRATCH/pr-body-0215.md"
gh pr ready "$NN" -R gldc/hermes-deploy; echo "ready exit=$?"
```
The PR body includes:
- the summary (base, migrations, decisions);
- "Deployed and verified on dc1-1 before this PR was opened";
- the A1–A12 evidence one-liners;
- the `.env` seeding correction;
- the rollback and its data loss;
- the test count `725 passed, 1 skipped · ruff clean`;
- "QA pending — merge after his pass";
- the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line.

- [ ] **Step 2: CI gate on exit code**

`gh pr checks <NN> -R gldc/hermes-deploy --watch; echo "exit=$?"` → `exit=0`. **STOP** on anything else.

- [ ] **Step 3: Adversarial review**

Dispatch a fresh reviewer subagent (opus) with: `gh pr diff <NN>`, spec §9.2, the assessment, this plan's Tasks 8–10, and `$SCRATCH/acceptance-0215.txt`. The brief: *find wrong commands, a rollback that doesn't restore what the migration changed, runbook text that contradicts what ran, secrets in docs, and acceptance claims without evidence.* Address each finding in a commit, or rebut it with evidence in a PR comment. Re-run step 2 until it prints `exit=0`.

---

## Task 13 — Hand-off to his on-device QA (the gate), then merge

**Files:** none. **Interfaces:** consumes PR `#NN`.

- [ ] **Step 1: Message Gianluca the QA list (spec §10.3 plus the live-only acceptance)**

On 0.21.5, from his phone:
1. Stop a running turn.
2. Steer a running turn.
3. An approval.
4. A clarify batch, including the push-tap into the card.
5. A secret via a throwaway skill.
6. Background the app mid-clarify for **under 10 min**, then foreground.
7. The attach sheet.
8. The composer after a long message.
9. Both themes.
10. **Refresh:** leave the app in the background > 15 min, then resume with no re-pair.
11. **A two-device burst:** open it on two devices at once.
12. Fresh QR pairing, a chat round-trip, and a `send_message` to `mobile:<id>` that arrives with a push.
13. **Slack:** mention @claudius in gldc-it and get a reply.

Ready-to-run next step for him: *"reply `qa pass`, or paste what broke."*

- [ ] **Step 2: Post-QA log check (burst/refresh evidence)**

`dashboard-auth.log` is **JSON lines** (`{"ts":"<ISO-8601 UTC>","event":"refresh_failure",…}`, `hermes_cli/dashboard_auth/audit.py` @9.24). Filter on the fields. The Python-log `awk` passes every line, because `{` sorts after digits, and the exception texts are not event names.
```bash
ssh root@dc1-1.local 'bash -s' <<'SH'
set -u; L=/mnt/user/appdata/hermes/data/logs/dashboard-auth.log
test -s "$L" || { echo "STOP: $L missing/empty"; exit 1; }
TS=$(sed 's/ /T/' /mnt/cache/compat/boot-ts-0215.txt)
echo "refresh_success since boot: $(jq -c --arg ts "$TS" 'select(.ts >= $ts and .event=="refresh_success")' "$L" | wc -l)"
echo "refresh_failure since boot: $(jq -c --arg ts "$TS" 'select(.ts >= $ts and .event=="refresh_failure")' "$L" | wc -l)"
jq -c --arg ts "$TS" 'select(.ts >= $ts and .event=="refresh_failure") | del(.ip, .user_agent)' "$L" | tail -20
SH
echo "ssh exit=$?"
```
Expected:
- `ssh exit=0`;
- a non-zero `refresh_success` count, which shows the >15 min refresh and the burst actually ran;
- `refresh_failure since boot: 0`.

A `refresh_failure` whose time matches his burst or refresh test means a lost update, and Plan P's fix did not hold live. Tell him with the printed lines, and do **not** merge. A failure from a device he knows is stale (revoked/old) is not a lost update. Name it, and it is his call.

- [ ] **Step 3: On `qa pass`: merge, verify, clean up**

```bash
gh pr checks <NN> -R gldc/hermes-deploy --watch; echo "exit=$?"
gh pr merge <NN> -R gldc/hermes-deploy --squash
gh pr view <NN> -R gldc/hermes-deploy --json state,mergeCommit --jq '.state+" "+.mergeCommit.oid'
ssh root@dc1-1.local 'rm -rf /mnt/cache/compat && echo compat-removed'
git -C ~/Developer/hermes-deploy worktree remove "$WT"
```
Expected: `exit=0`, `MERGED <sha>`, `compat-removed`. Then a one-line wiki sync (`git pull --rebase`; hermes-deploy page + index one-liner: "QA passed, PR #NN merged"; `log.md` entry; commit `sync: YYYY-MM-DD`; push). Ask him once about pruning the 0.18.2 image tags; that is his call. Keep `hermes-dc1:pre-0.21.5`.

---

## Self-review

**1. Spec coverage (§9.2 items, §10.2, assessment Steps/Acceptance, review M9/m18/m19/m20):**

| Requirement | Where |
|---|---|
| Merge #29 first, CI gated on exit code | Task 1 |
| B0 re-diff | Task 2 |
| B1 pin in both files + wording, RED→GREEN | Task 3 |
| B2 suite (≥155 + P's tests), differential smoke, `plugins compat` ×2, protocol compliance, `required_credential_files` grep | Task 4 |
| Migration dry-run: steps 40+44, `T_MIG` | Task 5 |
| B3: rsync without `--delete`, stale-rootfs check, `_bindscan` both flags, probe build | Task 6 |
| B4 tag + label assert | Task 7.1 |
| Build before the stop (review 2026-09-28) + backup-list pre-check | Task 7.4, 7.5 |
| Plugin `pull --ff-only` + `log -1` = `P_SHA` (★6b) | Task 7.3 |
| `config.yaml.bak-…-pre0215` | Task 8.1 |
| Stop, WAL 0 | Task 8.2–3 |
| Extended cold backup, 0600 | Task 8.4 |
| `integrity_check` on the backup under 3.53.4, FTS rebuild if malformed | Task 8.5/8.6 |
| His decisions, each with a backup | Task 8.8 (rehearsed in 5.4) |
| Build/up; watch items (`connections` step, control socket, FTS time) | Task 8.9–10; 5.6; 9 A7; 5.5 |
| Rollback: retag, restore config/state(-wal)/kanban, conversation loss, never `mobile/` (m19) | Task 10 |
| Acceptance: version/sqlite/46 + config diff | 9 A1 |
| Model/fallback/chat via `bash -lc` | A2 |
| Effective compression (m18) | A3 |
| `doctor`/schema 30/post-boot `integrity_check` | A4 |
| Multiplex reason + no profiles + STATE note | A5 + 11.3 |
| Listeners + `.env` | A6 |
| `UnscopedSecretError`/`compat` log lines | A7 |
| Skills + curator | A9 |
| Brokers | A10 |
| `/api/plugins/mobile` JSON (#67069) | A8 |
| Dashboard/Slack/Tailscale | A11 + 13.1 |
| Cross-node probe | A12 |
| Refresh >15 min + 2-device burst | 13.1–13.2 (and scripted on the throwaway, S.9) |
| App QA §10.3 | 13.1 |
| STATE/CHANGELOG/wiki ×4, keep both plugin entries, stale wiki line | Task 11 |
| Assessment committed | Task 1.3 + 11.1 |
| §10.2 throwaway: target digest, fresh data dir, dashboard + basic auth via the repo script, plugin at P's branch, no Slack vars, provider env filtered by name, `127.0.0.1:19119`, tunnel, bind/Host-guard checks, body smoke, teardown incl. the data dir, vdisk note | Task S |

**2. Placeholder scan.** No TBDs are left. The runtime values are named variables with a defined source:
- `P_SHA` (Task 0.1);
- `T_MIG` (Task 5.5);
- `D8`/`PIN_DATE` (`date` on the day);
- `<A_PR>`/`<B_PR>`/`<C_PR>` (Plans A/B/C);
- `S_PLUGIN_SHA` (Task S step 3);
- `#NN` (Task 3 step 11, the draft PR);
- `<T>` (the table printed by 8.5);
- `PLUGIN_REF` (Plan P's branch).

**3. Consistency.**
- `hermes-dc1:pre-0.21.5`, `/mnt/cache/compat/cfgdiff.py`, `/mnt/cache/compat/boot-ts-0215.txt`, `/mnt/cache/backups/.last-pre-0.21.5` and `$SCRATCH/env-example-keys-0215.txt` are produced and consumed under the same names.
- The sed commands in Task 5.4 and Task 8.8 are identical.
- The expected A1 diff = the 5.6 lines ∪ the 5.4 lines.

**4. Review Focus.** Each of the six has a check in its owning task: 1→5.5/8.10; 2→5.3/5.5/8.5/8.6/A4; 3→S.7/A7; 4→8.9/A5/A7/11.3; 5→7.3/A8; 6→S.6/A6/11.1.
