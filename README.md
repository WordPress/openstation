# WP Desktop Mode

A WordPress plugin that reimagines `/wp-admin` as a desktop operating system. Admin screens open as draggable, resizable, minimizable **windows** on a **desktop**, with a left-edge **dock** built from the admin menu. Purely opt-in per user — the classic admin stays untouched for everyone else, and deactivating the plugin restores vanilla Core exactly.

Zero Core patches. Every feature is wired through public WordPress hooks.

## Demo

<video src="./docs/demo.mp4" controls width="720"></video>

---

## Contents

- [Demo](#demo)
- [What it does today](#what-it-does-today)
- [Where it's going](#where-its-going)
- [Repository layout](#repository-layout)
- [How to run it](#how-to-run-it)
  - [1. Install dependencies](#1-install-dependencies)
  - [2. Build the TypeScript bundle](#2-build-the-typescript-bundle)
  - [3. Get it running in WordPress](#3-get-it-running-in-wordpress)
  - [4. Activate & toggle](#4-activate--toggle)
  - [5. Run the tests](#5-run-the-tests)
- [Requirements](#requirements)
- [For plugin authors](#for-plugin-authors)
- [License](#license)

---

## What it does today

- **Per-user opt-in** — toggle in the admin bar flips the `wp_desktop_mode` user meta. Off by default.
- **Desktop shell** — fixed viewport shell with a wallpaper area, rendered over `/wp-admin` only for users who opted in.
- **Windows** — each admin page loads in its own `<iframe>` with `?wp_desktop=1`, which strips the admin bar, side menu, and footer ("chromeless" mode). Windows drag, resize, minimize, maximize, and close. Positions/sizes persist.
- **Dock** — icon-only vertical strip on the left edge, built from the admin `$menu` global, with badges and per-window submenu tab strips for in-window nav.
- **Session persistence** — window stack (position, size, focus, state) is saved via a REST endpoint and rebuilt on next load, so layout survives reloads without a flash of default state.
- **postMessage bridge** — typed contract between parent shell and iframes for title changes, navigation, focus, and color-scheme propagation.
- **Public hook API** — filters and actions for dock items, window args, shell config, body classes, chromeless styles, and lifecycle events. Documented in [`docs/`](./docs/README.md).

## Where it's going

The plugin is mid-build. Phases 0–2 (opt-in, shell + single window, dock) have landed. Remaining:

- **Phase 3** — taskbar, multi-window orchestration, edge-snapping.
- **Phase 4** — polish: color-scheme-aware CSS variables, View Transitions animations, accessibility audit.
- **Phase 5–6** — responsive: a purpose-built **mobile phone-OS** experience (home grid, full-screen apps, app switcher, gesture nav, bottom tab bar) and a **tablet hybrid** (split view, slide-over). `wp.desktop.mode` exposes `'desktop' | 'tablet' | 'mobile'`; same codebase, three experiences.
- **Phase 7** — **native windows** that render directly in the parent DOM (no iframe) via `wp_register_desktop_window()`. Validated by **Jorvy**, a tiny companion plugin (Marvel quotes, Hello-Dolly style) used as the end-to-end smoke test for the native-window API.
- **Phase 8 — the North Star**: **cross-window drag and drop**. Drag a photo from the Media window directly into the Gutenberg editor in the Post window. Implemented as a coordinated `postMessage` "lift-and-drop" bridge, since browsers block cross-iframe native DnD.

See [`docs/architecture.md`](./docs/architecture.md) for how the pieces fit together and [`docs/hooks-reference.md`](./docs/hooks-reference.md) for the hook surface (current and planned).

---

## Repository layout

```
.
├── wp-desktop-mode.php    # bootstrap: header, constants, require_once of includes/
├── includes/              # PHP (helpers, ajax, admin-bar, assets, render, portal, session)
├── assets/                # compiled CSS + JS (Vite output)
├── src/                   # TypeScript source — compiled by Vite
├── docs/                  # developer-facing docs (source of truth for plugin authors)
├── tests/phpunit/         # PHPUnit, @group desktop-mode
├── package.json           # devDeps (vite, typescript)
├── vite.config.js         # Vite lib-mode: src/desktop.ts → assets/js/desktop[.min].js (IIFE)
└── tsconfig.json
```

---

## How to run it

### 1. Install dependencies

```bash
npm install
```

### 2. Build the TypeScript bundle

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

### 3. Get it running in WordPress

You need a running WordPress for the plugin to load into. Pick whichever is easier.

#### Option A — Install as a zip (easiest)

Works with any WordPress you already have: [Studio by WordPress.com](https://developer.wordpress.com/studio/), [`wp-env`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/), or a hosted site.

Package the repo as a plugin zip:

```bash
npm run package
```

> Packages `HEAD` with correct file/dir permissions (0644 / 0755) so WordPress can read the files after extraction. If you changed source, run `npm run build` and commit the regenerated `assets/js/desktop*.js` first — they're tracked.

Then in WP Admin go to **Plugins → Add New → Upload Plugin**, choose `wp-desktop-mode.zip`, and activate. Skip ahead to [§4 Activate & toggle](#4-activate--toggle).

> Good for trying it out. Not ideal for active development — every change requires a rebuild + re-upload.

#### Option B — Clone `wordpress-develop` (for active development)

This gives you the full dev loop: `npm run dev` in the plugin rebuilds on save, and a browser refresh picks it up.

```bash
# clone Core's Docker-based dev host alongside this repo
git clone https://github.com/WordPress/wordpress-develop.git
cd wordpress-develop
npm install

# symlink this plugin into the WP plugins directory
ln -s "$(pwd)/../alcazaba-plugin" src/wp-content/plugins/wp-desktop-mode

# boot + install WordPress
npm run env:start      # nginx + PHP + MySQL in Docker
npm run env:install    # installs WordPress
```

Site: **http://localhost:8889**
Admin: **http://localhost:8889/wp-admin/**
Credentials: `admin` / `password`

Stop the environment with `npm run env:stop` (from the `wordpress-develop` directory).

### 4. Activate & toggle

1. Log in at `/wp-admin`.
2. **Plugins → WP Desktop Mode → Activate**.
3. Click the **desktop** icon in the admin bar's top-right corner.
4. The admin reloads inside the desktop shell.

Click the same icon again to return to classic admin.

### 5. Run the tests

```bash
npm run test:php        # PHPUnit, @group desktop-mode
```

Or, inside the Docker container:

```bash
docker exec wordpress-alcazaba-php-1 bash -c \
  'export WP_TESTS_DIR=/var/www/tests/phpunit && cd /var/www && \
   vendor/bin/phpunit -c src/wp-content/plugins/wp-desktop-mode/tests/phpunit/phpunit.xml.dist \
   --group desktop-mode'
```

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

GPLv2 or later. See [LICENSE](https://www.gnu.org/licenses/gpl-2.0.html).
