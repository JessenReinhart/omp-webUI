# Markdown Rendering Specification

## Overview
Assistant messages (`role: "assistant"`) are rendered as GitHub‑Flavored Markdown using **react‑markdown** with the **remark‑gfm** plugin for tables, task lists, etc. Code fences are highlighted with **rehype‑highlight** (lowlight common language set). Raw HTML is stripped (no `rehype‑raw`).

## Components
- **src/web/MarkdownMessage.tsx** – Wraps `ReactMarkdown` with:
  - `remarkPlugins=[remarkGfm]`
  - `rehypePlugins=[rehypeHighlight]`
  - Custom `pre` component (`CodeBlock`) that:
    - Applies `.md-pre` styling.
    - Shows a copy‑button (`.md-copy`) on hover.
    - Copies the block's text via `navigator.clipboard`.
- **src/web/TranscriptEntry.tsx** – Renders assistant `text` blocks via `<MarkdownMessage>`.

## Styling (`src/web/styles.css`)
- All markdown is scoped under `.md`.
- Code blocks use `.md-pre` with dark background `#090b12` and overflow‑x auto.
- Token colors are hand‑crafted `.hljs-*` rules (dark theme) matching the design system.
- Font family for code blocks is the literal monospace stack to avoid undefined `--font-mono`.
- Copy button is positioned absolutely, hidden until `.md-pre:hover`.

## Behavior
- Supported markdown features: headings, paragraphs, emphasis, links, lists, tables, blockquotes, fenced code blocks (language‑aware highlighting), task lists.
- Unknown fence language results in a fatal error from `rehype‑highlight`; this is acceptable trade‑off vs bundle bloat.
- Partial or unterminated fences are rendered as plain text inside a `<pre>`.
- `<script>` tags are ignored – no XSS risk.
- Copy button copies only the code text, not the SVG icon.

## Verification
- `bun run check` → no TypeScript errors.
- `bun run build` → successful production bundle.
- Manual browser test (`vite dev`) shows proper rendering, colors, copy button, and safe handling of raw HTML.

## Future Work
- Optional pre‑sanitize plugin to gracefully handle unknown languages.
- Add unit tests for markdown rendering component.
- Explore dynamic import to split large highlight bundle if needed.
