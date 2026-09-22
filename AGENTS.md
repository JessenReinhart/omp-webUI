# Repository Guidelines

## Project Overview

`omp-webUI` is a Bun-based OMP plugin that provides a local React workspace for an existing Oh My Pi session. OMP remains responsible for execution and intelligence; this plugin owns browser interaction and visualization.

Use OMP's extension and collab APIs. **Never scrape terminal/ANSI output.** See `README.md` and `docs/architecture.md`.

## Architecture & Data Flow

The project has two independent runtimes:

1. **OMP host (Bun):** `src/extension/index.ts` registers `/webui`, which starts the singleton loopback server in `src/host/server.ts`.
2. **Browser client (React/Vite):** `src/web/index.html` → `src/web/main.tsx` → `src/web/App.tsx`.

Runtime flow:

```text
/webui → Bun loopback server (127.0.0.1:4380–4390) serves dist/
       → GET /api/session?token=… returns connected state + session info
       → EventSource /api/events?token=…&cursor=… (SSE)
       → React useLocalSession consumes SSE, builds event ring (≤500 entries)
       → POST /api/prompt, /api/prompt-with-images, /api/abort, /api/commands
```

- `src/extension/index.ts` maintains an in-process `eventRing` (max 500 frames) with `subscribeStream`/`getEventRing` for cursor replay; broadcasts snapshots and tool/message frames from OMP core events.
- `src/host/server.ts` binds only to `127.0.0.1`, scans ports `4380–4390`, gates all `/api/*` endpoints with a random token from the URL (`?token=`). Serves static `dist/` with immutable caching except `index.html`.
- `src/web/useLocalSession.ts` implements the SSE guest client: `EventSource` connection, frame parsing, deduplication, session/agent state, `sendPrompt`/`sendAbort` via `fetch`.
- React state is local hooks and refs; there is no state-management package. `src/web/plugin-system.tsx` is the only shared store, using `useSyncExternalStore` for UI slots.
- Command palette: `GET /api/commands` returns catalog (core + models + thinking); `POST /api/commands` executes a command string.

Keep collab control URLs, tokens, and secrets out of logs, errors, and rendered UI.

## Key Directories

- `src/extension/` — OMP extension entry and `/webui` command lifecycle (`url`, `stop` subcommands).
- `src/host/` — Bun loopback server and API endpoints (`/api/session`, `/api/events`, `/api/commands`, `/api/prompt*`, `/api/abort`, `/api/files`, `/api/sessions*`).
- `src/web/` — React workspace, SSE client (`useLocalSession.ts`), components, slot registry, and global styles.
- `docs/` — architecture decisions and intended milestones.
- `dist/` — generated Vite output; ignored and served by the host runtime. Do not edit.

## Development Commands

```bash
bun install             # install locked dependencies
bun run dev             # Vite frontend server at http://127.0.0.1:4381/
bun run build           # bundle src/web into dist/
bun run check           # strict TypeScript check: tsc --noEmit

# Install/run as an OMP plugin
omp plugin link .
# Restart OMP, then run /webui [url|stop].
```

`/webui url` prints the authenticated local URL; `/webui stop` stops the loopback server.

## Code Conventions & Common Patterns

- TypeScript is strict (`tsconfig.json`); keep boundary data typed as `unknown` until validated with type guards.
- Prefer named, typed interfaces and discriminated frame handling. Reuse `collabTypes.ts` instead of duplicating protocol types.
- React uses function components, hooks for render state, and refs for mutable connection state. Keep cleanup/cancellation guards around polling, timers, sockets, and async continuations.
- `useLocalSession.ts` protects against stale async SSE callbacks with a generation counter and `stoppedRef`; retain those checks after every `await` when changing connection flow.
- Snapshot entries and streamed entries must remain deduplicated; event history is intentionally bounded to 500 entries (`EVENT_LIMIT` in both `extension/index.ts` and `useLocalSession.ts`).
- Register UI extensions through `plugins.registerUi(...)` in `src/web/plugin-system.tsx`. IDs must be unique; registrations return a disposer and contributions are ordered by `order`.
- Styling is a single plain global stylesheet: `src/web/styles.css`. Reuse its custom properties and existing flat/BEM-like class naming; do not introduce a CSS framework or CSS-module convention. (`workspace-v2.css` and `awwwards.css` are legacy/inline styles in components.)
- UI elements & animation: use [reactbits.dev](https://reactbits.dev) for UI elements, animated components, and visual interactions. When creating or enhancing UI components, consult and adapt patterns/components from reactbits.dev.
- Use `void promise.catch(...)` where a deliberately fire-and-forget UI action needs error containment; do not leave rejected promises unhandled.
- The UI uses `lucide-react` for icons and accessible controls (labels, disabled state, `aria-live`) in the existing components.

## Important Files

- `package.json` — Bun runtime constraint, scripts, and OMP extension manifest (`omp.extensions`).
- `src/extension/index.ts` — default-exported `webUiExtension`; owns server singleton, event ring, stream subscribers, and session shutdown cleanup.
- `src/host/server.ts` — `startWebUiServer()`, static serving, token-gated API, loopback/port constraints, SSE cursor replay.
- `src/web/App.tsx` — workspace shell, command catalog composition, 2.5-second session discovery polling.
- `src/web/useLocalSession.ts` — security- and compatibility-sensitive SSE transport (EventSource, reconnect backoff, cursor replay).
- `src/web/plugin-system.tsx` — 11 supported slots: `sidebar.top`, `sidebar.bottom`, `session.header`, `session.toolbar`, `chat.before`, `chat.after`, `agent.panel`, `agent.actions`, `rightPanel`, `bottomPanel`, `statusBar`.
- `src/web/CollabTranscript.tsx`, `CollabComposer.tsx`, `CollabControls.tsx` — transcript rendering, prompting/abort, connection controls.
- `src/web/commandTypes.ts` — `DEFAULT_COMMANDS`, `CommandOption`, `CommandCatalog` shared with server.
- `vite.config.ts` — Vite root is `src/web`; build output is `dist/`.
- `docs/architecture.md` — non-negotiable design/security principles and roadmap.

## Runtime/Tooling Preferences

- **Use Bun 1.3.14 or newer.** `bun.lock` is the package lock; do not switch to npm, pnpm, or Yarn.
- ESM project; TypeScript targets ES2022 with bundler module resolution and React JSX.
- Vite 8 builds the frontend. The Vite dev server is fixed to `127.0.0.1:4381`; the production host server is independent and uses the first available loopback port from `4380–4390`.
- There is no configured formatter, linter, CI, task runner, or scripts directory. Match nearby formatting and keep diffs focused.

## Testing & QA

No automated test suite, test runner, lint configuration, coverage configuration, or CI workflow exists.

For every change, run the relevant available checks:

```bash
bun run check
bun run build
```

For host/transport or UI behavior, also manually validate the applicable workflow: build, `omp plugin link .`, restart OMP, run `/webui`, and use the authenticated local URL. Verify disconnected/read-only/error paths as well as the normal control connection.