# Architecture

## Principle

**OMP owns intelligence and execution. omp-webUI owns interaction and visualization.**

The project must not scrape terminal ANSI output. OMP already exposes structured extension events, a local collab-host registry, and the `pi-wire` collaboration protocol.

## Bootstrap path

```text
running OMP process
  |
  | OMP extension: /webui
  v
loopback server (127.0.0.1)
  |
  | discovers process.pid via:
  | omp collab list --json
  | omp collab link <instanceId> --json
  v
React workspace
  |
  +-- session shell
  +-- agent panel slot
  +-- chat slots
  +-- inspector
  +-- plugin registry
```

The control link is never rendered into the page. The browser receives it only from an authenticated loopback API so the future `pi-wire` adapter can connect.

## Why collab instead of PTY mirroring?

Collab already carries semantic frames for:

- durable transcript entries
- streaming agent events
- state/context/model snapshots
- subagent registry and progress
- subagent transcript fetches
- prompt / abort
- agent chat / kill / revive
- interactive UI requests

That gives the browser real application state rather than a terminal recording.

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

1. **Bootstrap**: installable OMP extension, `/webui`, loopback server, discover current OMP collab host.
2. **Native wire client**: parse collab link, connect with `@oh-my-pi/pi-wire`, render transcript + streaming events, prompt + abort.
3. **Agent Hub**: agents frames, progress bus, transcript fetch, steer/kill/revive.
4. **Plugin runtime**: typed host/client API, UI slots, command/event services, lifecycle/disposal.
5. **Workspace plugins**: Git/diff, filesystem, browser preview, terminal, dev-server detection.

## Security

- HTTP server binds to `127.0.0.1` only.
- A random per-server token protects the local session-discovery endpoint.
- Collab control URLs are secrets and must never be logged or displayed.
- Third-party plugins will require explicit capability declarations before privileged host APIs are exposed.
