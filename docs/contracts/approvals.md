# Wire contracts: gateway approvals (and clarify)

Verified against hermes source at `~/hermes-agent` on 2026-06-11.
Gateway: `tui_gateway/server.py` (JSON-RPC 2.0 over WS/stdio). Approval engine: `tools/approval.py`.
Client reference: `apps/desktop/src/components/assistant-ui/tool-approval.tsx`,
`apps/desktop/src/store/prompts.ts`, `apps/desktop/src/app/session/hooks/use-message-stream.ts`.

## Event envelope (applies to everything below)

All gateway events arrive as a JSON-RPC **notification** with method `event`:

```json
{ "jsonrpc": "2.0", "method": "event",
  "params": { "type": "<event name>", "session_id": "<sid>", "payload": { ... } } }
```

Evidence: `_emit`, `tui_gateway/server.py:747-751`.

---

## `approval.request` event — SUPPORTED

Emitted when a dangerous terminal command or `execute_code` script needs user consent. The agent
thread is **blocked** in `_await_gateway_decision` until the client answers or a timeout
(config `approvals.gateway_timeout`, default 300 s) elapses (`tools/approval.py:1172-1270`).

Emission sites: `tui_gateway/server.py:948-954`, `2087-2089`, `3215` — all
`register_gateway_notify(key, lambda data: _emit("approval.request", sid, data))`, so the event
payload is exactly the `approval_data` dict.

Payload (terminal guard: `tools/approval.py:1426-1431`; execute_code guard: `1694-1699` — same shape):

```json
{
  "command": "rm -rf build/",        // the full command, or synthesized command for execute_code
  "pattern_key": "recursive delete", // primary matched pattern key
  "pattern_keys": ["recursive delete", "..."],
  "description": "Recursive file deletion; ..."   // combined human-readable description
}
```

- **No `request_id`.** Approvals are session-keyed: one FIFO queue per session
  (`tools/approval.py:637`, desktop comment `apps/desktop/src/store/prompts.ts:67-69`).
- Multiple approvals can be pending per session (parallel subagents); responding resolves the
  OLDEST first unless `all` is sent (`tools/approval.py:666-692`).

## Client response: RPC `approval.respond` — SUPPORTED

```json
{ "jsonrpc": "2.0", "id": 7, "method": "approval.respond",
  "params": { "session_id": "<sid>", "choice": "once", "all": false } }
```

- Handler: `tui_gateway/server.py:6494-6513`.
- `choice` (string, default `"deny"`): canonical values `"once" | "session" | "always" | "deny"`
  (`tools/approval.py:634`; desktop type `ApprovalChoice`,
  `apps/desktop/src/components/assistant-ui/tool-approval.tsx:40-41`).
  - `once` — allow this single command only.
  - `session` — allow this pattern for the rest of the session.
  - `always` — allow + persist pattern to `command_allowlist` in `~/.hermes/config.yaml`
    (`tools/approval.py:1476-1483`).
  - `deny` — hard block; timeout (no answer) also blocks.
- `all` (bool, default false): resolve every pending approval in the session with this choice.
- Result: `{"resolved": <int count of approvals resolved>}` — `0` means nothing was pending
  (stale/raced). Desktop treats it as `{ resolved?: boolean }` but the server returns the int from
  `resolve_gateway_approval` (`tools/approval.py:666-692`).
- Errors: standard JSON-RPC error object; 5004 on internal failure (`server.py:6513`).

Desktop reference call (`tool-approval.tsx:82-85`):
`gateway.request('approval.respond', { choice, session_id })`.

Cleanup semantics: on turn end/interrupt the gateway force-denies pending approvals
(`server.py:4740-4747`, `resolve_gateway_approval(key, "deny", resolve_all=True)`) — clients should
drop the approval UI on `message.complete`/interrupt, like `clearAllPrompts` does
(`apps/desktop/src/store/prompts.ts:101-114`).

---

## `clarify.request` event + `clarify.respond` RPC — SUPPORTED

The clarify tool blocks the agent through the `_block()` request/response bridge
(`tui_gateway/server.py:1335-1350`), which generates an 8-hex `request_id`, injects it into the
payload, emits the event, and waits (default timeout 300 s; empty-string answer on timeout/cancel).

Event payload (callback wiring `server.py:2655-2657`; `request_id` injection `server.py:1340`):

```json
{ "question": "Which environment?", "choices": ["staging", "prod"] | null, "request_id": "a1b2c3d4" }
```

Client response RPC (handler `server.py:6473-6475` via `_respond` 6461-6470):

```json
{ "jsonrpc": "2.0", "id": 9, "method": "clarify.respond",
  "params": { "request_id": "a1b2c3d4", "answer": "staging" } }
```

- Result: `{"status": "ok"}`; error 4009 `"no pending clarify request"` if the request_id is gone.
- `answer` is a free-text string (a choice value or typed text).
- Note: unlike approvals, clarify is request_id-keyed, NOT session-keyed. `session_id` is not
  required in params (the handler only looks at `request_id` + `answer`).
- Desktop reference: `apps/desktop/src/components/assistant-ui/clarify-tool.tsx:122-125`;
  event parsing `apps/desktop/src/app/session/hooks/use-message-stream.ts:842-873`.

## Same `_block` family (for completeness, same request/response pattern)

- `sudo.request` (payload `{request_id}`) → `sudo.respond {request_id, password}` (`server.py:2673`, `6484-6486`).
- `secret.request` (payload `{prompt, env_var, metadata?, request_id}`) → `secret.respond {request_id, value}` (`server.py:2675-2679`, `6489-6491`).
- `terminal.read.request` → `terminal.read.respond {request_id, text}` (`server.py:2660-2665`, `6478-6481`).
