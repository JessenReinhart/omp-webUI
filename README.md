<div align="center">

# omp-webUI

### A native web workspace for [Oh My Pi](https://github.com/can1357/oh-my-pi)

**Keep OMP as the runtime. Get a proper browser workspace for everything around it.**

[![MIT License](https://img.shields.io/badge/license-MIT-111111?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.3.14%2B-111111?style=flat-square&logo=bun)](https://bun.sh/)
[![React](https://img.shields.io/badge/React-19-111111?style=flat-square&logo=react)](https://react.dev/)
[![Oh My Pi](https://img.shields.io/badge/OMP-plugin-7c5cff?style=flat-square)](https://github.com/can1357/oh-my-pi)

[Quick start](#quick-start) · [Features](#what-you-get) · [Architecture](#architecture) · [Roadmap](#roadmap)

</div>

---

## OMP, with room to breathe

Oh My Pi is excellent at being an agent runtime. `omp-webUI` does not try to replace that.

Instead, it gives the running OMP process a richer local workspace in your browser: live conversation, streaming activity, session history, controls, agents, and room for future plugins — all driven by OMP's structured extension events.

No terminal scraping. No ANSI parsing. No second fake agent runtime.

```text
OMP owns intelligence + execution
            ↓
omp-webUI owns interaction + visualization
```

Run `/webui` inside OMP and your authenticated local workspace opens automatically in the default browser.

## What you get

- **Live OMP conversation** — send prompts and watch responses stream into the workspace.
- **Real tool activity** — tool execution is rendered from structured OMP events, not terminal output.
- **Session history** — browse past sessions without leaving the workspace.
- **Resume in OMP** — reopen a past session as the active live session.
- **Streaming-aware UI** — committed history and transient streaming events stay correctly deduplicated.
- **Agent panel** — a dedicated surface for active agents and future subagent controls.
- **Abort & reconnect controls** — control the running session directly from the browser.
- **Responsive workspace** — desktop sidebars, compact layouts, and mobile drawers.
- **Extensible UI slots** — add UI contributions without rewriting the core shell.
- **Local-first security** — loopback-only server plus a random per-server authentication token.
- **Zero browser-runtime framework bloat** — React, plain CSS, and the existing OMP/Bun runtime.

## Quick start

### Requirements

- A current [Oh My Pi](https://github.com/can1357/oh-my-pi) installation
- [Bun](https://bun.sh/) **1.3.14+**

### Install

```bash
git clone https://github.com/JessenReinhart/omp-webUI.git
cd omp-webUI
bun install
bun run build
omp plugin link .
```

Restart OMP, then run:

```text
/webui
```

That's it. The plugin starts a local authenticated server and opens the workspace in your default browser.

### Useful commands

```text
/webui       # start/reuse the WebUI server and open it in your browser
/webui url   # show the authenticated URL without opening a browser
/webui stop  # stop the local WebUI server
```

> [!NOTE]
> OMP extensions can currently register slash commands, but not arbitrary top-level CLI subcommands. That is why the plugin uses `/webui` rather than patching the user's OMP installation to provide `omp webui`.

## How it works

```text
┌─────────────────────────────────────────────┐
│                 OMP process                 │
│                                             │
│  session · model · tools · agents · turns   │
└──────────────────────┬──────────────────────┘
                       │ native extension events
                       ▼
┌─────────────────────────────────────────────┐
│              omp-webUI plugin               │
│                                             │
│  runtime cache · snapshots · event ring     │
└──────────────────────┬──────────────────────┘
                       │ authenticated local API + SSE
                       ▼
┌─────────────────────────────────────────────┐
│              React workspace                │
│                                             │
│  sessions · transcript · composer · agents  │
└─────────────────────────────────────────────┘
```

The server binds only to `127.0.0.1`, selects an available port from `4380–4390`, and creates a random token for the lifetime of that server.

The browser receives a full session snapshot, then follows sequence-numbered events through Server-Sent Events. Prompt, abort, session history, and resume operations go through the same authenticated local API.

For the deeper design notes, see **[docs/architecture.md](docs/architecture.md)**.

## Why not mirror the terminal?

Because a terminal recording is presentation, not state.

OMP already knows when a message starts, when a tool runs, when a turn finishes, which session is active, and what the committed conversation history actually is. `omp-webUI` consumes those semantic events directly.

That means the browser can eventually become much more than a prettier terminal:

- richer agent inspection
- Git and diff surfaces
- browser previews
- filesystem views
- terminal panels where a terminal actually makes sense
- plugin-specific workspace UI

...without reverse-engineering whatever happened to be printed to stdout.

## Architecture

The project has three intentionally separate pieces:

| Layer | Responsibility |
| --- | --- |
| **OMP extension** | Hooks into the live OMP process, captures structured events, and owns `/webui`. |
| **Local host** | Serves the built app, exposes token-gated local APIs, and streams live events over SSE. |
| **React workspace** | Renders sessions, transcript state, controls, agents, and extensible UI slots. |

The current browser UI exposes slots including:

```text
sidebar.top       sidebar.bottom
session.header    session.toolbar
chat.before       chat.after
agent.panel       agent.actions
rightPanel        bottomPanel
statusBar
```

Registrations are disposable, giving future plugins a clean lifecycle without forcing the entire application into a plugin architecture on day one.

## Security model

`omp-webUI` is intentionally local-first.

- The server binds to **`127.0.0.1` only**.
- Every `/api/*` request requires a random per-server token.
- Tokens are not rendered inside the application UI.
- Session file access is constrained to OMP's session directory.
- The project consumes OMP's extension API instead of exposing or scraping a shell session.

The current design is for a trusted local workspace. Future privileged third-party plugins will need an explicit capability/permission model before host APIs are exposed to them.

## Development

Run the frontend directly with Vite:

```bash
bun run dev
```

Before shipping changes:

```bash
bun run check
bun run build
```

Then link the plugin and verify the integration:

```bash
omp plugin link .
```

Restart OMP and exercise `/webui`, `/webui url`, and `/webui stop`.

### UI Design & Components

Use [reactbits.dev](https://reactbits.dev) for UI elements, animated components, and visual interactions. When building or extending frontend components in `src/web/`, adapt patterns and components from reactbits.dev.

### Manual QA

For UI or transport changes, the important paths are:

- long-running sessions with full transcript history
- multiple prompts with tool calls
- streaming → committed-history transitions
- session refresh/reconnect
- past-session browse + resume
- browser relaunch while the server is already running
- disconnected and error states
- desktop and narrow/mobile layouts

## Roadmap

The direction is a **Cordis-like extensible workspace around OMP**, while keeping OMP itself in charge of execution.

- [x] OMP extension bootstrap and `/webui`
- [x] Loopback authenticated server
- [x] Native session snapshots + SSE event stream
- [x] Prompt and abort from the browser
- [x] Session history and resume
- [x] Browser auto-launch
- [x] Extensible browser UI slot registry
- [ ] Rich Agent Hub: inspect, steer, stop, and revive subagents
- [ ] Typed host/client plugin API
- [ ] Plugin capability and permission model
- [ ] Git + diff workspace plugin
- [ ] Filesystem workspace plugin
- [ ] Browser preview / dev-server integration
- [ ] Terminal workspace plugin

## Philosophy

This project follows one rule:

> **Don't rebuild OMP in React. Build the workspace OMP deserves around it.**

If a feature belongs to the agent runtime, it should stay in OMP. If it benefits from space, visualization, interaction, or composition, it probably belongs here.

## Contributing

Issues, ideas, experiments, and pull requests are welcome.

If you're adding a feature, try to preserve the core boundaries:

1. Prefer native OMP events and APIs over parsing terminal output.
2. Keep secrets, tokens, and sensitive local paths out of rendered UI and logs.
3. Keep host capabilities separate from browser presentation.
4. Extend the workspace through reusable surfaces rather than hard-coding one-off panels where possible.

## License

MIT.

---

<div align="center">

Built for people who like OMP in the terminal — **and still want a damn good UI when it helps.**

</div>
