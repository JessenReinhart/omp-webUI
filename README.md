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

## Status

Early bootstrap. The first milestone is:

`OMP session -> /webui -> local server -> browser -> discover the exact running OMP collab host`

See the bootstrap PR for the initial implementation.
