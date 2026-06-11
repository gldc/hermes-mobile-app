# Wire contracts: sending images (and files) with a prompt

Verified against hermes source at `~/hermes-agent` on 2026-06-11.
Gateway: `tui_gateway/server.py` (JSON-RPC). Client reference:
`apps/desktop/src/app/session/hooks/use-prompt-actions.ts`.

## The model: attach first, then submit — SUPPORTED

`prompt.submit` has **NO images/attachments parameter**. Its params are only
`session_id`, `text`, and optional `truncate_before_user_ordinal`
(`tui_gateway/server.py:5015-5018`).

Instead, the client stages each image with a separate RPC BEFORE submitting. Staged images are
queued in server-side session state (`session["attached_images"]`,
e.g. `server.py:5858`, `5718`, `5757`) and the **next** `prompt.submit` drains the whole queue
(`_run_prompt_submit`, `server.py:5268-5273`: `images = list(session.get("attached_images", []))`
then `session["attached_images"] = []`) and feeds them into the vision pipeline
(`server.py:5345-5394`).

So the mobile flow is:

1. `image.attach_bytes` (one call per image) — base64 upload, NOT an HTTP endpoint.
2. `prompt.submit` with the user text → `{"status": "streaming"}` and events stream.

## RPC `image.attach_bytes` (remote clients — use this) — SUPPORTED

Evidence: `tui_gateway/server.py:5862-5920`; desktop usage `use-prompt-actions.ts:202-206`.

```json
{ "jsonrpc": "2.0", "id": 3, "method": "image.attach_bytes",
  "params": {
    "session_id": "<sid>",
    "content_base64": "<base64 image bytes>",   // alias "data" also accepted (5883)
    "filename": "photo.jpg"                      // optional; or "ext": "jpg"
  } }
```

- `content_base64` accepts a raw base64 string OR a full `data:image/...;base64,` data URL, with
  embedded whitespace tolerated (`_decode_attach_base64`, `server.py:5789-5810`).
- Max 25 MB decoded (`_ATTACH_BYTES_MAX_BYTES`, `server.py:5775`); error code 4018 if larger.
- Without filename/ext, format is sniffed from magic bytes (PNG/JPEG/GIF/WebP/BMP, fallback .png)
  (`server.py:5813-5829`). Allowed extensions: png/jpg/jpeg/gif/webp/bmp (`server.py:5832-5838`);
  4016 if unsupported, 4017 if invalid/empty base64, 4015 if missing.

Result:

```json
{ "attached": true, "path": "/home/x/.hermes/images/upload_20260611_101500_1.jpg",
  "count": 1, "remainder": "", "text": "[User attached image: upload_….jpg]",
  "bytes": 123456, "name": "upload_….jpg", "width": 1024, "height": 768, "token_estimate": 340 }
```

(`server.py:5909-5920`; `width`/`height`/`token_estimate` come from `_image_meta`,
`server.py:776-788`, and are omitted if PIL can't read the file.)

## RPC `image.attach` (path on the GATEWAY host only) — SUPPORTED, wrong tool for mobile

`{"session_id", "path": "/path/visible/to/gateway.png"}` → same response shape plus `remainder`
(`server.py:5730-5770`). The desktop uses this only in local mode (`use-prompt-actions.ts:207-212`).
A phone never shares a disk with the gateway — always use `image.attach_bytes`.

## RPC `prompt.submit` — SUPPORTED

Evidence: `tui_gateway/server.py:5015-5074`.

```json
{ "jsonrpc": "2.0", "id": 4, "method": "prompt.submit",
  "params": { "session_id": "<sid>", "text": "What's in this image?" } }
```

- Immediate result: `{"status": "streaming"}`; output arrives as `event` notifications
  (`message.delta`, `tool.start`, `message.complete`, …).
- Error 4009 `"session busy"` if a turn is running (`server.py:5028-5029`).
- Optional `truncate_before_user_ordinal` (int) rewrites history before submitting (edit/regenerate
  flows, `server.py:5030-5046`).
- The queued images are consumed by this turn; on submit the gateway either passes them natively
  to a vision model or pre-analyzes them and prepends descriptions
  (`_enrich_with_attached_images`, `server.py:3259`, used at `5386-5394`).

## Related attach RPCs

- `image.detach` — remove a staged image before submit (`server.py:6232`).
- `clipboard.paste` — gateway-host clipboard image (`server.py:5690-5727`); not useful remotely.
- `pdf.attach` — `{path}` or `{content_base64}`; renders pages to PNG at 150 DPI and queues them as
  images. Caps: 50 MB / 25 pages; requires `pdftoppm` on the gateway (error 5028 if missing)
  (`server.py:5923-5934`, caps at `5775-5777`).
- `file.attach` — non-image files: `{session_id, path?, data_url?, name?}`; remote clients send
  `data_url` (`data:<mime>;base64,…`); returns a workspace `@file:` ref the agent's file tools can
  read (`server.py:6185-6210`; desktop usage `use-prompt-actions.ts:244-249`).

## NOT FOUND

- Any `images`/`attachments` key in `prompt.submit` params.
- Any HTTP upload endpoint used for chat attachments on the gateway path. (The dashboard REST
  `POST /api/files/upload` in `hermes_cli/web_server.py:1124` is the managed-files browser, not the
  chat attach pipeline.)
