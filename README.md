# omp-webUI

An extensible web workspace for [Oh My Pi](https://github.com/can1357/oh-my-pi), delivered as an OMP plugin.

## Goal

Keep OMP as the agent runtime, while providing a richer browser workspace for:

- chatting with the live OMP session
- streaming assistant/thinking/tool activity
- inspecting and controlling subagents
- viewing session/context/model state
- adding first-class UI extensions through a plugin/slot system

The project intentionally builds on OMP's native extension system and collab protocol instead of scraping terminal output.

## Current bootstrap

The first vertical slice is:

```text
running OMP
  -> /collab (or collab.autoStart=control)
  -> /webui
  -> loopback web server
  -> browser shell
  -> discover this exact OMP process through the collab host registry
```

The browser transport is intentionally the next slice. The current UI verifies that the plugin can identify the live host and obtain its collab endpoint without terminal scraping.

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
/collab
/webui
```

OMP prints the local authenticated URL for the browser workspace. Use `/webui stop` to stop the local server.

For frontend-only work:

```bash
bun run dev
```

## Architecture

See [docs/architecture.md](docs/architecture.md).

The intended direction is Cordis-like extensibility without making every core subsystem a plugin immediately. The web client begins with disposable UI slot registrations, then grows a typed host/client plugin API after the native OMP session stream is working.
