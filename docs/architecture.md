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
  | GET /api/session, GET /api/events (SSE)
  | POST /api/prompt, POST /api/abort
  v
React workspace
  |
  +-- session shell
  +-- agent panel slot
  +-- chat slots
  +-- inspector
  +-- plugin registry
```

`/webui` works without `/collab`. The extension retains the active OMP API and context, emits sequence-numbered frames into a 500-entry in-memory ring, and sends a session snapshot followed by missed and live frames over Server-Sent Events. The authenticated URL token gates every session API endpoint and is never logged or rendered by the application.

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
