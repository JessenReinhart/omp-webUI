# Architecture

## Principle

**OMP owns intelligence and execution. omp-webUI owns interaction and visualization.**

The project must not scrape terminal ANSI output. OMP exposes structured extension events; this plugin captures those events inside the current OMP process and forwards them through its authenticated loopback server.

## Bootstrap path

```text
running OMP process
  |
  | OMP extension: /webui
  v
local runtime cache + bounded event ring
  |
  | token-gated loopback server (127.0.0.1)
  | session/session-history APIs + SSE
  | prompt, abort, and resume APIs
  v
React workspace
  |
  +-- session shell
  +-- agent panel slot
  +-- chat slots
  +-- inspector
  +-- plugin registry
```

`/webui` works without `/collab`. The extension retains the active OMP API and context, emits sequence-numbered frames into a 500-entry in-memory ring, and sends snapshots, missed frames, and live frames over Server-Sent Events. The authenticated URL token gates every `/api/*` endpoint and is never logged or rendered by the application.

## Local API

The server binds only to `127.0.0.1` and uses the first available port from `4380` through `4390`. Every `/api/*` request requires the per-server token in its query string. Tokens and filesystem paths must never be logged or rendered.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/session` | Current OMP runtime metadata and local transport state. |
| `GET` | `/api/sessions` | Past session summaries. |
| `GET` | `/api/sessions/:fileId.jsonl` | Read-only entries for one past session. |
| `GET` | `/api/events?cursor={seq}` | SSE transcript stream. A missing, invalid, or non-positive cursor receives a fresh snapshot; the stream sends missed frames, live frames, and 15-second keepalive comments. |
| `POST` | `/api/prompt` | Send `{ text }` to the active OMP session. |
| `POST` | `/api/abort` | Abort the active OMP session. |
| `POST` | `/api/sessions/:fileId.jsonl/resume` | Switch OMP to a past session, then broadcast its live snapshot. |

Past session file IDs must be `.jsonl` basenames without path separators or `..`; the resolved path must remain within OMP's session directory.

## Transcript lifecycle

`buildSnapshotFrameBase()` is the single source for snapshot frames. Its `entries` come from `sessionManager.getBranch()`: the authoritative committed history of the current active branch. Abandoned branches are not included.

`broadcastSnapshot()` emits that shared frame in these paths:

- Fresh SSE connect when `cursor <= 0` (including missing or invalid cursor handling).
- `session_start`.
- `turn_end`, after `isStreaming: false`; the snapshot is deferred 50 ms with OMP's `eventCtx.setTimeout` when available. A stale-session guard suppresses it when a newer `switchSession` snapshot belongs to a different session.
- Successful resume/`switchSession`.

The client replaces `entries` atomically for every snapshot. `message_start`, `message_update`, `message_end`, and `tool_execution_*` frames are transient streaming preview only. Committed messages dedupe preview messages by `role:timestamp:toolCallId:content-text`; committed tool results suppress previews with the same tool call ID. Per-session sequence and committed-identity state reset on a new session, reconnect, and resume, so frames from an old session cannot render in the new transcript.

Live and past transcript views both render entries through `TranscriptEntry` and `transcript-model.ts`. The read-only past-session viewer shows at most the newest 1,000 entries. The live transcript stays pinned only while within 96 px of the bottom; otherwise incoming content leaves the scroll position intact and exposes “Jump to latest”.

## Why native extension events instead of PTY mirroring?

Native extension events carry semantic messages, tool activity, turn state, and session state. This gives the browser real application state rather than a terminal recording, without a second collab control connection.

## Extensibility model

The web client starts with a deliberately small slot registry:

- `sidebar.top`
- `sidebar.bottom`
- `session.header`
- `session.toolbar`
- `chat.before`
- `chat.after`
- `agent.panel`
- `agent.actions`
- `rightPanel`
- `bottomPanel`
- `statusBar`

Registrations return a disposer. This keeps the Cordis-like lifecycle property we want without forcing every core subsystem to become a plugin on day one.

Later plugin packages may expose two entrypoints:

```text
plugin/
  host.ts    # privileged local capability
  client.tsx # browser UI contribution
```

The host/client protocol and permission model will be designed after the native OMP session stream works.

## Milestones

1. **Bootstrap**: installable OMP extension, `/webui`, loopback server, local event ring with SSE streaming.
2. **Local session client**: connect from the browser via authenticated SSE, render transcript + streaming events, prompt + abort.
3. **Agent Hub**: agents frames, progress bus, transcript fetch, steer/kill/revive.
4. **Plugin runtime**: typed host/client API, UI slots, command/event services, lifecycle/disposal.
5. **Workspace plugins**: Git/diff, filesystem, browser preview, terminal, dev-server detection.

## Security

- A random per-server token protects all `/api/*` endpoints.
- The token is passed only in the authenticated URL and is never logged or displayed in the UI.
- Third-party plugins will require explicit capability declarations before privileged host APIs are exposed.

## Session history

`SessionList` renders past sessions in the sidebar with 5-second polling. Selecting one switches the workspace to read-only `FullTranscriptViewer` in place of the live transcript. The past-session header offers “Resume in OMP”, which calls the resume endpoint and returns the workspace to the live view with the composer enabled.

