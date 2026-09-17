# omp-webUI

An extensible web workspace for [Oh My Pi](https://github.com/can1357/oh-my-pi), delivered as an OMP plugin.

## Goal

Keep OMP as the agent runtime, while providing a richer browser workspace for:

- chatting with the live OMP session
- streaming assistant/thinking/tool activity
- inspecting and controlling subagents
- viewing session/context/model state
- adding first-class UI extensions through a plugin/slot system

The project intentionally builds on OMP's native extension event stream instead of scraping terminal output.

## Current bootstrap

The first vertical slice is:

```text
running OMP
  -> /webui
  -> loopback web server (127.0.0.1, token-gated)
  -> default browser opens automatically
  -> browser shell
  -> local session snapshot + SSE event stream from the OMP extension runtime
```

`/webui` works standalone: the extension captures structured OMP session events into an in-memory ring (bounded to 500 frames), and the loopback server streams them to the browser over SSE. No `/collab` command, collab-host registry, or `pi-wire` connection is involved.

## Local development

Prerequisites: current OMP and Bun 1.3.14+.

```bash
git clone https://github.com/JessenReinhart/omp-webUI.git
cd omp-webUI
bun install
bun run build
omp plugin link .
```

Restart OMP, then:

```text
/webui
```

The plugin starts the authenticated loopback server and opens the workspace in your default browser automatically.

Useful variants:

```text
/webui url   # print the authenticated URL instead of opening a browser
/webui stop  # stop the local WebUI server
```

A native top-level command such as `omp webui` is not currently exposed by OMP's extension API: top-level CLI subcommands are registered by OMP core, while plugins can register slash commands. The browser-launch behavior therefore lives behind `/webui` without patching the OMP installation.

For frontend-only work:
```bash
bun run dev
```

## Architecture

See [docs/architecture.md](docs/architecture.md).

The intended direction is Cordis-like extensibility without making every core subsystem a plugin immediately. The web client begins with disposable UI slot registrations, then grows a typed host/client plugin API after the native OMP session stream is working.

## Manual QA Checklist

After changes, verify:
- Open `/webui`; the default browser launches once with the authenticated workspace URL.
- Run `/webui` again; the existing server is reused and a browser tab opens successfully.
- Run `/webui url`; the authenticated URL is shown without launching a browser.
- Run `/webui stop`; the local server stops cleanly.
- Open `/webui` with long-running session (full transcript history visible), scroll (all entries present).
- Send 3+ prompts (including tools), all past turns persist after turn_end.
- Refresh page, reconnect, select past session → load/resume error handling works.
- Viewports: 1440/1100/900/390 (check transcript not crushed; composer visible on desktop/mobile).
- Disconnected/read-only: no errors, clear state labels, offline/reconnect paths work.

For integration:
```bash
bun run check
bun run build
omp plugin link .
# Restart OMP, /webui, /webui url, /webui stop
```
