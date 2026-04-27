# WP Desktop Mode

A WordPress plugin that reimagines `/wp-admin` as a desktop operating system. Admin screens open as draggable, resizable, minimizable **windows** on a **desktop**, with a left-edge **dock** built from the admin menu. Purely opt-in per user — the classic admin stays untouched for everyone else, and deactivating the plugin restores vanilla Core exactly.

Zero Core patches. Every feature is wired through public WordPress hooks.

<a href="https://playground.wordpress.net?blueprint-url=https://raw.githubusercontent.com/WordPress/desktop-mode/refs/heads/trunk/.wordpress-org/blueprints/blueprint.json">
  <img src="https://raw.githubusercontent.com/WordPress/action-wp-playground-pr-preview/v2/assets/playground-preview-button.svg" alt="Playground Demo Link" width="180">
</a>

## Demo

<video src="https://github.com/user-attachments/assets/590aacc2-e9d7-4213-889e-b91e060e1bd8" controls width="720"></video>

---

## Contents

- [Demo](#demo)
- [Current State](#current-state)
- [Still ahead](#still-ahead)
- [Repository layout](#repository-layout)
- [How to run it](#how-to-run-it)
  - [Quick install](#quick-install)
  - [Development setup](#development-setup)
- [Requirements](#requirements)
- [For plugin authors](#for-plugin-authors)
- [License](#license)

---

## Current State

- **Per-user opt-in**
  Admin-bar toggle sets the `desktop_mode_mode` user meta. A dedicated `/wp-desktop/` portal URL auto-enables desktop mode for first-time visitors (gated by `desktop_mode_portal_auto_enable`) and the `admin_init` redirect sends opted-in users from `/wp-admin/` to the portal (`desktop_mode_admin_redirect_to_portal`).

- **Desktop shell**
  Fixed-viewport desktop that overlays `/wp-admin`: wallpaper area, left dock, bottom taskbar, right-column widget layer, and full windowing system. `desktop_mode_mode_init`, `desktop_mode_shell_before` / `_after`, and the `desktop_mode_shell_config` filter are the main extension points.

- **Window system — iframe + native**
  Iframe windows load admin pages with `?wp_desktop=1` (chromeless mode). Native windows render directly in the parent DOM via `desktop_mode_register_window()` / `wp.desktop.registerWindow()` — multi-tab native windows are supported through `desktop_mode_register_window_tab()`. Both types share drag, resize, minimize, maximize, close, fullscreen, and detach-to-new-tab.

- **Dock + Taskbar**
  Left-edge dock for core WP menus; bottom macOS-style pill taskbar for installed-plugin menus. Placement is routed by `desktop_mode_dock_placement` (dock / taskbar / hidden). Per-item multi-window support via `desktop_mode_dock_item_multi`. Letter-badge icon fallback for plugins without icon art.

- **Virtual desktops (“Spaces”)**
  Multiple desktops per user, each with its own window set. Overview grid (zoom-out view) surfaces the Spaces switcher, thumbnails, and create/close controls.

- **Arrange & snap**
  Admin-bar Arrange menu: Cascade, Tile, Overview, Snap to grid. Plugins contribute custom entries via `desktop_mode_arrange_menu_items` and react to clicks via `wp-desktop.arrange.custom-action`. Tile grid dimensions and snap cell size are both filterable.

- **Wallpaper registry**
  Server- and client-side registration (`desktop_mode_register_wallpaper()` / `wp.desktop.registerWallpaper()`). CSS presets + canvas (WebGL/2D) wallpapers with collision-aware surface data (`wp.desktop.getWallpaperSurfaces()`) for snow/rain/physics effects. In-panel `renderEditor` callback for custom controls, shared vendor-module loader (`pixijs` pre-registered).

- **Widgets**
  Right-column floating cards, optionally draggable / resizable outside the column. `desktop_mode_register_widget()` / `wp.desktop.registerWidget()`. Built-in clock. User placement persists per-user in `localStorage`.

- **Desktop icons**
  Wallpaper-layer shortcuts via `desktop_mode_register_icon()` — targets a registered native window or an admin URL.

- **AI Assistant + slash commands**
  Cmd+K palette backed by an OpenAI agentic loop (search_posts, search_pages, search_comments tools). Admin-configured API key + model picker. Auto-analysis on `save_post` / term / comment save with per-entity prompt filters. `wp.desktop.registerCommand()` adds slash commands with autocomplete (`suggest()`), confirm dialogs (`ctx.confirm()`), and full lifecycle hooks (`before-run` / `after-run` / `error`). Built-in `/open [window]` is extensible via `wp-desktop.open-command.items`.

- **Palette registry**
  Cmd+K cycles through all registered palettes (`wp.desktop.registerPalette()`) — the AI assistant is palette 0 by default; additional plugin overlays share the shortcut.

- **Cross-frame drag bridge**
  Media-library attachments drag across iframe boundaries via coordinated postMessage. Site-wide toggle through the Extended Options REST endpoint.

- **Toast notifications**
  Shell-level toasts rendered via the `<wpd-toast>` component. Plugins register their own tone/icon via the `desktop_mode_toast_types` filter. Iframe pages raise a toast through the `wp-desktop-notification` bridge message — it survives the iframe's own lifecycle.

- **OS Settings**
  Native-window settings panel: wallpaper picker (with HD-only media filter), accent color swatches + custom gradient editor, dock size slider, AI platform config, and per-user default-on-startup window. Persisted via `/wp-desktop/v1/os-settings`.

- **Session persistence**
  Full window stack (including desktops, focus, state) is debounce-saved to `/wp-desktop/v1/session` and restored without layout flicker. Viewport-shrink clamping keeps off-screen windows reachable.

- **postMessage bridge**
  Typed messages for title changes, navigation (same-origin validated), focus, color-scheme sync, screen-meta panels (Screen Options / Help), external-link capture, iframe-ready handshake, and observability (`iframe-error`, `iframe-network`).

- **UI component library**
  ~25 `<wpd-*>` web components (`wpd-button`, `wpd-menu`, `wpd-panel`, `wpd-range-field`, `wpd-swatch`, `wpd-toast`, `wpd-tabs`, …) available to plugin authors — rendered server-side via `desktop_mode_component()` or imported in TS.

- **i18n**
  Full gettext coverage across PHP and TypeScript; Spanish translation shipped. Strings go through `wp.i18n` (`__`, `_x`, `_n`, `sprintf`) directly — no shell-specific re-export.

- **Component registration API**
  Stable `desktop_mode_register_*` functions for windows, widgets, wallpapers, icons, and window tabs. All return `true` / `WP_Error` with documented error codes.

- **Public hook API**
  Comprehensive PHP and JS hook surface — dock items, placement, multi-window, native-window lifecycle, widget lifecycle, wallpaper lifecycle + surfaces, window lifecycle, iframe observability, arrange actions, virtual-desktop transitions, palette registration, command lifecycle, batch close, AI prompt + model + post-type filters, accents, toast types, default wallpaper. See [`docs/hooks-reference.md`](./docs/hooks-reference.md) and [`docs/javascript-reference.md`](./docs/javascript-reference.md).

---

## Still ahead

- **Mobile (phone OS)** — purpose-built home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar.
- **Tablet hybrid** — split view, slide-over, horizontal dock. `wp.desktop.mode = 'desktop' | 'tablet' | 'mobile'` surface.
- **Cross-window drag & drop (the North Star)** — extend the current drag bridge to Media → Gutenberg block insertion, with pluggable mime-type negotiation.
- **Polish** — color-scheme-aware variables across all shell surfaces, View Transitions API animations, full a11y audit (ARIA, focus traps, keyboard nav).
- **…and a whole lot more hooks, filters, and actions** — every new surface lands with its own extension points, so this list keeps growing.

See [`docs/architecture.md`](./docs/architecture.md) for how the pieces fit together and [`docs/hooks-reference.md`](./docs/hooks-reference.md) for the hook surface (current and planned).

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
│   ├── menu.php                 media-query.php
│   └── ai-copilot/              # AI assistant (OpenAI client, analysis, search, jobs)
├── assets/                # compiled CSS + JS (Vite output; tracked in git)
│   ├── css/  desktop.css, windows.css, dock.css, chromeless.css, variables.css
│   └── js/   desktop.js, desktop.min.js, chromeless bridge, media-library enhancements
├── src/                   # TypeScript source — compiled by Vite
│   ├── desktop.ts / dock.ts / hooks.ts / commands.ts / palette-registry.ts
│   ├── ai-assistant.ts / drag-bridge.ts / toast.ts / desktop-icons.ts
│   ├── native-windows.ts / built-in-commands.ts / public-api.ts / types.ts
│   ├── window/          # Window class — DOM, pointer, tabs, iframe bridge
│   ├── window-manager/  # stack, desktops, arrange, snap, overview
│   ├── wallpapers/      # registry, layer, surfaces, server sync, vendor loader
│   ├── widgets/         # registry, layer, frame, picker, storage
│   ├── settings/        # OS Settings panel sections
│   ├── ui/              # <wpd-*> web components
│   ├── modules/         # vendor-script lazy-loader
│   └── plugins/         # built-in demos (animated-logo-wallpaper)
├── docs/                  # developer-facing docs (source of truth for plugin authors)
├── tests/                 # PHPUnit + Vitest
├── languages/             # .po / .mo (es shipped)
├── bin/                   # package-zip helpers
├── package.json           # devDeps (vite, typescript, vitest)
├── vite.config.js         # Vite lib-mode: src/desktop.ts → assets/js/desktop[.min].js (IIFE)
├── vitest.config.ts
└── tsconfig.json
```

---

## How to run it

### Quick install

Just want to try it? Grab the pre-built zip and upload it to any WordPress — [Studio by WordPress.com](https://developer.wordpress.com/studio/), [`wp-env`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/), or a hosted site. No Node, no build step.

1. Download [`desktop-mode.zip`](https://github.com/WordPress/desktop-mode/releases/latest/download/desktop-mode.zip) from the latest release (or pick a specific version from the [releases page](https://github.com/WordPress/desktop-mode/releases)).
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

**Full build** — produces both bundles:

```bash
npm run build
```

Writes:

- `assets/js/desktop.js` — unminified IIFE, loaded when `SCRIPT_DEBUG` is `true`.
- `assets/js/desktop.min.js` — esbuild-minified IIFE, loaded otherwise.

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

**This plugin is built to be extended.** Every significant behavior is hookable — drop an icon on the desktop, add a dock item, gate desktop mode by role, react to window events, or register a native window, all from your own plugin with zero patches here.

**See [`docs/`](./docs/README.md) — the developer documentation index.**

Quick links:

- [Getting Started](./docs/getting-started.md) — the five-minute tour for plugin authors.
- [Architecture](./docs/architecture.md) — how the pieces fit together.
- [Hooks Reference](./docs/hooks-reference.md) — every action and filter we fire, with signatures and examples.
- [JavaScript Reference](./docs/javascript-reference.md) — CustomEvents, `window.wp.desktop` API, and the iframe `postMessage` bridge.
- [Examples](./docs/examples/) — copy-paste recipes.

## License

GPLv2 or later. See [LICENSE](LICENSE).
