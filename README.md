# Multi VS Code Panel

macOS app (Tauri + React) that manages multiple project folders, each backed
by a real VS Code instance embedded directly in the window.

## How it works

A true native VS Code window can't be reparented into another app's window on
macOS. Instead, each added project spawns its own [code-server](https://github.com/coder/code-server)
(VS Code running as a local web server) on a free localhost port; the right
panel embeds it via `<iframe src="http://127.0.0.1:<port>/...">`. This gives
the full VS Code UI — editor, extensions, integrated terminal — genuinely
inside the app's right panel, not a separate OS window.

- **Sidebar (left):** every added project, with a status dot (idle / starting
  / running / error) and a remove button.
- **Right panel:** the selected project's VS Code. Every project that's been
  opened keeps its iframe mounted (just hidden) when you switch away, so open
  tabs, terminals, and unsaved edits are preserved instead of reloading.
- **Persistence:** the project list (name + folder path) is saved to
  `projects.json` in the app's data directory and reloaded on next launch.
  Running servers are not persisted — each project's VS Code (re)starts on
  first selection after launch.
- Each project gets its own `--user-data-dir` (avoids workspace-lock
  conflicts between simultaneously open projects) but shares one
  `--extensions-dir`, so an extension installed in one project is available
  in all of them.

## Requirements

- macOS
- [code-server](https://github.com/coder/code-server): `brew install code-server`
  (the app looks for it at the standard Homebrew paths, then falls back to
  `PATH`). If it's missing, the sidebar shows a banner with this command.
- Node.js + Rust toolchain, for building the app itself.

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Security note

Each project's code-server is started with `--auth none` and bound to
`127.0.0.1` only — it isn't reachable from the network, but **any other
process or user on the same machine** can hit that port while it's running
(no login prompt). That's an acceptable default for a single-user local dev
tool; don't run this on a shared/multi-user machine without adding
`--auth password` and passing the credentials through to the iframe.
