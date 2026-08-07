# WP OpenStation

A WordPress plugin that reimagines `/wp-admin` as a desktop operating system. Admin screens open as draggable, resizable, minimizable **windows** on a **desktop**, with a left-edge **dock** built from the admin menu. Purely opt-in per user — the classic admin stays untouched for everyone else, and deactivating the plugin restores vanilla Core exactly.

Zero Core patches. Every feature is wired through public WordPress hooks.

[![Active Installs](https://img.shields.io/wordpress/plugin/installs/desktop-mode?logo=wordpress&logoColor=%23fff&label=Active%20Installs&labelColor=%2323282D&color=%2323282D)](https://wordpress.org/plugins/desktop-mode/) [![Playground Demo Link](https://img.shields.io/wordpress/plugin/v/desktop-mode?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjQ2IDI2IDUxIDUyIiBmaWxsPSJ3aGl0ZSI%2BPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik01My43MTE3IDQ1LjQ4MzlDNTIuNjY1IDQ2LjkyNzcgNTIuMTEyNyA0OC43MDE3IDUyLjAyMzkgNTAuNjUxM0M1Mi4wMDk2IDUwLjk2NjcgNTIuMDA3MyA1MS4yODY2IDUyLjAxNzEgNTEuNjEwNUM1Mi4xNDk0IDU1Ljk5NjUgNTQuNDgxMyA2MS4xMDUxIDU4LjY4NzkgNjUuMzExOEM2NS4xMjU4IDcxLjc0OTYgNzMuNjc2MSA3My43OTY2IDc4LjUxNiA3MC4yODgxQzc2LjQ4MDIgNjkuODA4NCA3NC40MjA2IDY5LjA2MDcgNzIuMzkyNiA2OC4wNjMzQzcxLjg3MiA2OC4wNDA1IDcxLjMxMTkgNjcuOTcyNiA3MC43MTE2IDY3Ljg1MjZDNjkuNjg1MiA2Ny42NDczIDY4LjU5OTggNjcuMjk0OSA2Ny40OTQxIDY2Ljc5MzZDNjcuNDk0MSA2Ni43OTM1IDY3LjQ5NCA2Ni43OTMzIDY3LjQ5NCA2Ni43OTMxQzY1LjQ3MTkgNjUuODc2NSA2My4zODE4IDY0LjQ2MjIgNjEuNDU5NiA2Mi41NEM1OS41Mzc2IDYwLjYxOCA1OC4xMjM0IDU4LjUyODEgNTcuMjA2OCA1Ni41MDYzQzU3LjIwNjcgNTYuNTA2MiA1Ny4yMDY2IDU2LjUwNjIgNTcuMjA2NSA1Ni41MDYyQzU2LjcwNTMgNTUuNDAwNCA1Ni4zNTI4IDU0LjMxNSA1Ni4xNDc1IDUzLjI4ODRDNTYuMDI3NSA1Mi42ODgzIDU1Ljk1OTYgNTIuMTI4MyA1NS45MzY4IDUxLjYwNzhDNTQuOTM5MyA0OS41Nzk3IDU0LjE5MTQgNDcuNTE5OSA1My43MTE3IDQ1LjQ4MzlaTTQ5LjY3OTUgNTcuNjkwNkM0OS44MjYgNTcuNTQ0MSA0OS45Nzk3IDU3LjQwNzQgNTAuMTQwMSA1Ny4yODA1QzUwLjYxMTcgNTguNjU3IDUxLjIzNCA2MC4wMzAzIDUxLjk5NjggNjEuMzczNEM1MS44OTQyIDYxLjgyNiA1MS44NzI2IDYyLjQ0NiA1Mi4wMzg4IDYzLjI3NzFDNTIuMzY4NyA2NC45MjY5IDUzLjM5NzYgNjYuOTUyMiA1NS4yMjI5IDY4Ljc3NzVDNTcuMDQ4MiA3MC42MDI4IDU5LjA3MzUgNzEuNjMxNiA2MC43MjMyIDcxLjk2MTZDNjEuNTU0NiA3Mi4xMjc5IDYyLjE3NDcgNzIuMTA2MSA2Mi42MjczIDcyLjAwMzVDNjMuOTcwNCA3Mi43NjYyIDY1LjM0MzcgNzMuMzg4NCA2Ni43MjAxIDczLjg1OTlDNjYuNTkzMSA3NC4wMjA0IDY2LjQ1NjQgNzQuMTc0MyA2Ni4zMDk3IDc0LjMyMDlDNjMuMjQ4MiA3Ny4zODI1IDU3LjA0MzUgNzYuMTQxNSA1Mi40NTEyIDcxLjU0OTJDNDcuODU4OSA2Ni45NTY5IDQ2LjYxNzkgNjAuNzUyMiA0OS42Nzk1IDU3LjY5MDZaTTY0LjkyMzkgNTkuMDc1OEM3NC4xMDg2IDY4LjI2MDUgODYuNTE4IDcwLjc0MjQgOTIuNjQxMSA2NC42MTkzQzk0Ljg1NSA2Mi40MDUzIDk1Ljk0MzkgNTkuMzY5NiA5NS45OTc5IDU1Ljk2MTZDOTYuMDkzMSA0OS45NDQxIDkyLjk2MTMgNDIuNzY2MSA4Ny4wOTc2IDM2LjkwMjRDNzcuOTEzIDI3LjcxNzcgNjUuNTAzNiAyNS4yMzU5IDU5LjM4MDUgMzEuMzU5QzU3LjE2MzYgMzMuNTc1OCA1Ni4wNzQ3IDM2LjYxNjcgNTYuMDIzNSA0MC4wMzAzQzU1LjkzMzIgNDYuMDQ1IDU5LjA2NDcgNTMuMjE2NiA2NC45MjM5IDU5LjA3NThaTTc3Ljg1ODYgNjAuNzA1NkM3OC4wMjkyIDYxLjU1ODQgNzguMDk0NCA2Mi4zMzAxIDc4LjA3NDcgNjMuMDIyNEM3NC42MjU1IDYxLjgyMTggNzAuOTcwMiA1OS41Nzg5IDY3LjY5NTYgNTYuMzA0NEM2NC40MjExIDUzLjAyOTggNjIuMTc4MiA0OS4zNzQ1IDYwLjk3NzYgNDUuOTI1NEM2MS42NyA0NS45MDU2IDYyLjQ0MTcgNDUuOTcwOSA2My4yOTQ1IDQ2LjE0MTVDNjYuMTk4MSA0Ni43MjIyIDY5LjU3MzEgNDguNDgwMiA3Mi41NDY1IDUxLjQ1MzZDNzUuNTE5OCA1NC40MjcgNzcuMjc3OSA1Ny44MDE5IDc3Ljg1ODYgNjAuNzA1NlpNNjIuMTUyMiAzNC4xMzA3QzYwLjQ5MjcgMzUuNzkwMiA1OS42MDcyIDM4LjQ4OTUgNjAuMDUzMyA0Mi4wNjA4QzY0Ljc0ODMgNDEuNjA0NCA3MC42MDA1IDQzLjk2NDIgNzUuMzE4MiA0OC42ODE5QzgwLjAzNTkgNTMuMzk5NiA4Mi4zOTU3IDU5LjI1MTcgODEuOTM5MiA2My45NDY4Qzg1LjUxMDYgNjQuMzkyOCA4OC4yMDk4IDYzLjUwNzMgODkuODY5MyA2MS44NDc4QzkxLjcxNTggNjAuMDAxMyA5Mi42MDQgNTYuODY3NyA5MS43NjYxIDUyLjY3NzdDOTAuOTM0NSA0OC41MjAxIDg4LjQ0NzQgNDMuNzk1NSA4NC4zMjU5IDM5LjY3NDFDODAuMjA0NSAzNS41NTI2IDc1LjQ3OTkgMzMuMDY1NSA3MS4zMjIzIDMyLjIzMzlDNjcuMTMyMyAzMS4zOTU5IDYzLjk5ODcgMzIuMjg0MiA2Mi4xNTIyIDM0LjEzMDdaIi8%2BPC9zdmc%2B&logoColor=%23fff&label=Playground%20Demo&labelColor=%233858e9&color=%233858e9)](https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/WordPress/openstation/refs/heads/trunk/.wordpress-org/blueprints/blueprint.json) [![Studio Demo Link](https://img.shields.io/wordpress/plugin/v/desktop-mode?logo=wordpress&logoColor=%23fff&label=Open%20in%20WordPress%20Studio&labelColor=%2323282D&color=%2323282D)](https://wp.com/open?deep_link=add-site%3Fblueprint_url%3Dhttps%253A%252F%252Fraw.githubusercontent.com%252FWordPress%252Fopenstation%252Frefs%252Fheads%252Ftrunk%252F.wordpress-org%252Fblueprints%252Fblueprint.json)

## Demo

<video src="https://github.com/user-attachments/assets/590aacc2-e9d7-4213-889e-b91e060e1bd8" controls width="720"></video>

---

## Contents

- [Demo](#demo)
- [Current State](#current-state)
- [Still ahead](#still-ahead)
- [Repository layout](#repository-layout)
- [Bundled extensions](#bundled-extensions)
- [How to run it](#how-to-run-it)
  - [Quick install](#quick-install)
  - [Development setup](#development-setup)
- [Requirements](#requirements)
- [For plugin authors](#for-plugin-authors)
- [License](#license)

---

## Current State

- **Per-user opt-in**
  Admin-bar toggle sets the `desktop_mode_mode` user meta. A dedicated `/openstation/` portal URL auto-enables OpenStation for first-time visitors (gated by `openstation_portal_auto_enable`) and the `admin_init` redirect sends opted-in users from `/wp-admin/` to the portal (`openstation_admin_redirect_to_portal`).

- **Desktop shell**
  Fixed-viewport desktop that overlays `/wp-admin`: wallpaper area, unified dock (placement picked in OpenStation Preferences — left / right / bottom, default bottom), right-column widget layer, and full windowing system. `openstation_mode_init`, `openstation_shell_before` / `_after`, and the `openstation_shell_config` filter are the main extension points.

- **Window system — iframe + native**
  Iframe windows load admin pages with `?openstation_chromeless=1` (chromeless mode). Native windows render directly in the parent DOM via `openstation_register_window()` / `wp.os.registerWindow()` — multi-tab native windows are supported through `openstation_register_window_tab()`. Both types share drag, resize, minimize, maximize, close, fullscreen, and detach-to-new-tab.

- **Dock**
  One unified rail hosting every admin menu — core and plugin alike — plus shell-level system tiles. Placement (left / right / bottom) is a user preference in OpenStation Preferences. Core menus are ordered before plugin menus; per-item hiding via `openstation_dock_placement` (`'hidden'`). Per-item multi-window support via `openstation_dock_item_multi`. Letter-badge icon fallback for plugins without icon art.

- **Virtual desktops (“Spaces”)**
  Multiple desktops per user, each with its own window set. Overview grid (zoom-out view) surfaces the Spaces switcher, thumbnails, and create/close controls.

- **Arrange & snap**
  Admin-bar Arrange menu: Cascade, Tile, Overview, Snap to grid. Plugins contribute custom entries via `openstation_arrange_menu_items` and react to clicks via `os.arrange.custom-action`. Tile grid dimensions and snap cell size are both filterable.

- **Wallpaper registry**
  Server- and client-side registration (`openstation_register_wallpaper()` / `wp.os.registerWallpaper()`). CSS presets + canvas (WebGL/2D) wallpapers with collision-aware surface data (`wp.os.getWallpaperSurfaces()`) for snow/rain/physics effects. In-panel `renderEditor` callback for custom controls, shared vendor-module loader (`pixijs` pre-registered).

- **Widgets**
  Right-column floating cards, optionally draggable / resizable outside the column. `openstation_register_widget()` / `wp.os.registerWidget()`. Built-in clock. User placement persists per-user in `localStorage`.

- **Desktop icons**
  Wallpaper-layer shortcuts via `openstation_register_icon()` — targets a registered native window or an admin URL.

- **AI Assistant + slash commands**
  Cmd+K palette backed by an OpenAI agentic loop whose `search_posts` / `search_pages` / `search_comments` tools run WordPress's native keyword search. Admin-configured API key + model picker. The only automatic AI analysis is comment spam scoring (on comment save), which feeds the comments-window spam score; posts, pages, and terms are not analyzed. `wp.os.registerCommand()` adds slash commands with autocomplete (`suggest()`), confirm dialogs (`ctx.confirm()`), and full lifecycle hooks (`before-run` / `after-run` / `error`). Built-in `/open [window]` is extensible via `os.open-command.items`.

- **Palette registry**
  Cmd+K cycles through all registered palettes (`wp.os.registerPalette()`) — the AI assistant is palette 0 by default; additional plugin overlays share the shortcut.

- **Cross-frame drag bridge**
  Media-library attachments drag across iframe boundaries via coordinated postMessage. Site-wide toggle through the Extended Options REST endpoint.

- **Toast notifications**
  Shell-level toasts rendered via the `<os-toast>` component. Plugins register their own tone/icon via the `openstation_toast_types` filter. Iframe pages raise a toast through the `os-notification` bridge message — it survives the iframe's own lifecycle.

- **OpenStation Preferences**
  Native-window settings panel: wallpaper picker (with HD-only media filter), accent color swatches + custom gradient editor, dock size slider, AI platform config, and per-user default-on-startup window. Persisted via `/desktop-mode/v1/os-settings`.

- **Session persistence**
  Full window stack (including desktops, focus, state) is debounce-saved to `/desktop-mode/v1/session` and restored without layout flicker. Viewport-shrink clamping keeps off-screen windows reachable.

- **postMessage bridge**
  Typed messages for title changes, navigation (same-origin validated), focus, color-scheme sync, screen-meta panels (Screen Options / Help), external-link capture, iframe-ready handshake, and observability (`iframe-error`, `iframe-network`).

- **UI component library**
  ~25 `<os-*>` web components (`os-button`, `os-menu`, `os-panel`, `os-range-field`, `os-swatch`, `os-toast`, `os-tabs`, …) available to plugin authors — rendered server-side via `openstation_component()` or imported in TS.

- **i18n**
  Full gettext coverage across PHP and TypeScript; Spanish translation shipped. Strings go through `wp.i18n` (`__`, `_x`, `_n`, `sprintf`) directly — no shell-specific re-export.

- **Component registration API**
  Stable `openstation_register_*` functions for windows, widgets, wallpapers, icons, and window tabs. All return `true` / `WP_Error` with documented error codes.

- **Public hook API**
  Comprehensive PHP and JS hook surface — dock items, placement, multi-window, native-window lifecycle, widget lifecycle, wallpaper lifecycle + surfaces, window lifecycle, iframe observability, arrange actions, virtual-desktop transitions, palette registration, command lifecycle, batch close, AI prompt + model + post-type filters, accents, toast types, default wallpaper. See [`docs/hooks-reference.md`](./docs/hooks-reference.md) and [`docs/javascript-reference.md`](./docs/javascript-reference.md).

---

## Still ahead

- **Mobile (phone OS)** — purpose-built home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar.
- **Tablet hybrid** — split view, slide-over, horizontal dock. `wp.os.mode = 'desktop' | 'tablet' | 'mobile'` surface.
- **Cross-window drag & drop (the North Star)** — extend the current drag bridge to Media → Gutenberg block insertion, with pluggable mime-type negotiation.
- **Polish** — color-scheme-aware variables across all shell surfaces, View Transitions API animations, full a11y audit (ARIA, focus traps, keyboard nav).
- **…and a whole lot more hooks, filters, and actions** — every new surface lands with its own extension points, so this list keeps growing.

See [`docs/architecture.md`](./docs/architecture.md) for how the pieces fit together and [`docs/hooks-reference.md`](./docs/hooks-reference.md) for the hook surface (current and planned).

---

## Repository layout

```
.
├── desktop-mode.php       # bootstrap: header, constants, require_once of includes/
├── includes/              # PHP subsystems
│   ├── helpers.php              admin-bar.php       ajax.php
│   ├── assets.php               render.php          portal.php
│   ├── session.php              default-window.php  components.php
│   ├── os-settings.php          extended-options.php
│   ├── accents.php              wallpapers.php      toast-types.php
│   ├── media-query.php
│   └── ai-copilot/              # AI assistant (OpenAI client, analysis, search, jobs)
├── assets/                # hand-authored CSS + JS build output
│   ├── css/  desktop.css, windows.css, dock.css, chromeless.css, variables.css
│   │          variables.css carries the OpenStation palette — every design
│   │          token the shell and the <os-*> kit read, declared once
│   ├── fonts/    Geist + Geist Mono (variable, SIL OFL 1.1)
│   ├── wallpapers/  the four brand desks: galaxy (default), space,
│   │          holomesh, pulsemesh
│   ├── desktop-themes/legacy/
│   │          the built-in "Desktop Mode (Legacy)" theme — a frozen snapshot of
│   │          every token at its pre-brand value; never regenerated.
│   │          Zip it with npm run package:legacy-theme
│   └── js/   Vite bundles (gitignored; regenerate with npm run build) — only
│             admin-bar.js and media-library-enhanced.js are hand-written and tracked
├── src/                   # TypeScript source — compiled by Vite
│   ├── desktop.ts / dock.ts / hooks.ts / commands.ts / palette-registry.ts
│   ├── ai-assistant/ + drag-bridge.ts / toast.ts / desktop-icons.ts
│   ├── native-windows.ts / built-in-commands.ts / public-api.ts / types.ts
│   ├── window/          # Window class — DOM, pointer, tabs, iframe bridge
│   ├── window-manager/  # stack, desktops, arrange, snap, overview
│   ├── wallpapers/      # registry, layer, surfaces, server sync, vendor loader
│   ├── widgets/         # registry, layer, frame, picker, storage
│   ├── settings/        # OpenStation Preferences panel sections
│   ├── ui/              # <os-*> web components
│   ├── modules/         # vendor-script lazy-loader
│   └── plugins/         # built-in demos (animated-logo-wallpaper)
├── docs/                  # developer-facing docs (source of truth for plugin authors)
├── extensions/            # bundled sibling plugins (see "Bundled extensions" below)
├── tests/                 # PHPUnit + Vitest
├── languages/             # .po / .mo (es shipped)
├── bin/                   # package-zip helpers
├── package.json           # devDeps (vite, typescript, vitest)
├── vite.config.js         # Vite lib-mode: src/desktop.ts → assets/js/desktop[.min].js (IIFE)
├── vitest.config.ts
└── tsconfig.json
```

---

## Bundled extensions

The `extensions/` directory hosts sibling plugins that build on OpenStation's public APIs. Each one is a standalone WordPress plugin (`Requires Plugins: desktop-mode`) installed from its own zip — run `./bin/package-extensions.sh` to build one `<slug>.zip` per extension under `dist/`; see [`docs/RELEASE.md`](./docs/RELEASE.md#packaging-extensions) for the full packaging steps. (`extensions/base/` is a shared base library for extension authors, not an installable plugin.)

- **Code Editor** (`desktop-mode-code-editor`) — a Monaco-backed Code editor native window for browsing and editing files inside `wp-content`. Editing requires the `edit_plugins` capability and is disabled entirely when `DISALLOW_FILE_EDIT` is set.
- **Cron Manager** (`desktop-mode-cron-manager`) — a Cron Jobs native window for browsing, editing, deleting, and running WP-Cron events. Gated by `manage_options`.
- **Popup Siege** (`desktop-mode-popup-siege`) — a 90-second Breakout-style archive rescue game with OpenStation leaderboards, play-time tracking, and score-to-beat challenges. The deterministic game runtime is lazy-loaded on first play.
- **SOL Inbound Monologue** (`desktop-mode-feed-buddy`) — an AIM-era RSS/Atom reader with a movable buddy-list widget, a native conversation-style reader window, per-user subscriptions and unread state, safe server-side feed discovery, and optional synthesized chimes.
- **phpMyAdmin** (`desktop-mode-phpmyadmin`) — embeds a bundled phpMyAdmin install as a native window. **Local environments only**: the window registers solely when `wp_get_environment_type()` is `'local'`, because the bundled phpMyAdmin runs with `auth_type=config` and reuses the WordPress DB credentials — any visitor who finds the URL gets full DB access. The `manage_options` check only hides the shortcut from lower-privilege users; it does **not** gate the underlying URL.

---

## How to run it

### Quick install

Just want to try it? Grab the pre-built zip and upload it to any WordPress — [Studio by WordPress.com](https://developer.wordpress.com/studio/), [`wp-env`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/), or a hosted site. No Node, no build step.

1. Download [`openstation.zip`](https://github.com/WordPress/openstation/releases/latest/download/openstation.zip) from the latest release (or pick a specific version from the [releases page](https://github.com/WordPress/openstation/releases)).
2. In WP Admin: **Plugins → Add New → Upload Plugin**, choose the zip, and activate.
3. Click the **desktop** icon in the admin bar's top-right corner. The admin reloads inside the desktop shell. Click the same icon again to return to classic admin.

### Development setup

For hacking on the plugin: clone the repo, run the build in watch mode, and load it into a local WordPress via symlink so every save is one browser refresh away.

#### 1. Install dependencies

```bash
npm install
```

#### 2. Build the TypeScript bundle

The plugin uses **[Vite](https://vitejs.dev/)** in library mode. esbuild handles transpile and minify, so builds finish in ~70 ms per bundle.

**Full build** — runs the PixiJS vendor-copy step plus every `build:*` target defined in `package.json` (one Vite bundle each; the `scripts` block in `package.json` and the entry map in `vite.config.js` are the authoritative target list):

```bash
npm run build
```

Writes one `assets/js/<target>.js` / `.min.js` pair per target, including:

- `assets/js/desktop.js` / `.min.js` — main shell bundle (loaded based on `SCRIPT_DEBUG`).
- `assets/js/iframe-bridge.js` / `.min.js` — opt-in bridge that gives any same-origin iframe access to `wp.os.iframe.*`.
- `assets/js/recycle-bin.js` / `.min.js` — Recycle Bin native window.
- `assets/js/posts-window.js` / `.min.js` — Native Posts window (the `<os-table>` replacement for the `edit.php` iframe; opt-in per user via OpenStation Preferences → Features).

**Development watch** — auto-recompiles the unminified bundle on save:

```bash
npm run dev
```

Leave it running in a separate terminal; refresh the browser after each save. Set `define( 'SCRIPT_DEBUG', true )` in `wp-config.php` so WordPress picks up the unminified bundle during development.

#### 3. Load into a local WordPress

You need a running WordPress to load the plugin into. Pick whichever is easier.

##### Studio, wp-env, or a hosted WP

Run `npm run package` to build a zip from `HEAD` (with correct 0644 / 0755 permissions), then follow the [Quick install](#quick-install) steps 2–3 to upload and activate it. Re-package and re-upload after each change.

> If you changed source, run `npm run build` before `npm run package` — the Vite output is gitignored, and `bin/package.sh` splices the built files into the zip from your working tree.

> `npm run package:legacy-theme` builds `dist/desktop-mode-legacy-theme.zip` — the built-in [Legacy desktop theme](./docs/desktop-themes.md#the-legacy-theme--start-here) as an installable theme ZIP. The plugin registers Legacy from code either way; the zip is for handing it to someone else or forking it into a theme of your own.

##### Clone `wordpress-develop` and symlink

Gives you the full dev loop: `npm run dev` rebuilds on save, a browser refresh picks it up.

```bash
# clone Core's Docker-based dev host alongside this repo
git clone https://github.com/WordPress/wordpress-develop.git
cd wordpress-develop
npm install

# symlink this plugin into the WP plugins directory
ln -s "$(pwd)/../alcazaba-plugin" src/wp-content/plugins/desktop-mode

# boot + install WordPress
npm run env:start      # nginx + PHP + MySQL in Docker
npm run env:install    # installs WordPress
```

Site: **http://localhost:8889**
Admin: **http://localhost:8889/wp-admin/**
Credentials: `admin` / `password`

Stop the environment with `npm run env:stop` (from the `wordpress-develop` directory). Activate the plugin per [Quick install](#quick-install) steps 2–3.

---

## Requirements

- WordPress **6.0+**
- PHP **7.4+**

## For plugin authors

**This plugin is built to be extended.** Every significant behavior is hookable — drop an icon on the desktop, add a dock item, gate OpenStation by role, react to window events, or register a native window, all from your own plugin with zero patches here.

**See [`docs/`](./docs/README.md) — the developer documentation index.**

Quick links:

- [Getting Started](./docs/getting-started.md) — the five-minute tour for plugin authors.
- [Architecture](./docs/architecture.md) — how the pieces fit together.
- [Hooks Reference](./docs/hooks-reference.md) — every action and filter we fire, with signatures and examples.
- [JavaScript Reference](./docs/javascript-reference.md) — CustomEvents, `window.wp.os` API, and the iframe `postMessage` bridge.
- [Examples](./docs/examples/) — copy-paste recipes.

## License

GPLv2 or later. See [LICENSE](LICENSE).
