# Adversarial review of the MCP connectors spec (revision 1)

- **Date:** 2026-10-01
- **Reviewed:** `docs/superpowers/specs/2026-10-01-mcp-connectors-design.md`, revision 1
- **Method:** one independent reviewer read the spec against the gateway source at `v2026.9.24`
  and the app code. Nothing was run. The findings below were then checked against the source
  before the spec was changed.
- **Result:** no blocker, 7 major, 15 minor. All are addressed in revision 2 unless marked.

## Major

| # | Finding | Evidence | Disposition in revision 2 |
| --- | --- | --- | --- |
| 1 | Raising the REST timeout to 45 s does not keep refresh-token rotation safe. The gateway writes rotated cookies only after the handler returns, so an aborted slow request loses the new token. | `dashboard_auth/middleware.py` `_serve_refreshed`; `src/api/restClient.ts` | Test moved to the `mcp.servers.test` RPC (no cookies). Only OAuth start keeps a 45 s limit, and it always follows a fast request that takes any rotation (§4, §6.1). |
| 2 | REST requests queue whenever the access token's expiry is unknown (after every cold start), so a 45 s automatic test would block the list, switches and chat reconnect. | `src/api/cookieJar.ts` `accessTokenFresh`; `restClient.ts` `chain` | Same change: Test no longer uses REST (§4). The remaining cost is stated in §6.1. |
| 3 | "Error at start, stop" leaves a flow that the gateway can reopen; it then blocks the server for 5 minutes with 409. | `tools/mcp_dashboard_oauth.py` `publish_authorization_url`; `web_routers/mcp.py` cancel docstring | Rule A: every exit except approval cancels the flow (§5.6). |
| 4 | The cancel path could report "cancelled" for a sign-in that succeeded: the DELETE response was ignored, the 10 s grace was short, and wall-clock limits could fire on return from another app without a poll. | `web_routers/mcp.py` `cancel_mcp_oauth_flow`; `web_server_mcp.py` `_run_dashboard_mcp_oauth` | DELETE answering `approved` is success; grace is 60 s with a Cancel button; limits are checked only after a poll; a test runs after a cancel (§5.6, R8). |
| 5 | Redacting secrets at display time means an unredacted error object can exist and be logged. Exact-substring matching also misses the `Bearer `-stripped form. | `restClient.ts` error path; `web_server_mcp.py` `_strip_bearer_prefix` | Errors are cleaned inside the API functions that hold the secret, across three variants; a match replaces the whole message (§5.9). |
| 6 | Ownership of the secret value was ambiguous; an implementer could lift it into screen state. | `src/components/secure-entry-card.tsx` | One component, `ConnectorSecretForm`, owns the values and passes them only as a call argument (§5.9, §6). |
| 7 | Catalog `env` handling did not match the gateway: the catalog does not say which variables are secret, secrets are written before the install runs, and `required` was ignored. | `web_routers/mcp.py` `_catalog_entry_json`, `install_mcp_catalog_entry` | Fields are masked by default; the copy says "stored on the gateway"; `required` is honoured; a failed install says credentials may already be stored and re-reads the catalog (§5.4, §5.9). |

## Minor

| # | Finding | Disposition |
| --- | --- | --- |
| 8 | Poll states not handled: `starting`, a changed authorization URL, `AuthError` with the browser open, other HTTP errors, unmount, 409 after the app's own cancel. | Enumerated in §5.6. |
| 9 | The published chat target had no `connected` or session id; its cleanup could clear a newer chat's target. | Target is `{connected, streaming, sessionId, …}` with an owner-checked clear (§6). |
| 10 | The 45 s socket heartbeat, not the 120 s request timeout, may bound a reload if it runs on the dispatch thread. | Socket drop is reported as "unknown"; verification item R5. |
| 11 | Compute-host sessions reload only their host; a reload also interrupts turns in other sessions. | `turn_isolation` is surfaced; the alert says other chats are affected (§5.7). |
| 12 | Status is not reported for a non-launch profile; `connected` outranks `disabled`; OAuth reconnects the server live. | Status hidden for other profiles; "changes after reload" suffix (§5.8). |
| 13 | A pending automatic test could overwrite a newer sign-in result; the label was undefined while pending. | Latest-wins rule; label from `oauth_tokens_present` (§5.3). |
| 14 | `RestClient` replaces every 429 body, so "the gateway's message" was not possible. | Row reworded (§8). |
| 15 | "404 means unsupported gateway" was too broad (unknown profile also 404s; an old gateway may answer HTML). | Two 404 cases and the non-JSON case (§8). |
| 16 | The callback URL can also come from `dashboard.public_url` or a per-server override; it can be checked at run time. | Rule B (§5.6), R1. |
| 17 | The desktop app uses RPC OAuth, not the REST route; the stated reason for rejecting RPC OAuth was imprecise. | Evidence and §4 corrected. |
| 18 | Route-table inaccuracies (profile on flow routes, `unknown` transport, 429 threshold, conditional `confirm_required`, missing status codes). | §2 corrected. |
| 19 | Unowned pieces: cancel signal and phases for the sign-in, a shared sign-in owner, error mapping, back stack, names containing `/`, re-read after a timed-out write. | §5.1, §5.2, §5.5, §6. |
| 20 | Missing tests for the cases above. | §9. |
| 21 | Test on the live stdio server was missing from the go-ahead list. | §9. |
| 22 | No delivery section. | §7. |

## Not verifiable from the sources at hand

Carried into the spec as verification items: whether `reload.mcp` runs off the dispatch thread
(R5), what `install_entry` does with names and missing variables (R7), what removal leaves behind
(R4), whether new chats pick up new servers (R3), and token storage behaviour when a flow is
cancelled mid-exchange (R8).
