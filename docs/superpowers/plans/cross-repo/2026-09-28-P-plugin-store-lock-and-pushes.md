# Plugin: DeviceStore locking, coalesced-approval skip, clarify push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision log (review 2026-09-28)

Adversarial ops review; findings in the controller's scratchpad `plans-review-ops.md`. Changes:
1. **Task 0 step 4** copied this plan from the session scratchpad, which is ephemeral and no longer the reviewed text. It now copies from the app repo's committed copy.
2. **Review Focus 1: the evidence is corrected.** The spec and the assessment say flock "already works on shfs, per the Slack token lock". That lock is an `O_CREAT|O_EXCL` pid record (8.18 `gateway/status.py:1597`), not a flock. `/proc/locks` on dc1-1 shows no hermes flock on shfs (device `0:45`, `/mnt/user` = `fuse.shfs`). The only flock found there belongs to qdrant (`FLOCK ADVISORY WRITE … 00:2d:…`), so acquiring a flock on shfs does work. Whether it *excludes* another process has not been shown. Task 8's shfs run is the only proof, and it is mandatory.
3. **Review Focus 3:** added the core-side evidence that `ProviderError` means 503 with the cookies kept, at both tags.
4. **Task 3 `_locked`/`_flock`:** the thread-lock wait and the flock wait now share **one** deadline. Before, each got the full `lock_timeout`, so the worst case was 2× (20 s). At 8.18 the refresh runs on the dashboard's event loop, so that 20 s would freeze every dashboard request.
5. **Task 5:** the cooldown comment is corrected. When no client is attached at all, 0.21.5 keeps the clarify waiting in `open_requests` (`tui_gateway/session_transports.py:38-47`). It resolves empty at once only when every attached client is a build that predates `client.capabilities`.
6. **Task 8:**
   - `mkdir -p /mnt/cache/compat` runs before the rsync, because rsync creates only the last path component;
   - a docker-vdisk `df` gate;
   - the old base is removed afterwards if this run pulled it;
   - cleanup also runs on the failure path.
7. **Task 8 step 6:** after the merge, plugin `main` is live on the box's **next restart**, even on 0.20.4, because boot pulls `main`. This is now stated in the PR body, with the one-line live check.
8. **Global Constraints:** a note on ssh approvals, because 1Password prompts for each connection.

**Goal:** Make `DeviceStore` safe against concurrent writers, both in-process and cross-process, before the 0.21.5 bump. Also stop duplicate pushes for coalesced approvals, and push a redacted, device-targeted "Hermes has a question" when the agent calls `clarify`. Everything must work on both hermes tags.

**Architecture:**
- Every `DeviceStore` mutator runs its load→modify→save inside `_locked()`. That context manager takes a process-wide `threading.Lock` keyed by the resolved store path, then an `fcntl.flock` on a sidecar `devices.json.lock`.
- Writes go through a unique `tempfile.mkstemp` sibling, then fsync, then `os.replace`.
- `SessionNotifier` gains two changes:
  - a `coalesced` early return;
  - an observe-only `on_pre_tool_call` handler that never raises, returns `None`, and fires the push on a daemon thread, rate-limited per (device, session).

**Tech Stack:** Python stdlib only (`fcntl`, `tempfile`, `threading`, `contextlib`), pytest. The hermes core must be on `PYTHONPATH` for the suite.

**Spec:** `/Users/gldc/Developer/hermes-mobile-app/docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md`:
- §3 item 8;
- §6.5 (push);
- §9.1 (plugin);
- §10.1 ("Plugin (pytest)").

Evidence:
- review M7 and m13: `/Users/gldc/Developer/hermes-mobile-app/docs/research/2026-09-28-spec-review.md`;
- bump assessment §4: it lands in hermes-deploy as `docs/research/2026-09-28-bump-0.21.5-assessment.md`.

## Global Constraints

- Repo `gldc/hermes-mobile-plugin`: **one PR**, branch `fix/store-lock-and-pushes` off `main` (currently `65e6efd`). PR-only; never push `main`. The PR is "merged **before** the bump" (spec §9.1).
- "`DeviceStore` locking, in-process and cross-process (required before the bump)" (spec §3.8).
- "a **module-level lock keyed by the resolved store path**, plus an **`fcntl.flock` on a sidecar lock file**, for cross-process writers" (spec §9.1).
- It "wraps load→modify→save in `create_device`, `rotate_refresh`, `revoke`, `revoke_by_refresh` and `set_push_token`" (spec §9.1).
- "a unique tmp file per write (`tempfile.mkstemp` in the store dir, then `os.replace`), replacing `.devices.json.<pid>.tmp`" (spec §9.1).
- "**RED first**: a threaded test with **two `DeviceStore` instances on one path** (rotate on one, `set_push_token` on the other) that loses an update today; a cross-process test" (spec §9.1).
- "It must pass under both tags":
  - `v2026.8.18` (0.20.4, `nousresearch/hermes-agent@sha256:22e37bb4ed1b0f50cb6bd991dca7ecacd6c9f29df9b4a20fc989d32bc763ccf6`, the current `hermes-deploy/IMAGE`);
  - `v2026.9.24` (0.21.5, `nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7`).
- Coalesced approvals: "`if kwargs.get("coalesced"): return` in the `pre_approval_request` handler, RED first" (spec §9.1).
- Clarify push:
  - "a `pre_tool_call` handler that, for `function_name == "clarify"`, sends the device-targeted redacted push. Observe-only; it never blocks. RED first" (spec §9.1);
  - "redacted body: "Hermes has a question""; a "tap deep-links to the session" (spec §6.5).
  - **The callback kwarg is `tool_name`, not `function_name`.** `function_name` is the caller-side local in core. The hook receives `tool_name`, `args`, `task_id`, `session_id`, `tool_call_id`, `turn_id`, `api_request_id`, `middleware_trace` and `telemetry_schema_version`. This was verified by running core at both tags; see Task 6.
- "No push exists for sudo or secret" (spec §6.5). Do not add one.
- No new dependency. Pushes stay redacted and routing-only in `data`, as in `push.py`.
- Heavy Docker runs happen on dc1-1 (`ssh root@dc1-1.local`), never on the Mac.
- ssh to dc1-1 signs through the **1Password agent**, which asks Gianluca to approve each connection. It will refuse (`agent refused operation`) while he is away. Before Task 8, message him to approve. Then open one master connection and reuse it. Afterwards, close it with `ssh -O exit -o ControlPath=… root@dc1-1.local`.

  ```bash
  ssh -o ControlMaster=auto -o ControlPersist=30m \
      -o ControlPath="$HOME/.ssh/cm-%r@%h:%p" -fN root@dc1-1.local
  ```

  Every later `ssh root@dc1-1.local …` adds the same `-o ControlPath=…`. A refused signature is a STOP for him, never a retry loop.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- This repo has **no CI workflow and no CHANGELOG**. The merge gate is the explicit exit codes of the Task 8 runs, recorded in the PR body. Docs are updated in README.md and docs/CONTRACTS.md.
- zsh gotcha: write `"${T}:path"`, never `"$T:path"`, because zsh treats `$T:h` as a modifier.

## Review Focus

1. **flock on Unraid shfs (FUSE).**
   - *Risk:* `/opt/data` is `/mnt/user/appdata/hermes/data`, which is shfs. flock may be unsupported there (`ENOLCK`), or it may not be released when a holder dies.
   - *Expected:* an unsupported flock degrades to the thread lock with a WARNING, and never fails a refresh. The real proof is the lock suite running on shfs as uid 10000.
   - *Evidence (review 2026-09-28):*
     - The spec's "per the Slack token lock" is **not** evidence: that lock is an `O_CREAT|O_EXCL` pid record, not a flock.
     - On dc1-1, `stat -f` reports `fuse` for `/mnt/user/appdata/hermes/data`, and `/proc/locks` shows qdrant holding a `FLOCK` on a shfs inode (`00:2d:…`). So acquiring a flock on shfs works.
     - Whether it *excludes* a second process is still unproven.
     - A degraded flock cannot pass silently. `test_cross_process_writers_do_not_lose_updates` and `test_lock_held_by_a_killed_process_is_released` both fail if the flock is a no-op, and that is why Task 8's shfs run is the gate.
   - *Pinned by:* Task 3 `test_flock_unsupported_degrades_to_thread_lock`, the `HERMES_MOBILE_LOCKTEST_DIR` fixture, and Task 8's shfs run.
2. **The CLI runs as root.** `docker exec` is root in this image (hermes-deploy STATE.md:206).
   - *Risk:* `docker exec hermes hermes mobile pair` writes a root-owned 0600 `devices.json` (a pre-existing hazard) and lock file. The uid-10000 dashboard then cannot open them, and every phone breaks.
   - *Expected:* root-written files are handed to the store directory's owner, and an unopenable lock degrades instead of failing.
   - *Pinned by:* Task 3 `test_root_writes_hand_files_to_the_store_dir_owner` (a real chown when run as root in Task 8) and `test_unopenable_lock_file_degrades_to_thread_lock`.
3. **A writer dies or hangs holding the lock** (SIGKILL or OOM mid-`pair`, or a wedged process).
   - *Expected:* there is no stale lock, because the kernel drops the flock. A waiter gives up after `lock_timeout` with `DeviceStoreError`, which the auth provider maps to a **transient** `ProviderError`, never `RefreshExpiredError`. A phone is never bounced to re-pair because of a lock.
   - *Pinned by:* Task 3 `test_lock_held_by_a_killed_process_is_released` and `test_refresh_lock_timeout_is_transient_not_repair`.
   - *Core side, verified statically at both tags (review 2026-09-28):*
     - The plugin maps any non-`RefreshTokenError` to `ProviderError` (`auth_provider.py:108-109`). `DeviceStoreError` is not a `RefreshTokenError`.
     - 8.18 `hermes_cli/dashboard_auth/middleware.py:462-468`: a `ProviderError` from the refresh gives a 503 and the cookies are preserved.
     - 9.24 `middleware.py:192-196`: the same, via `run_in_threadpool`. `refresh_singleflight.py:73`: `ProviderError` is deliberately **not** cached, so the phone's retry reaches the store again.
4. **Push storm from clarify retries.**
   - *Risk:* at 0.21.5 a clarify with no capable client attached resolves empty at once, and the model may re-ask in a loop.
   - *Expected:* at most one clarify push per (device, route session) per 30 s. Other sessions are unaffected, and pushes resume after the window.
   - *Pinned by:* Task 5 `test_clarify_cooldown_drops_repeat_questions_for_one_session`.
5. **Hook contract drift and fail-closed dispatch.**
   - *Risk:* from v2026.9.24, a `pre_tool_call` callback that raises, or runs past `plugins.hook_callback_timeout` (30 s), becomes a **block** directive. A hung callback is then skipped, which also means blocked, for later tool calls. Verified: a raising callback yields `[{'action': 'block', ...}]` at 9.24 and `[]` at 8.18.
   - *Expected:* the handler is total and fast under every failure, the kwarg names are captured from core rather than assumed, and the handler yields no directive at either tag.
   - *Pinned by:* Task 5's failure and off-thread tests, and Task 6's contract tests run at both tags.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `hermes_mobile/device_store.py` | modify (Tasks 1–3) | atomic unique-tmp write; `_path_lock`; `_locked()` with thread lock + flock; `lock_path`; `lock_timeout`; `_match_dir_owner` |
| `tests/test_device_store.py` | modify (Task 1) | atomic-write tests |
| `tests/test_device_store_locking.py` | create (Tasks 2–3) | in-process race harness + cross-process/flock/ownership tests |
| `tests/test_auth_provider.py` | modify (Task 3) | lock timeout ⇒ `ProviderError`, not re-pair |
| `hermes_mobile/session_notify.py` | modify (Tasks 4–5) | `coalesced` skip; `ClarifyPushGate`; `on_pre_tool_call`; `_safe_fan_out`; `_run_in_background` |
| `tests/test_session_notify.py` | modify (Tasks 4–5) | coalesced + clarify tests |
| `hermes_mobile/plugin.py`, `plugin.yaml` | modify (Task 5) | register `pre_tool_call`; declare it |
| `tests/test_plugin_registration.py`, `tests/test_plugin_register.py` | modify (Task 5) | registration + manifest/registration parity |
| `tests/test_hook_contract.py` | create (Task 6) | contract tests against the real core at both tags |
| `README.md`, `docs/CONTRACTS.md`, `plugin.yaml`, `dashboard/manifest.json` | modify (Task 7) | docs + version 0.2.0 |
| `docs/superpowers/plans/2026-09-28-plugin-store-lock-and-pushes.md` | create (Task 0) | this plan |

Worktree root, used by every command below: `$HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes`

Core trees for host runs (from `git archive`; the hermes-agent checkout is left untouched):
- `$HOME/.cache/hermes-core/v2026.8.18`
- `$HOME/.cache/hermes-core/v2026.9.24`

Host interpreter: `python3`. The miniconda 3.13 install already has fastapi, pydantic, yaml and pytest. The current suite passes 155/155 against both core trees.

---

### Task 0: Worktree, core trees, baseline, plan committed

**Files:**
- Create: `docs/superpowers/plans/2026-09-28-plugin-store-lock-and-pushes.md`

**Interfaces:** none (setup).

- [ ] **Step 1: Create the branch worktree off current main**

Use superpowers:using-git-worktrees. By hand:

```bash
git -C $HOME/Developer/hermes-mobile-plugin fetch origin
git -C $HOME/Developer/hermes-mobile-plugin log -1 --format=%h origin/main   # expect 65e6efd
mkdir -p $HOME/Developer/hermes-mobile-plugin-worktrees
git -C $HOME/Developer/hermes-mobile-plugin worktree add \
  $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes \
  -b fix/store-lock-and-pushes origin/main
```

- [ ] **Step 2: Extract both core trees (read-only use of the hermes-agent checkout)**

```bash
for T in v2026.8.18 v2026.9.24; do
  D="$HOME/.cache/hermes-core/${T}"
  rm -rf "$D" && mkdir -p "$D"
  git -C $HOME/Developer/hermes-agent archive "${T}" | tar -x -C "$D"
done
ls $HOME/.cache/hermes-core/v2026.9.24/hermes_cli/plugins_dispatch.py   # exists only at 9.24
```

- [ ] **Step 3: Baseline — the suite is green at both tags before any change**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/ -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `155 passed` and `exit=0` for both.

- [ ] **Step 4: Commit this plan into the repo**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
mkdir -p docs/superpowers/plans
# Source = the REVIEWED copy in the app repo (the session scratchpad is ephemeral and pre-review).
SRC=$HOME/Developer/hermes-mobile-app/docs/superpowers/plans/cross-repo/2026-09-28-P-plugin-store-lock-and-pushes.md
test -s "$SRC" && grep -q '^## Revision log (review 2026-09-28)' "$SRC" || { echo "STOP: reviewed plan not found"; exit 1; }
cp "$SRC" docs/superpowers/plans/2026-09-28-plugin-store-lock-and-pushes.md
git add docs/superpowers/plans/2026-09-28-plugin-store-lock-and-pushes.md
git commit -m "docs: plan for DeviceStore locking, coalesced skip, clarify push" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Atomic write with a unique tmp file and fsync

**Files:**
- Modify: `hermes_mobile/device_store.py`: imports (lines 28-36), and `_save` (lines 324-342), which is replaced by `_ensure_dir` + `_save`
- Test: `tests/test_device_store.py` (append at end)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `DeviceStore._ensure_dir(self) -> None`, which creates the store dir, chmod 0700, best-effort;
  - `DeviceStore._save(self, data: Dict[str, Any]) -> None`, which keeps its name and signature. Task 2 monkeypatches `_load`/`_save` by name, so neither may be renamed.

Today `_save` writes every save to `.devices.json.<pid>.tmp`. Two threads in one process share that inode. The prototype race run hit `FileNotFoundError` on `os.replace` because of this. There is also no fsync before the rename. `plugin_api.write_memory_file` already does mkstemp + fsync + replace, and this task matches it.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_device_store.py`:

```python


# ---------------------------------------------------------------------------
# atomic write (spec §9.1: unique tmp per write)
# ---------------------------------------------------------------------------


def test_save_uses_a_unique_tmp_file_per_write(store, store_path, monkeypatch):
    import os
    from pathlib import Path

    import hermes_mobile.device_store as ds

    seen = []
    real_replace = ds.os.replace

    def spy(src, dst):
        seen.append(Path(src))
        return real_replace(src, dst)

    monkeypatch.setattr(ds.os, "replace", spy)
    store.create_device("a")
    store.create_device("b")
    assert len(seen) == 2
    assert seen[0] != seen[1]
    for p in seen:
        assert p.parent == store_path.parent
        assert p.name.startswith(".devices.json.") and p.name.endswith(".tmp")
        assert p.name != f".devices.json.{os.getpid()}.tmp"
    assert [
        p.name for p in store_path.parent.iterdir() if p.name.endswith(".tmp")
    ] == []


def test_save_fsyncs_before_replace(store, monkeypatch):
    import hermes_mobile.device_store as ds

    events = []
    real_fsync, real_replace = ds.os.fsync, ds.os.replace

    def fsync(fd):
        events.append("fsync")
        return real_fsync(fd)

    def replace(src, dst):
        events.append("replace")
        return real_replace(src, dst)

    monkeypatch.setattr(ds.os, "fsync", fsync)
    monkeypatch.setattr(ds.os, "replace", replace)
    store.create_device("phone")
    assert "fsync" in events
    assert events.index("fsync") < events.index("replace")


def test_failed_write_keeps_previous_file_and_leaves_no_tmp(
    store, store_path, monkeypatch
):
    import hermes_mobile.device_store as ds

    store.create_device("first")
    before = store_path.read_text()

    def boom(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(ds.json, "dump", boom)
    with pytest.raises(RuntimeError, match="disk full"):
        store.create_device("second")
    assert store_path.read_text() == before
    assert [
        p.name for p in store_path.parent.iterdir() if p.name.endswith(".tmp")
    ] == []
```

- [ ] **Step 2: Run them — two must fail**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_device_store.py -q -p no:cacheprovider -k "tmp or fsync"
```

Expected:
- `test_save_uses_a_unique_tmp_file_per_write` FAILS (`seen[0] == seen[1]`, the same pid-named tmp);
- `test_save_fsyncs_before_replace` FAILS (`"fsync" in events` is false);
- `test_failed_write_keeps_previous_file_and_leaves_no_tmp` PASSES. It guards behaviour the current code already has.

- [ ] **Step 3: Implement**

In `hermes_mobile/device_store.py`, add `import tempfile` so the import block reads:

```python
import hashlib
import hmac
import json
import logging
import os
import secrets
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
```

Replace the whole `_save` method (from `    def _save(self, data: Dict[str, Any]) -> None:` to the end of the file) with:

```python
    def _ensure_dir(self) -> None:
        directory = self._path.parent
        directory.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(directory, 0o700)
        except OSError:
            pass

    def _save(self, data: Dict[str, Any]) -> None:
        """Atomically replace the store: unique ``mkstemp`` sibling (0600), fsync, rename."""
        self._ensure_dir()
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{self._path.name}.", suffix=".tmp", dir=str(self._path.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, sort_keys=True)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, self._path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
```

Also update the module docstring's last paragraph, which currently says "the file is written atomically with owner-only permissions.", to:

```python
Only SHA-256 hashes of tokens are stored at rest; the file is written
atomically (a unique ``mkstemp`` sibling, fsynced, then ``os.replace``) with
owner-only permissions.
```

- [ ] **Step 4: Run the tests and the full suite**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/ -q -p no:cacheprovider; echo "exit=$?"
```

Expected: `158 passed`, `exit=0`. The existing `test_devices_file_is_owner_only` still passes, because mkstemp creates the file 0600.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format hermes_mobile/device_store.py tests/test_device_store.py
git add hermes_mobile/device_store.py tests/test_device_store.py
git commit -m "fix(store): unique mkstemp tmp + fsync per write (no shared <pid>.tmp)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: In-process lock keyed by the resolved store path

**Files:**
- Modify: `hermes_mobile/device_store.py`: imports; constants after `_MAX_PREV_HASHES`; new `_PATH_LOCKS`/`_path_lock` before `default_devices_path`; `DeviceStore.__init__`; the five mutators; new `_locked`
- Create: `tests/test_device_store_locking.py`

**Interfaces:**
- Consumes: Task 1's `_ensure_dir` and `_save`.
- Produces:
  - `LOCK_TIMEOUT_SECONDS: float = 10.0` (module constant);
  - `_path_lock(path: Path) -> threading.Lock`, the same object for every spelling of one resolved file;
  - `DeviceStore(path=None, clock=time.time, lock_timeout: float = LOCK_TIMEOUT_SECONDS)`;
  - `DeviceStore._locked(self) -> ContextManager[None]`, which raises `DeviceStoreError` whose message contains `"timed out"` on timeout. **Do not nest `_locked()`.** The lock is non-reentrant, and Task 3's flock would self-deadlock.

- [ ] **Step 1: Write the failing tests** — create `tests/test_device_store_locking.py`:

```python
"""Concurrency tests for DeviceStore (spec §9.1, review M7).

Every mutator is a load→modify→save of one JSON file. Several DeviceStore
instances share that file inside one process (the auth provider's and
plugin_api's), and the `hermes mobile` CLI writes it from another process.
HERMES_MOBILE_LOCKTEST_DIR relocates the store (e.g. onto Unraid shfs).
"""

from __future__ import annotations

import os
import shutil
import threading
import uuid
from pathlib import Path

import pytest

import hermes_mobile.device_store as ds
from hermes_mobile.device_store import DeviceStore

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def store_dir(tmp_path):
    base = os.environ.get("HERMES_MOBILE_LOCKTEST_DIR", "").strip()
    if not base:
        yield tmp_path / "mobile"
        return
    d = Path(base) / f"locktest-{uuid.uuid4().hex[:8]}"
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def store_path(store_dir):
    return store_dir / "devices.json"


def _seed(path):
    s = DeviceStore(path=path)
    x_id, x_rt = s.create_device("x")
    y_id, y_rt = s.create_device("y")
    return x_id, x_rt, y_id, y_rt


def _race(monkeypatch, first, second, *, window=0.5):
    """Run first() on thread A and second() on thread B, forcing B's load to land
    inside A's load→save window whenever nothing serializes the two.

    A's first _save waits (up to *window*) until B has loaded. Unlocked, B loads
    the stale file and one update is lost. Locked, B cannot load until A has
    saved, so A just times out the wait and both updates survive.
    """
    a_saving = threading.Event()
    b_loaded = threading.Event()
    real_load, real_save = DeviceStore._load, DeviceStore._save

    def load(self):
        data = real_load(self)
        if threading.current_thread().name == "race-B":
            b_loaded.set()
        return data

    def save(self, data):
        if threading.current_thread().name == "race-A" and not a_saving.is_set():
            a_saving.set()
            b_loaded.wait(window)
        real_save(self, data)

    results, errors = {}, []

    def run(label, fn):
        try:
            results[label] = fn()
        except BaseException as exc:  # noqa: BLE001 — surfaced below
            errors.append((label, repr(exc)))

    with monkeypatch.context() as m:
        m.setattr(DeviceStore, "_load", load)
        m.setattr(DeviceStore, "_save", save)
        ta = threading.Thread(target=run, args=("A", first), name="race-A")
        tb = threading.Thread(target=run, args=("B", second), name="race-B")
        ta.start()
        assert a_saving.wait(5), "thread A never reached its save"
        tb.start()
        ta.join(15)
        tb.join(15)
        assert not ta.is_alive() and not tb.is_alive(), "race threads hung"
    assert errors == [], errors
    return results


def test_path_lock_is_shared_by_aliases_of_one_file(tmp_path):
    real = tmp_path / "mobile"
    real.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)
    assert ds._path_lock(real / "devices.json") is ds._path_lock(alias / "devices.json")
    assert ds._path_lock(real / "devices.json") is not ds._path_lock(
        real / "other.json"
    )


def test_race_rotate_vs_set_push_token_keeps_both(monkeypatch, store_path):
    x_id, x_rt, _, _ = _seed(store_path)
    a, b = DeviceStore(path=store_path), DeviceStore(path=store_path)
    r = _race(
        monkeypatch,
        lambda: a.rotate_refresh(x_rt),
        lambda: b.set_push_token(x_id, "ExponentPushToken[new]"),
    )
    fresh = DeviceStore(path=store_path)
    assert fresh.get_push_token(x_id) == "ExponentPushToken[new]"
    fresh.rotate_refresh(r["A"][1])  # UnknownRefreshTokenError if the rotation was lost


def test_race_two_devices_rotating_keeps_both(monkeypatch, store_path):
    _, x_rt, _, y_rt = _seed(store_path)
    a, b = DeviceStore(path=store_path), DeviceStore(path=store_path)
    r = _race(
        monkeypatch, lambda: a.rotate_refresh(x_rt), lambda: b.rotate_refresh(y_rt)
    )
    fresh = DeviceStore(path=store_path)
    fresh.rotate_refresh(r["A"][1])
    fresh.rotate_refresh(r["B"][1])


def test_race_logout_vs_rotate_keeps_both(monkeypatch, store_path):
    x_id, x_rt, _, y_rt = _seed(store_path)
    a, b = DeviceStore(path=store_path), DeviceStore(path=store_path)
    r = _race(
        monkeypatch, lambda: a.revoke_by_refresh(x_rt), lambda: b.rotate_refresh(y_rt)
    )
    assert r["A"] is True
    fresh = DeviceStore(path=store_path)
    assert fresh.get_device(x_id)["revoked"] is True
    fresh.rotate_refresh(r["B"][1])


def test_race_pair_vs_revoke_keeps_both(monkeypatch, store_path):
    _, _, y_id, _ = _seed(store_path)
    a, b = DeviceStore(path=store_path), DeviceStore(path=store_path)
    r = _race(monkeypatch, lambda: a.create_device("z"), lambda: b.revoke(y_id))
    z_id, _ = r["A"]
    fresh = DeviceStore(path=store_path)
    assert fresh.get_device(z_id) is not None
    assert fresh.get_device(y_id)["revoked"] is True
```

- [ ] **Step 2: Run — all five must fail**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_device_store_locking.py -q -p no:cacheprovider
```

Expected: `5 failed`.
- `test_path_lock_…` fails with `AttributeError: … no attribute '_path_lock'`.
- The four race tests each lose an update (verified on a prototype after Task 1). The failures look like:
  - `assert None == 'ExponentPushToken[new]'`;
  - `UnknownRefreshTokenError: refresh token not recognised`;
  - `assert False is True`;
  - `assert None is not None`.

- [ ] **Step 3: Implement**

Imports in `hermes_mobile/device_store.py` become:

```python
import hashlib
import hmac
import json
import logging
import os
import secrets
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple
```

Directly after `_MAX_PREV_HASHES = 50` add:

```python

#: How long a mutator waits for the store lock before raising DeviceStoreError
#: (the auth provider turns that into a transient ProviderError, never a re-pair).
LOCK_TIMEOUT_SECONDS = 10.0
_LOCK_POLL_SECONDS = 0.02
```

Directly before `def default_devices_path() -> Path:` add:

```python
# One lock per resolved store file, shared by every DeviceStore in the process.
_PATH_LOCKS: Dict[str, threading.Lock] = {}
_PATH_LOCKS_GUARD = threading.Lock()


def _path_lock(path: Path) -> threading.Lock:
    """The process-wide lock for *path* (symlinks and relative spellings resolve to one key)."""
    key = str(Path(path).resolve())
    with _PATH_LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = _PATH_LOCKS[key] = threading.Lock()
        return lock


```

Replace `DeviceStore.__init__` with:

```python
    def __init__(
        self,
        path: Optional[Path] = None,
        clock: Callable[[], float] = time.time,
        lock_timeout: float = LOCK_TIMEOUT_SECONDS,
    ) -> None:
        self._path = Path(path) if path is not None else default_devices_path()
        self._clock = clock
        self._lock_timeout = float(lock_timeout)
```

Replace the five mutators with these versions. The bodies are unchanged except that they are wrapped in `with self._locked():`.

```python
    def create_device(self, name: str) -> Tuple[str, str]:
        """Mint a new device record. Returns ``(device_id, refresh_token)``.

        The refresh token is returned exactly once (for the pairing QR);
        only its hash is stored.
        """
        device_id = secrets.token_hex(8)
        refresh_token = secrets.token_urlsafe(32)
        now = self._now()
        with self._locked():
            data = self._load()
            data["devices"][device_id] = {
                "device_id": device_id,
                "name": str(name),
                "created_at": now,
                "revoked": False,
                "refresh_token_hash": _hash_token(refresh_token),
                "refresh_expires_at": now + REFRESH_TTL_SECONDS,
                "prev_refresh_token_hashes": [],
                "access_token_hash": "",
                "access_expires_at": 0,
                "last_refresh_at": 0,
                "push_token": "",
            }
            self._save(data)
        return device_id, refresh_token

    def rotate_refresh(self, refresh_token: str) -> Tuple[str, str, int]:
        """Exchange a live RT for ``(access_token, refresh_token, expires_at)``.

        Rotates both tokens. Replaying the immediately-prior RT re-rotates
        instead of revoking (the client is one rotation behind — a lost/retried
        response — and self-heals regardless of elapsed time; distance-based,
        not time-based). Raises:
            UnknownRefreshTokenError — RT unrecognised or device revoked
            ExpiredRefreshTokenError — RT past its 30-day window
            ReusedRefreshTokenError  — an older rotated-out RT (two+ rotations
                                       back) was replayed; the device is revoked
                                       as a side effect
            DeviceStoreError         — the store lock could not be taken in time
        """
        with self._locked():
            h = _hash_token(refresh_token or "")
            data = self._load()
            now = self._now()

            for dev in data["devices"].values():
                current_match = _hashes_equal(dev["refresh_token_hash"], h)
                prev_match = any(
                    _hashes_equal(prev, h)
                    for prev in dev.get("prev_refresh_token_hashes", [])
                )
                if not (current_match or prev_match):
                    continue
                if dev.get("revoked"):
                    raise UnknownRefreshTokenError("device is revoked")
                if prev_match:
                    prevs = dev.get("prev_refresh_token_hashes", [])
                    immediate_prior = bool(prevs) and _hashes_equal(prevs[0], h)
                    if not immediate_prior:
                        # A rotated-out token older than the immediate prior (two+
                        # rotations back): the chain is compromised → revoke.
                        dev["revoked"] = True
                        self._save(data)
                        raise ReusedRefreshTokenError(dev["device_id"])
                    # The immediately-prior RT: the client is exactly one rotation
                    # behind (it never durably received the last rotation's
                    # response). Re-rotate forward instead of revoking — independent
                    # of elapsed time. Logged so a sustained ping-pong stays visible.
                    logger.warning(
                        "device %s replayed the immediately-prior refresh token; "
                        "re-rotating (client was one rotation behind)",
                        dev["device_id"],
                    )
                if int(dev.get("refresh_expires_at", 0)) <= now:
                    raise ExpiredRefreshTokenError("refresh token expired")

                access_token = secrets.token_urlsafe(32)
                new_refresh = secrets.token_urlsafe(32)
                expires_at = now + ACCESS_TTL_SECONDS
                prev = [dev["refresh_token_hash"]] + list(
                    dev.get("prev_refresh_token_hashes", [])
                )
                dev["prev_refresh_token_hashes"] = prev[:_MAX_PREV_HASHES]
                dev["refresh_token_hash"] = _hash_token(new_refresh)
                dev["refresh_expires_at"] = now + REFRESH_TTL_SECONDS
                dev["access_token_hash"] = _hash_token(access_token)
                dev["access_expires_at"] = expires_at
                dev["last_refresh_at"] = now
                self._save(data)
                return access_token, new_refresh, expires_at

            raise UnknownRefreshTokenError("refresh token not recognised")
```

```python
    def revoke(self, device_id: str) -> None:
        """Revoke a device by id. No-op for unknown ids."""
        with self._locked():
            data = self._load()
            dev = data["devices"].get(device_id)
            if dev is None:
                return
            dev["revoked"] = True
            self._save(data)

    def revoke_by_refresh(self, refresh_token: str) -> bool:
        """Best-effort revoke by RT (current or rotated-out). True if found."""
        with self._locked():
            h = _hash_token(refresh_token or "")
            data = self._load()
            for dev in data["devices"].values():
                if _hashes_equal(dev["refresh_token_hash"], h) or any(
                    _hashes_equal(prev, h)
                    for prev in dev.get("prev_refresh_token_hashes", [])
                ):
                    dev["revoked"] = True
                    self._save(data)
                    return True
            return False
```

```python
    def set_push_token(self, device_id: str, token: str) -> bool:
        """Store/refresh the device's Expo push token.

        Returns False for unknown or revoked devices. The push token is
        stored as-is (it is needed verbatim to call Expo's push API; it
        is not a credential against this gateway).
        """
        with self._locked():
            data = self._load()
            dev = data["devices"].get(device_id)
            if dev is None or dev.get("revoked"):
                return False
            dev["push_token"] = str(token or "")
            self._save(data)
            return True
```

Insert this directly above `_ensure_dir`. Task 3 extends it with the flock.

```python
    @contextmanager
    def _locked(self) -> Iterator[None]:
        """Hold the store for one load→modify→save. Do not nest.

        Threads: the process-wide lock for the resolved path (0.21.5 refreshes in a
        threadpool, and the dashboard holds several DeviceStore instances).
        """
        thread_lock = _path_lock(self._path)
        if not thread_lock.acquire(timeout=self._lock_timeout):
            raise DeviceStoreError(
                f"timed out after {self._lock_timeout:g}s waiting for {self._path}"
            )
        try:
            yield
        finally:
            thread_lock.release()
```

The readers (`verify_access`, `get_device`, `get_push_token`, `list_devices`) stay lock-free. `os.replace` is atomic, so a reader always sees one whole version of the file.

- [ ] **Step 4: Run the tests and the full suite**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/ -q -p no:cacheprovider; echo "exit=$?"
```

Expected: `163 passed` (about 2 s of it is the four race windows) and `exit=0`.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format hermes_mobile/device_store.py tests/test_device_store_locking.py
git add hermes_mobile/device_store.py tests/test_device_store_locking.py
git commit -m "fix(store): path-keyed module lock around every load-modify-save (M7)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cross-process flock on a sidecar lock file, stale-lock safety, root ownership

**Files:**
- Modify: `hermes_mobile/device_store.py`: `import fcntl`; `_match_dir_owner` after `_path_lock`; the `lock_path` property; `_locked`, which is extended; new `_open_lock_file` and `_flock`; `_save`, which gains the chown
- Modify: `tests/test_device_store_locking.py` (imports + appended tests)
- Modify: `tests/test_auth_provider.py` (append one test)

**Interfaces:**
- Consumes: Task 2's `_path_lock`, `_locked`, `lock_timeout` and `LOCK_TIMEOUT_SECONDS`, and Task 1's `_ensure_dir`/`_save`.
- Produces:
  - `DeviceStore.lock_path -> Path`, which is `<store>.lock`, for example `devices.json.lock`, mode 0600;
  - `_match_dir_owner(path: Path, directory: Path) -> None`;
  - `_locked()` now also holds `fcntl.flock(LOCK_EX)` on `lock_path`. The lock times out after `lock_timeout` with `DeviceStoreError("timed out …")`. The thread-lock wait and the flock wait share **one** deadline, so the total wait never exceeds `lock_timeout` (review 2026-09-28). At 8.18 the refresh runs on the dashboard event loop. An unopenable lock file, or an `OSError` other than EWOULDBLOCK from flock, degrades to thread-only locking and logs a WARNING containing `cross-process locking disabled`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_device_store_locking.py`, replace the import block with:

```python
import errno
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pytest

import hermes_mobile.device_store as ds
from hermes_mobile.device_store import DeviceStore, DeviceStoreError
```

Append:

```python


# ---- cross-process ------------------------------------------------------

_WRITER = r"""
import sys, time
from pathlib import Path
from hermes_mobile.device_store import DeviceStore
path, gate, name = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
real_save = DeviceStore._save
def slow_save(self, data):
    time.sleep(0.3)
    real_save(self, data)
DeviceStore._save = slow_save
while not gate.exists():
    time.sleep(0.005)
DeviceStore(path=path).create_device(name)
"""

_HOLDER = r"""
import fcntl, os, sys, time
fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX)
print("locked", flush=True)
time.sleep(600)
"""


def _child_env():
    extra = os.environ.get("PYTHONPATH", "")
    return dict(
        os.environ, PYTHONPATH=os.pathsep.join(p for p in (str(REPO_ROOT), extra) if p)
    )


def test_lock_path_is_a_sidecar_next_to_the_store(store_path):
    s = DeviceStore(path=store_path)
    assert s.lock_path == store_path.with_name("devices.json.lock")
    s.create_device("a")
    assert s.lock_path.exists()
    assert s.lock_path.stat().st_mode & 0o777 == 0o600


def test_cross_process_writers_do_not_lose_updates(store_dir, store_path):
    # Three CLI-like processes pair at once; each widens its load→save window to
    # 0.3 s. Unlocked, every one loads the empty store and the last save wins.
    store_dir.mkdir(parents=True, exist_ok=True)
    gate = store_dir / "go"
    procs = [
        subprocess.Popen(
            [sys.executable, "-c", _WRITER, str(store_path), str(gate), f"proc{i}"],
            env=_child_env(),
        )
        for i in range(3)
    ]
    try:
        time.sleep(1.0)
        gate.touch()
        assert [p.wait(timeout=60) for p in procs] == [0, 0, 0]
    finally:
        for p in procs:
            if p.poll() is None:
                p.kill()
                p.wait()
    names = sorted(d["name"] for d in DeviceStore(path=store_path).list_devices())
    assert names == ["proc0", "proc1", "proc2"]


def test_lock_held_by_a_killed_process_is_released(store_dir, store_path):
    store_dir.mkdir(parents=True, exist_ok=True)
    store = DeviceStore(path=store_path, lock_timeout=5.0)
    holder = subprocess.Popen(
        [sys.executable, "-c", _HOLDER, str(store.lock_path)],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert holder.stdout.readline().strip() == "locked"
        impatient = DeviceStore(path=store_path, lock_timeout=0.2)
        with pytest.raises(DeviceStoreError, match="timed out"):
            impatient.create_device("while-held")
        holder.kill()  # SIGKILL: no cleanup code runs in the holder
        holder.wait(timeout=10)
        device_id, _ = store.create_device("after-crash")
        assert store.get_device(device_id)["name"] == "after-crash"
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()
        holder.stdout.close()


@pytest.mark.skipif(os.geteuid() == 0, reason="root bypasses file permissions")
def test_unopenable_lock_file_degrades_to_thread_lock(store_path, caplog):
    s = DeviceStore(path=store_path)
    s.create_device("first")
    os.chmod(s.lock_path, 0)
    try:
        with caplog.at_level(logging.WARNING, logger="hermes_mobile.device_store"):
            device_id, _ = s.create_device("second")
        assert s.get_device(device_id)["name"] == "second"
        assert "cross-process locking disabled" in caplog.text
    finally:
        os.chmod(s.lock_path, 0o600)


def test_flock_unsupported_degrades_to_thread_lock(store_path, monkeypatch, caplog):
    s = DeviceStore(path=store_path)

    def no_flock(fd, op):
        raise OSError(errno.ENOLCK, "No locks available")

    monkeypatch.setattr(ds.fcntl, "flock", no_flock)
    with caplog.at_level(logging.WARNING, logger="hermes_mobile.device_store"):
        device_id, _ = s.create_device("a")
    assert s.get_device(device_id)["name"] == "a"
    assert "cross-process locking disabled" in caplog.text


def test_root_writes_hand_files_to_the_store_dir_owner(store_path, monkeypatch):
    # `docker exec` is root on dc1-1; a root-owned 0600 devices.json or lock file
    # would lock the uid-10000 dashboard out of every device.
    store_path.parent.mkdir(parents=True, exist_ok=True)
    s = DeviceStore(path=store_path)
    if os.geteuid() == 0:
        os.chown(store_path.parent, 10000, 10000)
        s.create_device("a")
        for p in (store_path, s.lock_path):
            st = p.stat()
            assert (st.st_uid, st.st_gid) == (10000, 10000), p
        return
    calls = []
    monkeypatch.setattr(ds.os, "geteuid", lambda: 0)
    monkeypatch.setattr(
        ds.os, "chown", lambda p, uid, gid: calls.append((Path(p).name, uid, gid))
    )
    s.create_device("a")
    st = store_path.parent.stat()
    names = {c[0] for c in calls}
    assert "devices.json.lock" in names
    assert any(n.startswith(".devices.json.") and n.endswith(".tmp") for n in names)
    assert all((uid, gid) == (st.st_uid, st.st_gid) for _, uid, gid in calls)
```

Append to `tests/test_auth_provider.py`:

```python


def test_refresh_lock_timeout_is_transient_not_repair(tmp_path, clock):
    """A store lock we cannot get is an outage (ProviderError → retry), never an
    auth failure (RefreshExpiredError → the phone is bounced to re-pair)."""
    import fcntl
    import os

    from hermes_cli.dashboard_auth import ProviderError

    store = DeviceStore(path=tmp_path / "devices.json", clock=clock, lock_timeout=0.2)
    _, rt = store.create_device("phone")
    fd = os.open(store.lock_path, os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        with pytest.raises(ProviderError):
            MobileDeviceProvider(store=store).refresh_session(refresh_token=rt)
    finally:
        os.close(fd)
    # The device survived: the same RT still rotates once the lock is free.
    session = MobileDeviceProvider(store=store).refresh_session(refresh_token=rt)
    assert session.refresh_token
```

- [ ] **Step 2: Run — the new tests must fail**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_device_store_locking.py tests/test_auth_provider.py -q -p no:cacheprovider
```

Expected: 7 failures.
- `lock_path` tests: `AttributeError: 'DeviceStore' object has no attribute 'lock_path'`, in `test_lock_path…`, `test_lock_held…`, `test_unopenable…` and `test_refresh_lock_timeout…`.
- `test_cross_process…`: `assert ['proc0'] == ['proc0', 'proc1', 'proc2']`, or a similar single survivor.
- `test_flock_unsupported…`: `AttributeError`, because the module has no `fcntl` attribute yet.
- `test_root_writes…`: no chown calls.

The 5 Task 2 tests still pass.

- [ ] **Step 3: Implement**

Add `import fcntl` as the first import. The block now starts `import fcntl` / `import hashlib` / ….

After `_path_lock` (before `default_devices_path`) add:

```python
def _match_dir_owner(path: Path, directory: Path) -> None:
    """When root writes the store (``docker exec`` is root on dc1-1), hand the file to the
    store directory's owner so the uid-10000 dashboard can still open it. No-op otherwise."""
    if os.geteuid() != 0:
        return
    try:
        st = os.stat(directory)
        if st.st_uid != 0:
            os.chown(path, st.st_uid, st.st_gid)
    except OSError as exc:
        logger.warning(
            "hermes-mobile: could not chown %s to the store owner: %s", path, exc
        )


```

After `__init__` add:

```python
    @property
    def lock_path(self) -> Path:
        """Sidecar ``flock`` target (``devices.json.lock``) next to the store."""
        return self._path.with_name(self._path.name + ".lock")
```

Replace `_locked` and add the two helpers:

```python
    @contextmanager
    def _locked(self) -> Iterator[None]:
        """Hold the store for one load→modify→save. Do not nest.

        Threads: the process-wide lock for the resolved path (0.21.5 refreshes in a
        threadpool, and the dashboard holds several DeviceStore instances).
        Processes: an exclusive ``flock`` on :attr:`lock_path` (``hermes mobile
        pair``/``revoke``). The kernel drops a flock when its holder dies, so a
        crash cannot leave a stale lock.
        """
        thread_lock = _path_lock(self._path)
        if not thread_lock.acquire(timeout=self._lock_timeout):
            raise DeviceStoreError(
                f"timed out after {self._lock_timeout:g}s waiting for {self._path}"
            )
        try:
            fd = self._open_lock_file()
            try:
                if fd is not None:
                    self._flock(fd)
                yield
            finally:
                if fd is not None:
                    os.close(fd)  # closing the fd releases the flock
        finally:
            thread_lock.release()

    def _open_lock_file(self) -> Optional[int]:
        self._ensure_dir()
        try:
            fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        except OSError as exc:
            logger.warning(
                "hermes-mobile: cannot open %s (%s); cross-process locking disabled "
                "for this write",
                self.lock_path,
                exc,
            )
            return None
        _match_dir_owner(self.lock_path, self._path.parent)
        return fd

    def _flock(self, fd: int) -> None:
        deadline = time.monotonic() + self._lock_timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise DeviceStoreError(
                        f"timed out after {self._lock_timeout:g}s waiting for "
                        f"{self.lock_path}"
                    ) from None
                time.sleep(_LOCK_POLL_SECONDS)
            except OSError as exc:
                logger.warning(
                    "hermes-mobile: flock unsupported on %s (%s); cross-process "
                    "locking disabled for this write",
                    self.lock_path,
                    exc,
                )
                return
```

In `_save`, insert the chown between the `with` block and `os.replace`:

```python
                os.fsync(fh.fileno())
            _match_dir_owner(Path(tmp_name), self._path.parent)
            os.replace(tmp_name, self._path)
```

Add one line to the module docstring after the atomic-write paragraph:

```python
Writers are serialized by a process-wide lock keyed by the resolved path plus an
exclusive ``flock`` on the ``devices.json.lock`` sidecar (cross-process: the CLI).
```

- [ ] **Step 4: Run the tests and the full suite at both tags**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/ -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `170 passed`, `exit=0` for both. On the Mac (non-root) the unopenable-lock test runs, and the root-owner test takes its monkeypatched branch.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format hermes_mobile/device_store.py tests/test_device_store_locking.py tests/test_auth_provider.py
git add hermes_mobile/device_store.py tests/test_device_store_locking.py tests/test_auth_provider.py
git commit -m "fix(store): flock sidecar for cross-process writers; root writes keep the dir owner" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Skip coalesced approval pushes

**Files:**
- Modify: `hermes_mobile/session_notify.py:159-163`, which is `on_pre_approval_request`
- Test: `tests/test_session_notify.py` (append)

**Interfaces:**
- Produces: `SessionNotifier.on_pre_approval_request(session_key=None, surface=None, coalesced: bool = False, **_) -> None`.

Both tags fire `pre_approval_request` with `coalesced=True` for a follower that waits on an identical pending prompt:
- v2026.8.18: `tools/approval.py:4113`;
- v2026.9.24: `tools/approval_gateway_wait.py:110`.

So today's code already sends a duplicate push. This is not new at 0.21.5.

- [ ] **Step 1: Write the failing test** — append to `tests/test_session_notify.py`:

```python


# ---------------------------------------------------------------------------
# coalesced approvals (spec §9.1)
# ---------------------------------------------------------------------------


def test_coalesced_approval_follower_does_not_push(store):
    dev = _tokened(store)
    push = RecordingPush()
    get_registry().claim(dev, "SID", "SKEY", route_id="SKEY")
    n = SessionNotifier(store=store, push=push, registry=get_registry())
    n.on_pre_approval_request(
        session_key="SKEY", surface="gateway", command="rm -rf /tmp/x", coalesced=True
    )
    assert push.sent == []
    # The leader (no coalesced flag) still pushes.
    n.on_pre_approval_request(
        session_key="SKEY", surface="gateway", command="rm -rf /tmp/x"
    )
    assert len(push.sent) == 1
```

- [ ] **Step 2: Run — it must fail**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_session_notify.py -q -p no:cacheprovider -k coalesced
```

Expected: FAIL. `assert [{...approval_request...}] == []`, because `coalesced` is swallowed by `**_` and a push is sent.

- [ ] **Step 3: Implement** — replace the method's signature and first guard:

```python
    def on_pre_approval_request(
        self,
        session_key: Optional[str] = None,
        surface: Optional[str] = None,
        coalesced: bool = False,
        **_,
    ) -> None:
        if not _enabled() or surface != "gateway":
            return
        if coalesced:
            # A follower of an identical pending prompt (hermes coalesces parallel
            # duplicates; the leader already pushed). Both v2026.8.18 and v2026.9.24
            # fire this with coalesced=True.
            logger.debug(
                "hermes-mobile: session-notify approval coalesced "
                "(session_key=%s); skipping",
                session_key,
            )
            return
```

The rest of the method (from `hit = self._registry.resolve(session_key)` on) is unchanged.

- [ ] **Step 4: Run the full suite**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/ -q -p no:cacheprovider; echo "exit=$?"
```

Expected: `171 passed`, `exit=0`.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format hermes_mobile/session_notify.py tests/test_session_notify.py
git add hermes_mobile/session_notify.py tests/test_session_notify.py
git commit -m "fix(notify): skip coalesced approval followers (no duplicate push)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Clarify push through an observe-only `pre_tool_call` hook

**Files:**
- Modify: `hermes_mobile/session_notify.py`: typing import; constants; `ClarifyPushGate` and `_run_in_background` before `_enabled`; `SessionNotifier.__init__`; new `on_pre_tool_call` and `_safe_fan_out` after `on_pre_approval_request`; module docstring
- Modify: `hermes_mobile/plugin.py:53-59`, which is `_register_session_notify`
- Modify: `plugin.yaml` (`provides_hooks`)
- Test: `tests/test_session_notify.py` (top imports, mid-file import, appended tests); `tests/test_plugin_registration.py` (append); `tests/test_plugin_register.py` (append)

**Interfaces:**
- Consumes: `SessionClaimRegistry.resolve(*ids) -> Optional[tuple[str, str]]`, and `SessionNotifier._fan_out(body, notif_type, *, device_id=None, session_id=None)`. Both are unchanged.
- Produces:
  - `CLARIFY_BODY = "Hermes has a question"`;
  - push `data` = `{"type": "clarify_request", "session_id": <route id>}`;
  - `class ClarifyPushGate(cooldown_seconds: float = 30.0, clock=time.monotonic)` with `.allow(device_id: str, route_id: str) -> bool`;
  - `SessionNotifier(store=None, push=None, registry=None, clarify_gate: Optional[ClarifyPushGate] = None, background: Optional[Callable[[Callable[[], None]], None]] = None)`;
  - `SessionNotifier.on_pre_tool_call(tool_name=None, session_id=None, task_id=None, **_) -> None`, which **always returns None and never raises**;
  - `plugin.register_all` registers `pre_tool_call` → `notifier.on_pre_tool_call`.

Resolution uses `resolve(session_id, task_id)`, exactly like `on_session_end`. Core passes the same ids to both hooks:
- `session_id = agent.session_id`;
- `task_id = effective_task_id` (the TUI `session_key`).

The sources are `agent/inline_tool_executors.py:tool_hook_ids` and `agent/turn_finalizer.py:716` at 9.24, and `turn_finalizer.py:819` at 8.18.

- [ ] **Step 1: Write the failing tests**

In `tests/test_session_notify.py`:

(a) Make the top of the file read:

```python
import threading
import time

from hermes_mobile.session_notify import SessionClaimRegistry
```

(b) Replace the mid-file line `from hermes_mobile.session_notify import SessionNotifier, get_registry` with:

```python
from hermes_mobile.session_notify import (
    ClarifyPushGate,
    SessionNotifier,
    get_registry,
)
```

(c) Append:

```python


# ---------------------------------------------------------------------------
# clarify push via pre_tool_call (spec §6.5, §9.1)
# ---------------------------------------------------------------------------


def _sync(fn):
    fn()


def _no_thread(fn):
    raise RuntimeError("can't start new thread")


class RaisingPush:
    def send(self, *args, **kwargs):
        raise RuntimeError("expo down")


class RaisingRegistry:
    def resolve(self, *ids):
        raise RuntimeError("registry broken")


class RaisingStore:
    def get_push_token(self, device_id):
        raise RuntimeError("store broken")

    def list_devices(self):
        raise RuntimeError("store broken")


class SpyStore:
    def __init__(self):
        self.touched = []

    def __getattr__(self, name):
        self.touched.append(name)
        raise AttributeError(name)


def test_clarify_pushes_redacted_to_the_claiming_device_only(store):
    dev_a = _tokened(store, name="A", token="ExponentPushToken[A]")
    _tokened(store, name="B", token="ExponentPushToken[B]")
    reg = get_registry()
    reg.claim(dev_a, "LIVE-A", "STORED-A", route_id="STORED-A")
    push = RecordingPush()
    n = SessionNotifier(store=store, push=push, registry=reg, background=_sync)
    ret = n.on_pre_tool_call(
        tool_name="clarify",
        args={"question": "Deploy to prod or staging?", "choices": ["prod", "staging"]},
        session_id="LIVE-A",
        task_id="STORED-A",
        tool_call_id="call_1",
        turn_id="turn_1",
        api_request_id="",
        middleware_trace=[],
        telemetry_schema_version=1,
    )
    assert ret is None
    assert push.sent == [
        {
            "token": "ExponentPushToken[A]",
            "title": "Hermes",
            "body": "Hermes has a question",
            "data": {"type": "clarify_request", "session_id": "STORED-A"},
        }
    ]
    assert "Deploy" not in repr(push.sent) and "staging" not in repr(push.sent)


@pytest.mark.parametrize("tool", ["terminal", "read_file", "delegate_task", "", None])
def test_non_clarify_tools_never_push_or_touch_the_store(tool):
    get_registry().claim("dev-x", "SID")
    push = RecordingPush()
    spy = SpyStore()
    n = SessionNotifier(store=spy, push=push, registry=get_registry(), background=_sync)
    assert (
        n.on_pre_tool_call(
            tool_name=tool, args={"command": "ls"}, session_id="SID", task_id="SID"
        )
        is None
    )
    assert push.sent == []
    assert spy.touched == []


def test_clarify_for_an_unclaimed_session_does_not_push(store):
    _tokened(store)
    push = RecordingPush()
    n = SessionNotifier(
        store=store, push=push, registry=get_registry(), background=_sync
    )
    assert (
        n.on_pre_tool_call(tool_name="clarify", session_id="CLI-1", task_id="CLI-1")
        is None
    )
    assert push.sent == []


@pytest.mark.parametrize("broken", ["push", "registry", "store", "background"])
def test_clarify_push_failures_never_reach_the_agent(store, broken):
    dev = _tokened(store)
    get_registry().claim(dev, "SID", "SKEY", route_id="SKEY")
    n = SessionNotifier(
        store=RaisingStore() if broken == "store" else store,
        push=RaisingPush() if broken == "push" else RecordingPush(),
        registry=RaisingRegistry() if broken == "registry" else get_registry(),
        background=_no_thread if broken == "background" else _sync,
    )
    assert (
        n.on_pre_tool_call(tool_name="clarify", session_id="SID", task_id="SKEY")
        is None
    )


def test_clarify_push_runs_off_the_hook_thread(store):
    dev = _tokened(store)
    get_registry().claim(dev, "SID", route_id="SID")
    release, sent = threading.Event(), threading.Event()

    class SlowPush:
        def send(self, token, title="Hermes", body=None, data=None):
            release.wait(5)
            sent.set()
            return True

    n = SessionNotifier(store=store, push=SlowPush(), registry=get_registry())
    t0 = time.monotonic()
    try:
        assert n.on_pre_tool_call(tool_name="clarify", session_id="SID") is None
        assert time.monotonic() - t0 < 0.5
        assert not sent.is_set()
    finally:
        release.set()
    assert sent.wait(5)


def test_clarify_cooldown_drops_repeat_questions_for_one_session(store):
    dev = _tokened(store)
    reg = get_registry()
    reg.claim(dev, "S1", route_id="S1")
    reg.claim(dev, "S2", route_id="S2")
    clock = {"t": 1000.0}
    push = RecordingPush()
    n = SessionNotifier(
        store=store,
        push=push,
        registry=reg,
        background=_sync,
        clarify_gate=ClarifyPushGate(cooldown_seconds=30, clock=lambda: clock["t"]),
    )
    # A model re-asking in a loop gets one push.
    for _ in range(5):
        n.on_pre_tool_call(tool_name="clarify", session_id="S1")
    assert len(push.sent) == 1
    # Another session has its own window.
    n.on_pre_tool_call(tool_name="clarify", session_id="S2")
    assert len(push.sent) == 2
    clock["t"] += 31
    n.on_pre_tool_call(tool_name="clarify", session_id="S1")
    assert len(push.sent) == 3


def test_clarify_respects_disable_toggle(store, monkeypatch):
    dev = _tokened(store)
    get_registry().claim(dev, "SID")
    monkeypatch.setenv("MOBILE_NOTIFY_ON_SESSION_END", "0")
    push = RecordingPush()
    n = SessionNotifier(
        store=store, push=push, registry=get_registry(), background=_sync
    )
    assert n.on_pre_tool_call(tool_name="clarify", session_id="SID") is None
    assert push.sent == []
```

Append to `tests/test_plugin_registration.py`:

```python


def test_register_all_registers_pre_tool_call_hook(tmp_path):
    ctx = FakeCtx()
    register_all(ctx, store=DeviceStore(path=tmp_path / "devices.json"))
    assert len(ctx.hooks["pre_tool_call"]) == 1
    assert ctx.hooks["pre_tool_call"][0].__name__ == "on_pre_tool_call"
```

Append to `tests/test_plugin_register.py`:

```python


def test_plugin_yaml_declares_every_registered_hook(tmp_path):
    yaml = pytest.importorskip("yaml")
    from hermes_mobile.plugin import register_all

    ctx = FakeCtx()
    register_all(ctx, store=DeviceStore(path=tmp_path / "d.json"))
    manifest = yaml.safe_load((REPO_ROOT / "plugin.yaml").read_text())
    assert set(ctx.hooks) == set(manifest["provides_hooks"])
```

- [ ] **Step 2: Run — they must fail**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_session_notify.py tests/test_plugin_registration.py tests/test_plugin_register.py -q -p no:cacheprovider
```

Expected:
- `test_session_notify.py` errors at collection: `ImportError: cannot import name 'ClarifyPushGate'`.
- `test_register_all_registers_pre_tool_call_hook` FAILS with `KeyError: 'pre_tool_call'`.
- `test_plugin_yaml_declares_every_registered_hook` PASSES for now. It guards parity, and it goes red if Step 3 registers the hook without the manifest line.

- [ ] **Step 3: Implement**

`hermes_mobile/session_notify.py`:

Change `from typing import List, Optional` to `from typing import Callable, List, Optional`.

Replace the constants block with:

```python
SESSION_END_BODY = "Your session is ready — tap to check"
APPROVAL_BODY = "Hermes needs your approval"
CLARIFY_BODY = "Hermes has a question"
_DISABLED_VALUES = {"0", "false", "no", "off"}
_DEFAULT_TTL_SECONDS = 24 * 60 * 60
#: One clarify push per (device, route session) per window. At 0.21.5 a clarify with
#: no capable client attached resolves empty at once and the model may re-ask in a loop.
_CLARIFY_COOLDOWN_SECONDS = 30.0
_GATE_MEMORY_SECONDS = 60 * 60
```

Directly before `def _enabled() -> bool:` add:

```python
class ClarifyPushGate:
    """Thread-safe cooldown: at most one clarify push per (device, route session)
    per ``cooldown_seconds``; entries older than an hour are forgotten."""

    def __init__(
        self,
        cooldown_seconds: float = _CLARIFY_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._cooldown = cooldown_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._last: dict[tuple[str, str], float] = {}

    def allow(self, device_id: str, route_id: str) -> bool:
        now = self._clock()
        key = (device_id, route_id)
        with self._lock:
            self._last = {
                k: t for k, t in self._last.items() if now - t < _GATE_MEMORY_SECONDS
            }
            last = self._last.get(key)
            if last is not None and now - last < self._cooldown:
                return False
            self._last[key] = now
            return True


def _run_in_background(fn: Callable[[], None]) -> None:
    """Fire-and-forget on a daemon thread: the agent never waits on Expo."""
    threading.Thread(target=fn, name="hermes-mobile-clarify-push", daemon=True).start()


```

Replace `SessionNotifier.__init__` with:

```python
    def __init__(
        self,
        store: Optional[DeviceStore] = None,
        push: Optional[ExpoPush] = None,
        registry: Optional[SessionClaimRegistry] = None,
        clarify_gate: Optional[ClarifyPushGate] = None,
        background: Optional[Callable[[Callable[[], None]], None]] = None,
    ) -> None:
        self._store = store if store is not None else DeviceStore()
        self._push = push if push is not None else ExpoPush()
        self._registry = registry if registry is not None else get_registry()
        self._clarify_gate = (
            clarify_gate if clarify_gate is not None else ClarifyPushGate()
        )
        self._background = background if background is not None else _run_in_background
```

Insert after `on_pre_approval_request` (before `_tokened_devices`):

```python
    def on_pre_tool_call(
        self,
        tool_name: Optional[str] = None,
        session_id: Optional[str] = None,
        task_id: Optional[str] = None,
        **_,
    ) -> None:
        """Observe-only ``pre_tool_call``: push when the agent asks a ``clarify``
        question in a claimed session.

        Always returns ``None`` (no directive) and never raises: from v2026.9.24 a
        ``pre_tool_call`` callback that raises, or runs past
        ``plugins.hook_callback_timeout`` (30 s), BLOCKS the tool. So the non-clarify
        path touches nothing, and the push itself runs off-thread.
        """
        try:
            if tool_name != "clarify" or not _enabled():
                return None
            hit = self._registry.resolve(session_id, task_id)
            if hit is None:
                logger.debug(
                    "hermes-mobile: session-notify clarify unclaimed "
                    "(session_id=%s task_id=%s); skipping",
                    session_id,
                    task_id,
                )
                return None
            device_id, route_id = hit
            if not self._clarify_gate.allow(device_id, route_id):
                logger.debug(
                    "hermes-mobile: session-notify clarify within cooldown for "
                    "device %s; skipping",
                    device_id,
                )
                return None
            logger.debug(
                "hermes-mobile: session-notify clarify claimed by device %s -> notifying",
                device_id,
            )
            self._background(
                lambda: self._safe_fan_out(
                    CLARIFY_BODY,
                    "clarify_request",
                    device_id=device_id,
                    session_id=route_id,
                )
            )
        except Exception:
            logger.debug("hermes-mobile: clarify push dispatch failed", exc_info=True)
        return None

    def _safe_fan_out(
        self,
        body: str,
        notif_type: str,
        *,
        device_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> None:
        try:
            self._fan_out(body, notif_type, device_id=device_id, session_id=session_id)
        except Exception:
            logger.debug("hermes-mobile: push fan-out failed", exc_info=True)
```

Update the module docstring's first paragraph to:

```python
"""Session-stop push notifications (docs/plans/session-stop-push-design.md).

Pings paired devices when a mobile-originated run stops / needs approval / asks a
clarify question, or a cron run finishes. ...
```

Keep the rest of the docstring unchanged.

`hermes_mobile/plugin.py`: in `_register_session_notify`, after the `pre_approval_request` line, add:

```python
    ctx.register_hook("pre_tool_call", notifier.on_pre_tool_call)
```

`plugin.yaml`: change the last line to:

```yaml
provides_hooks: [on_session_end, pre_approval_request, pre_tool_call]
```

- [ ] **Step 4: Run the full suite at both tags**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/ -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `187 passed`, `exit=0` for both.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format hermes_mobile/session_notify.py hermes_mobile/plugin.py tests/test_session_notify.py tests/test_plugin_registration.py tests/test_plugin_register.py
git add hermes_mobile/session_notify.py hermes_mobile/plugin.py plugin.yaml tests/test_session_notify.py tests/test_plugin_registration.py tests/test_plugin_register.py
git commit -m "feat(notify): redacted, device-targeted push when the agent calls clarify" \
  -m "Observe-only pre_tool_call handler: never raises, returns None, pushes off-thread, 30 s cooldown per device+session." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Contract tests against the real core (both tags)

**Files:**
- Create: `tests/test_hook_contract.py`

**Interfaces:**
- Consumes: Task 5's `SessionNotifier(..., background=...)` and `on_pre_tool_call`, and `SessionClaimRegistry`. From core, at both tags: `hermes_cli.plugins._get_pre_tool_call_directive_details`, `hermes_cli.plugins.PluginManager` (the `._hooks` dict and `.invoke_hook`), `hermes_cli.plugins.VALID_HOOKS`, and `hermes_cli.lifecycle.invoke_hook`.
- Produces: nothing new. This task is a guard.

These tests do not start RED, because they pin Task 5 against core. Their teeth are proven in Step 3 with a deliberate mutation. They capture the kwargs that core's own dispatcher builds and pass them through a real `PluginManager`. At 9.24 that manager runs the fail-closed, time-bounded path.

- [ ] **Step 1: Write the tests** — create `tests/test_hook_contract.py`:

```python
"""Contract tests against the REAL hermes core on PYTHONPATH.

Run under both v2026.8.18 (0.20.4) and v2026.9.24 (0.21.5). The kwargs are
captured from core's own pre_tool_call dispatcher, not assumed, and pushed
through a real PluginManager. From v2026.9.24 a pre_tool_call callback that
raises or overruns plugins.hook_callback_timeout BLOCKS the tool, so "no
directive under every failure" is the contract that matters.
"""

from __future__ import annotations

import threading
import time

import pytest

import hermes_cli.lifecycle as lifecycle
import hermes_cli.plugins as core_plugins
from hermes_mobile.device_store import DeviceStore
from hermes_mobile.session_notify import SessionClaimRegistry, SessionNotifier


class RecordingPush:
    def __init__(self):
        self.sent = []

    def send(self, token, title="Hermes", body=None, data=None):
        self.sent.append({"token": token, "body": body, "data": data})
        return True


class RaisingPush:
    def send(self, *args, **kwargs):
        raise RuntimeError("expo down")


class RaisingRegistry:
    def resolve(self, *ids):
        raise RuntimeError("registry broken")


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes-home"))


@pytest.fixture
def claimed(tmp_path):
    store = DeviceStore(path=tmp_path / "devices.json")
    dev, _ = store.create_device("phone")
    store.set_push_token(dev, "ExponentPushToken[abc]")
    registry = SessionClaimRegistry()
    registry.claim(dev, "LIVE", "SKEY", route_id="SKEY")
    return store, registry


def _core_kwargs(monkeypatch, tool_name):
    """The exact kwargs core hands pre_tool_call callbacks for one tool call."""
    captured = {}

    def fake_invoke(hook_name, **kwargs):
        captured[hook_name] = kwargs
        return []

    with monkeypatch.context() as m:
        m.setattr(lifecycle, "invoke_hook", fake_invoke)
        core_plugins._get_pre_tool_call_directive_details(
            tool_name,
            {"question": "Deploy to prod?"},
            task_id="SKEY",
            session_id="LIVE",
            tool_call_id="call_1",
            turn_id="turn_1",
        )
    return captured["pre_tool_call"]


def _through_core(monkeypatch, notifier, tool_name):
    pm = core_plugins.PluginManager()
    pm._hooks["pre_tool_call"] = [notifier.on_pre_tool_call]
    return pm.invoke_hook("pre_tool_call", **_core_kwargs(monkeypatch, tool_name))


def test_core_passes_tool_name_and_session_ids_to_pre_tool_call(monkeypatch):
    kw = _core_kwargs(monkeypatch, "clarify")
    assert kw["tool_name"] == "clarify"
    assert kw["session_id"] == "LIVE"
    assert kw["task_id"] == "SKEY"
    assert kw["tool_call_id"] == "call_1"


@pytest.mark.parametrize(
    "case", ["clarify-claimed", "other-tool", "push-raises", "registry-raises"]
)
def test_handler_never_yields_a_directive_through_core(monkeypatch, claimed, case):
    store, registry = claimed
    push = RaisingPush() if case == "push-raises" else RecordingPush()
    notifier = SessionNotifier(
        store=store,
        push=push,
        registry=RaisingRegistry() if case == "registry-raises" else registry,
        background=lambda fn: fn(),
    )
    tool = "terminal" if case == "other-tool" else "clarify"
    assert _through_core(monkeypatch, notifier, tool) == []
    if case == "clarify-claimed":
        assert push.sent == [
            {
                "token": "ExponentPushToken[abc]",
                "body": "Hermes has a question",
                "data": {"type": "clarify_request", "session_id": "SKEY"},
            }
        ]


def test_clarify_hook_returns_promptly_through_core_when_expo_hangs(
    monkeypatch, claimed
):
    store, registry = claimed
    release = threading.Event()

    class HangingPush:
        def send(self, *args, **kwargs):
            release.wait(10)
            return True

    notifier = SessionNotifier(store=store, push=HangingPush(), registry=registry)
    t0 = time.monotonic()
    try:
        assert _through_core(monkeypatch, notifier, "clarify") == []
        assert time.monotonic() - t0 < 2.0
    finally:
        release.set()


def test_core_accepts_every_hook_we_register():
    for hook in ("on_session_end", "pre_approval_request", "pre_tool_call"):
        assert hook in core_plugins.VALID_HOOKS
```

- [ ] **Step 2: Run at both tags — all pass**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/test_hook_contract.py -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `7 passed`, `exit=0` for both.

- [ ] **Step 3: Prove the tests have teeth (mutation check, not committed)**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
python3 - <<'EOF'
p = "hermes_mobile/session_notify.py"
s = open(p).read()
s = s.replace(
    '        try:\n            if tool_name != "clarify" or not _enabled():',
    '        raise RuntimeError("teeth")\n        try:\n            if tool_name != "clarify" or not _enabled():',
    1,
)
open(p, "w").write(s)
EOF
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/test_hook_contract.py -q -p no:cacheprovider; echo "exit=$?"
git checkout -- hermes_mobile/session_notify.py
git diff --exit-code hermes_mobile/session_notify.py && echo "restored"
```

Expected: `5 failed, 2 passed`, `exit=1`. Each `test_handler_never_yields…` case, and the hang test, shows `[{'action': 'block', 'message': 'pre_tool_call plugin callback on_pre_tool_call raised RuntimeError: teeth'}]`. Then `restored` is printed. This mutation was verified on a prototype. At v2026.8.18 the same mutation fails only `clarify-claimed`, because 8.18 swallows callback exceptions. That difference is why both tags are run.

- [ ] **Step 4: Full suite at both tags**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/ -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `194 passed`, `exit=0` for both.

- [ ] **Step 5: Commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
ruff format tests/test_hook_contract.py
git add tests/test_hook_contract.py
git commit -m "test(contract): pre_tool_call kwargs + no-directive dispatch through real core (8.18 & 9.24)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Version 0.2.0, README and CONTRACTS

**Files:**
- Modify: `plugin.yaml` (`version: 0.1.0` → `0.2.0`)
- Modify: `dashboard/manifest.json` (`"version": "0.1.0"` → `"0.2.0"`)
- Modify: `README.md`: the "Session-stop notifications" section, a Security-notes bullet, and the Development section
- Modify: `docs/CONTRACTS.md` (append §6)

**Interfaces:** none (docs).

- [ ] **Step 1: Bump the versions**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
sed -i '' 's/^version: 0.1.0$/version: 0.2.0/' plugin.yaml
sed -i '' 's/"version": "0.1.0"/"version": "0.2.0"/' dashboard/manifest.json
grep -n '^version' plugin.yaml; grep -n '"version"' dashboard/manifest.json
```

Expected: `version: 0.2.0` and `"version": "0.2.0",`.

- [ ] **Step 2: README — replace the "Session-stop notifications" paragraph** with:

```markdown
### Session-stop notifications

When a run you started from the app stops — finished, blocked on an approval, or
the agent asks you a question (`clarify`) — and you're not in the app, Hermes
pushes a redacted "come back" notification (also for finished cron runs):
"Your session is ready — tap to check", "Hermes needs your approval", or
"Hermes has a question". A tap opens that session; the question or approval card
is restored there on resume. The device you're using stays silent (the app
suppresses the banner while foreground). The app binds its device to each session
via `POST /api/plugins/mobile/session-claim` so the gateway knows where to push.
Duplicate approval prompts that hermes coalesces push once, and repeated clarify
questions in one session push at most once per 30 seconds. There is no push for
sudo or secret prompts (hermes exposes no hook for them); those cards appear only
while the chat is open. Enabled by default; disable with
`MOBILE_NOTIFY_ON_SESSION_END=0`. Requires a gateway restart to load the hooks.
To diagnose a missing push, enable `DEBUG` logging for
`hermes_mobile.session_notify` — each ending/approval/clarify session logs whether
it resolved to a device (a silent run that logs "unclaimed" is an attribution miss,
not a push-delivery failure).
```

- [ ] **Step 3: README — add a Security-notes bullet** after the "Tokens are hashed at rest." bullet:

```markdown
- **Concurrent writers are serialized.** Every change to `devices.json` holds a
  process-wide lock plus an `flock` on the sidecar `devices.json.lock`, so token
  refreshes (threaded at hermes ≥ 0.21) and `hermes mobile pair`/`revoke` from
  another process cannot lose each other's updates. A crashed writer never leaves
  a stale lock. When root writes the store (e.g. `docker exec`), the files are
  handed back to the store directory's owner so the gateway user can still read
  them.
```

- [ ] **Step 4: README — Development section.** Replace the code block with:

````markdown
```sh
# hermes-agent source on PYTHONPATH (read-only); run at BOTH supported tags:
for T in v2026.8.18 v2026.9.24; do
  D="$HOME/.cache/hermes-core/${T}"; mkdir -p "$D"
  git -C /path/to/hermes-agent archive "${T}" | tar -x -C "$D"
  PYTHONPATH="$D" python -m pytest tests/ -q
done
# Locking tests on another filesystem (e.g. Unraid shfs):
HERMES_MOBILE_LOCKTEST_DIR=/mnt/user/appdata/hermes-locktest python -m pytest tests/test_device_store_locking.py -q
```
````

- [ ] **Step 5: CONTRACTS.md — append §6**

```markdown

---

## 6. Hooks consumed (`ctx.register_hook`) — verified at v2026.8.18 and v2026.9.24

All three are in `VALID_HOOKS` at both tags (`tests/test_hook_contract.py`).

| Hook | Fired from | Kwargs we read | Notes |
|---|---|---|---|
| `on_session_end` | `agent/turn_finalizer.py` (9.24:716, 8.18:819) | `session_id` (= `agent.session_id`), `task_id` (= tui `session_key`), `interrupted` | bounded, fail-open at 9.24 |
| `pre_approval_request` | 9.24 `tools/approval_gateway_wait.py`; 8.18 `tools/approval.py` | `session_key`, `surface`, `coalesced` | coalesced followers fire with `coalesced=True` at **both** tags (8.18 approval.py:4113, 9.24 approval_gateway_wait.py:110) |
| `pre_tool_call` | `hermes_cli.plugins._get_pre_tool_call_directive_details` (called by the agent tool executors) | `tool_name`, `session_id`, `task_id` | full payload: `tool_name, args, task_id, session_id, tool_call_id, turn_id, api_request_id, middleware_trace, telemetry_schema_version`. **Not** `function_name`/`function_args` (those are caller locals). Return `None` = no directive. **9.24 is fail-closed**: a callback that raises, or exceeds `plugins.hook_callback_timeout` (30 s), becomes `{"action": "block"}` and the tool does not run (`hermes_cli/plugins_dispatch.py:49,237-242`); a hung callback is skipped (= blocked) for later calls. 8.18 logs and ignores callback exceptions. `clarify` reaches this hook on both tags (8.18 `agent/tool_executor.py:2116` → `_run_agent_tool_execution_middleware`; 9.24 `_dispatch_authorized_once`). |
```

- [ ] **Step 6: Suite still green, then commit**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
PYTHONPATH="$HOME/.cache/hermes-core/v2026.9.24" python3 -m pytest tests/ -q -p no:cacheprovider; echo "exit=$?"
git add plugin.yaml dashboard/manifest.json README.md docs/CONTRACTS.md
git commit -m "docs: v0.2.0 — store locking, coalesced skip, clarify push; hook contracts" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `194 passed`, `exit=0`.

---

### Task 8: Verification on the host and inside both base images on dc1-1, then the PR

**Files:** none are changed.

**Interfaces:** none.

The gate is every `exit=` line being `0`, with the counts below. Never gate on `| tail` or `&& echo OK`.

- [ ] **Step 1: Host, both tags**

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
for T in v2026.8.18 v2026.9.24; do
  PYTHONPATH="$HOME/.cache/hermes-core/${T}" python3 -m pytest tests/ -q -p no:cacheprovider; echo "${T} exit=$?"
done
```

Expected: `194 passed` and `exit=0` for both.

- [ ] **Step 2: Sync the branch tree to dc1-1 and prepare an shfs lock dir owned by uid 10000**

```bash
rsync -a --delete --exclude .git --exclude __pycache__ --exclude .pytest_cache --exclude .ruff_cache \
  $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes/ \
  root@dc1-1.local:/mnt/cache/compat/hermes-mobile-plugin-lock/
ssh root@dc1-1.local 'mkdir -p /mnt/user/appdata/hermes-locktest \
  && chown 10000:10000 /mnt/user/appdata/hermes-locktest \
  && chmod 700 /mnt/user/appdata/hermes-locktest \
  && stat -f -c %T /mnt/user/appdata/hermes-locktest'
```

Expected: the last line is a FUSE type (`fuseblk` or `fuse`), which proves the path is shfs, like `/opt/data` in production. If it prints `xfs` or `btrfs`, stop: the shfs check would not be testing shfs.

- [ ] **Step 3: Run the suite inside both images: as root, as uid 10000, and the lock tests on shfs**

```bash
ssh root@dc1-1.local bash -s <<'EOF'
set -u
P=/mnt/cache/compat/hermes-mobile-plugin-lock
L=/mnt/user/appdata/hermes-locktest
rc=0
run() { "$@"; s=$?; echo "exit=$s"; [ "$s" -eq 0 ] || rc=1; }
for D in sha256:22e37bb4ed1b0f50cb6bd991dca7ecacd6c9f29df9b4a20fc989d32bc763ccf6 \
         sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7; do
  IMG="nousresearch/hermes-agent@${D}"
  DEPS="/mnt/cache/compat/pydeps-$(echo "${D}" | cut -c8-19)"
  echo "===== ${D}"
  run docker pull -q "${IMG}"
  rm -rf "${DEPS}" && mkdir -p "${DEPS}"
  run docker run --rm --entrypoint /bin/sh -v "${DEPS}":/pydeps "${IMG}" -c \
    '/usr/local/bin/uv pip install --python /opt/hermes/.venv/bin/python --target /pydeps pytest pytest-asyncio >/dev/null'
  chmod -R a+rX "${DEPS}"
  echo "--- as root"
  run docker run --rm --entrypoint /bin/sh -e PYTHONDONTWRITEBYTECODE=1 -e HERMES_HOME=/tmp/hh \
    -v "${P}":/plugin:ro -v "${DEPS}":/pydeps:ro "${IMG}" -c \
    'cd /plugin && PYTHONPATH=/opt/hermes:/pydeps /opt/hermes/.venv/bin/python -m pytest -p no:cacheprovider tests/ -q'
  echo "--- as uid 10000"
  run docker run --rm --user 10000:10000 --entrypoint /bin/sh -e PYTHONDONTWRITEBYTECODE=1 -e HOME=/tmp -e HERMES_HOME=/tmp/hh \
    -v "${P}":/plugin:ro -v "${DEPS}":/pydeps:ro "${IMG}" -c \
    'cd /plugin && PYTHONPATH=/opt/hermes:/pydeps /opt/hermes/.venv/bin/python -m pytest -p no:cacheprovider tests/ -q'
  echo "--- lock tests on shfs as uid 10000"
  run docker run --rm --user 10000:10000 --entrypoint /bin/sh -e PYTHONDONTWRITEBYTECODE=1 -e HOME=/tmp -e HERMES_HOME=/tmp/hh \
    -e HERMES_MOBILE_LOCKTEST_DIR=/locktest \
    -v "${P}":/plugin:ro -v "${DEPS}":/pydeps:ro -v "${L}":/locktest "${IMG}" -c \
    'cd /plugin && PYTHONPATH=/opt/hermes:/pydeps /opt/hermes/.venv/bin/python -m pytest -p no:cacheprovider tests/test_device_store_locking.py -q'
done
echo "===== plugin compat at 0.21.5"
run docker run --rm --entrypoint /bin/sh -e HERMES_HOME=/tmp/hh -v "${P}":/plugin:ro \
  nousresearch/hermes-agent@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7 -c \
  '/opt/hermes/.venv/bin/hermes plugins compat /plugin'
echo "===== leftovers in the shfs lock dir (expect none)"
ls -A "${L}"
exit "${rc}"
EOF
echo "ssh exit=$?"
```

Expected, for **each** digest:
- `--- as root`: `193 passed, 1 skipped`. The skip is `test_unopenable_lock_file_degrades_to_thread_lock`, because root bypasses permissions. The root-owner test takes its **real chown** branch here.
- `--- as uid 10000`: `194 passed`.
- `--- lock tests on shfs as uid 10000`: `11 passed`. This is the real shfs proof of flock serialization, release on SIGKILL, and timeout.
- compat: the command exits 0.
- The leftovers listing is empty.
- The final line is `ssh exit=0`.

Any other result is a failure. Fix the root cause in the owning task and re-run from Step 1.

- [ ] **Step 4: Clean up the dc1-1 scratch**

```bash
ssh root@dc1-1.local 'rm -rf /mnt/cache/compat/hermes-mobile-plugin-lock /mnt/cache/compat/pydeps-* /mnt/user/appdata/hermes-locktest'
```

- [ ] **Step 5: Push and open the PR** (the active gh account must be `gldc`: run `gh auth status`)

```bash
cd $HOME/Developer/hermes-mobile-plugin-worktrees/store-lock-and-pushes
git push -u origin fix/store-lock-and-pushes
gh pr create --repo gldc/hermes-mobile-plugin --base main --head fix/store-lock-and-pushes \
  --title "DeviceStore locking (in-process + flock), coalesced-approval skip, clarify push" \
  --body-file - <<'EOF'
Spec: hermes-mobile-app `docs/superpowers/specs/2026-09-28-control-path-0.21.5-design.md` §6.5, §9.1, §10.1 (review M7, m13). Must merge **before** the 0.21.5 bump.

**What**
- `DeviceStore`: every load→modify→save (`create_device`, `rotate_refresh`, `revoke`, `revoke_by_refresh`, `set_push_token`) holds a process-wide lock keyed by the resolved path + `fcntl.flock` on `devices.json.lock`. Unique `mkstemp` tmp per write, fsynced (was a shared `.devices.json.<pid>.tmp`, which collided between threads). Root-written files are chowned to the store dir owner (`docker exec` is root on dc1-1). Lock timeout → `DeviceStoreError` → transient `ProviderError`, never a re-pair.
- `pre_approval_request`: skip `coalesced=True` followers (fires at both 8.18 and 9.24).
- New `pre_tool_call` hook: `tool_name == "clarify"` in a claimed session → device-targeted redacted push "Hermes has a question", `data {type: clarify_request, session_id: <route id>}`. Observe-only: never raises, returns None, pushes off-thread (9.24 blocks the tool when a pre_tool_call callback raises or exceeds 30 s), 30 s cooldown per device+session.
- v0.2.0; README + CONTRACTS §6 (verified hook payloads at both tags).

**Verification (exit codes)**
- Host, core v2026.8.18: 194 passed, exit 0; core v2026.9.24: 194 passed, exit 0
- dc1-1, image 22e37bb4… (0.20.4): root 193 passed/1 skipped, uid 10000 194 passed, lock tests on shfs 11 passed — all exit 0
- dc1-1, image fca358f1… (0.21.5): root 193 passed/1 skipped, uid 10000 194 passed, lock tests on shfs 11 passed, `hermes plugins compat` exit 0
- Contract-test mutation check: a raising handler turns 5 contract tests red at 9.24 (block directive)

**Cross-repo note:** the app should add `clarify_request` to `SUPPRESSIBLE_PUSH_TYPES` (foreground suppression). Tap routing already works via `data.session_id`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Replace the verification lines with the actual outputs from Steps 1 and 3 if any count differs.

- [ ] **Step 6: Adversarial review, then merge**

- Run superpowers:requesting-code-review against the PR diff (`gh pr diff`). Include this plan's Review Focus as the reviewer brief. Address every finding with a RED→GREEN commit, and re-run Steps 1 and 3.
- Merge only after that:

  ```bash
  gh pr merge --repo gldc/hermes-mobile-plugin --squash --delete-branch fix/store-lock-and-pushes; echo "merge exit=$?"
  git -C $HOME/Developer/hermes-mobile-plugin fetch origin
  git -C $HOME/Developer/hermes-mobile-plugin log -1 --oneline origin/main
  ```

  Record the new main SHA. The bump (hermes-deploy, assessment step 6b) pulls it into `/opt/data/plugins/hermes-mobile`, and acceptance checks `log -1 --oneline` equals this SHA.
- **Live verification belongs to the bump:**
  - after deploy, `docker exec hermes ls -ln /opt/data/mobile/` should show `devices.json` and `devices.json.lock` owned by `10000`;
  - the spec §10.2 "two-device refresh burst" and "clarify push" scenarios on the throwaway 0.21.5 container.

---

## Self-review

- **Spec coverage:**

  | Spec requirement (§9.1 / §10.1 / §6.5) | Covered by |
  |---|---|
  | module-level path-keyed lock | Task 2 |
  | flock sidecar | Task 3 |
  | lock wraps all five mutators | Task 2, with race tests covering each |
  | unique mkstemp tmp + `os.replace` | Task 1 |
  | two-instance lost-update RED | Task 2, `rotate_vs_set_push_token` (the exact M7 case) + 3 more |
  | cross-process RED | Task 3 |
  | "pass under both tags" | Tasks 3–8 run both, and Task 8 runs both images |
  | coalesced skip RED | Task 4 |
  | clarify push: targeted + redacted, non-clarify silent, exceptions swallowed, no device → no push | Task 5 |
  | "observe-only; never blocks" | Tasks 5 and 6 |
  | tap deep-links | `data.session_id` = the route id, which the app's `routeForPushData` already routes |
  | no sudo/secret push | nothing added; documented in the README |

- **Placeholders:** none. Every code step carries full code, and every run step carries an exact command and expected output. The code in this plan was run on a scratch prototype. Verified there: the final count of 194 passed at both tags; each task's RED failures (Tasks 1–5); and the Task 6 mutation. The per-task counts 158 → 163 → 170 → 171 → 187 are arithmetic from the tests each task adds.
- **Type and name consistency:** the same names are used in every task:
  - `_path_lock`, `LOCK_TIMEOUT_SECONDS`, `lock_timeout`, `lock_path`, `_locked`, `_open_lock_file`, `_flock`, `_match_dir_owner`, `_ensure_dir`, `_save`, `_load`;
  - `ClarifyPushGate.allow(device_id, route_id)`, `SessionNotifier(..., clarify_gate=, background=)`, `on_pre_tool_call(tool_name, session_id, task_id, **_)`, `_safe_fan_out`, `CLARIFY_BODY`, `"clarify_request"`.
- **Review Focus:** all five lines have a pinning test in their owning task (Tasks 3, 5, 6) plus the shfs/uid-10000 run in Task 8.
