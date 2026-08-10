# OpenStation — Electron Adapter

Sets OpenStation windows free into **real operating system windows**.

OpenStation is a WordPress plugin that renders wp-admin as a desktop,
served over HTTP, working in any browser. This extension adds the one
thing a browser tab cannot: when the desktop is opened through the
bundled Electron app, any window can leave the OpenStation desk for the
user's actual one.

```
OpenStation core
├── Window Manager          ← untouched
├── App Registry            ← untouched
│
└── extensions
      └── Electron Adapter          ← this package
            ├── IPC                 app/src/lib/protocol.ts
            ├── Native windows      app/src/lib/free-windows.ts
            ├── OS integration      app/src/main.ts
            └── Host contract       includes/host.php
```

**Core mentions Electron nowhere.** Everything here stands on two
generic capabilities core gained, each useful on its own:
`wp.os.registerWindowAction()` (rows in a window's ⋯ menu) and
`?openstation_solo=<id>` (boot the shell painting exactly one window).
Deactivate this plugin and OpenStation is exactly the browser
experience it was.

## Set it free

Every window's ⋯ menu grows one row when the app is running:

> **Send to your Mac** · **Send to your Windows PC** · **Send to your Linux desktop**

Pick it and the window leaves the desk — its own dock or taskbar entry,
its own Alt-Tab slot, sitting among the user's native apps. Close the
native window and it comes back. The row toggles rather than
duplicating, because a window is either *here* or *there*, never both.

The label adapts to the host OS because the app reports its own name;
nothing guesses from a user agent.

## Install and run

### 1. Make WordPress see the plugin

This extension lives *inside* the OpenStation plugin directory, and
WordPress does not look for plugins in nested folders. Like every other
extension in this repo, it needs a symlink into `wp-content/plugins/`:

```bash
cd /path/to/wp-content/plugins
ln -sfn desktop-mode/extensions/openstation-electron-adapter openstation-electron-adapter
wp plugin activate openstation-electron-adapter
```

**This step is the whole feature.** Without it the app connects and the
desktop loads perfectly — and no ⋯ menu row appears, because the shell
adapter that registers it was never enqueued. If "Send to your Mac" is
missing, check here first.

### 2. Run the app

```bash
npm install
npm start          # builds the app, launches Electron
```

First launch asks for a site address (`http://localhost:8889` for a
typical local WordPress). After that it opens straight into the
desktop. You sign in with your normal WordPress account; the app stores
nothing but the address.

### Scripts

| Script | What it does |
|---|---|
| `npm run build` | Both halves: the shell bundle and the Electron app. |
| `npm run build:shell` | Vite → `assets/js/electron-adapter[.min].js`. |
| `npm run build:app` | `tsc` (main + preloads) → `app/dist/`, Vite for the connect screen, then its static assets. |
| `npm start` | Build the app, then launch it. |
| `npm run lint` / `lint:fix` | ESLint over `src/`, `app/src/`, `tests/`. |
| `npm run typecheck` | Both tsconfigs. |
| `npm test` | Vitest. |
| `npm run verify` | lint + typecheck + test + build. Run before committing. |
| `npm run dist:{mac,win,linux}` | electron-builder packages. |

**Never hand-edit `assets/js/electron-adapter*.js`** — it is build
output, same rule as the main plugin's `assets/js/`. Edit `src/` and
rebuild.

### Why `npm start` renames your Electron

On macOS the bold title in the menu bar and the name in the Dock come
from the **running application bundle** — `CFBundleName` in its
`Info.plist` — not from `app.setName()`. That call fixes "About
OpenStation", "Hide OpenStation" and "Quit OpenStation", because macOS
builds those from `app.getName()`, while the title beside them keeps
saying **Electron**.

In development there is no OpenStation bundle: `electron .` runs
`node_modules/electron/dist/Electron.app`. A packaged build has no such
problem — its bundle *is* OpenStation.app.

So `scripts/brand-dev-bundle.mjs` renames that local bundle and swaps
its icon, on `npm start` and on `postinstall`. It is idempotent,
macOS-only, and never fatal: skip it and you get an app called
Electron, which is exactly the status quo. `npm install` regenerates
the file it edits.

Icons live in `build/`: `icon.icns` and a 1024px `icon.png`, both
generated from `.wordpress-org/icon.svg` and **committed**, so
packaging never needs a rasteriser installed. electron-builder derives
the Windows `.ico` and the Linux sizes from the PNG. The *runtime*
icon — the Dock, and window icons on Windows and Linux — is a separate
copy under `app/src/renderer/openstation.png`, because electron-builder
treats `build/` as packaging resources and leaves it out of the bundle.

## How it works

### Detection is one global

`app/src/preload/shell.ts` injects `window.openStationDesktopHost`
through an Electron `contextBridge`. **Presence of that object is the
whole probe** — synchronous, no network, cannot go stale. Every
host-dependent path is behind it, which is exactly why the browser
experience is unchanged when the app is not there.

`contextIsolation` is on, so the page gets functions and plain data,
never a live `ipcRenderer`. A compromised admin page can ask the host
to open a window; it cannot ask Node to do anything. The ESLint config
enforces that: exposing `ipcRenderer` from a preload is a lint error,
not a code-review hope.

### What a freed window loads

Decided by the *shell adapter*, never by the app — the app takes a URL:

| Window kind | URL |
|---|---|
| Iframe windows (any admin screen) | The chromeless URL its iframe was showing. |
| Native windows (Files, Games, plugin canvases) | The shell in solo mode: `?openstation_solo=<window-id>`. |

A native window has no URL of its own — it is a render callback
painting into the shell's DOM — so solo mode boots the whole shell and
paints exactly one window, no desk around it.

The main process re-checks every URL against the connected site before
opening a window on it. The preload already checked the scheme; the
page choosing the URL is exactly the thing an attacker might have a
foothold in, so the last gate is on the Node side.

### A window we own stays on the site

A preload survives navigation: whatever `contextBridge` exposed stays
reachable no matter which origin the document now comes from. So it is
not enough to check where `window.open()` goes — an un-`target`ed link,
a `location.href =` or a 302 would otherwise hand the host bridge to a
page nobody paired with.

Every window the app owns therefore holds `will-navigate` and
`will-redirect` to the same rule its popups already followed
(`navigationVerdict()` in `app/src/lib/site-url.ts`): on the site it
stays, another http(s) address opens in the browser, anything else is
refused. The one exception is the shell window's **first** navigation
chain, which runs unchecked so that a site answering `example.com` with
a redirect to `www.example.com` still connects — whatever that chain
settles on becomes the site, and everything after it is held to that.

A consequence worth knowing: a site that signs in through an **external
identity provider** will send that hop to the browser rather than
following it in the app.

And the REST root the shell hands over at handshake is checked the same
way, because the handshake body carries the agent's bearer token. Where
a secret goes is not something a renderer gets to choose.

### Telling the site it is alive

`app/src/lib/connection.ts` registers over REST and beats a slow pulse.
Every beat is a real PHP request, and OpenStation runs on cheap shared
hosting, so:

- **the server picks the interval** (default 120 s, filterable in PHP;
  the app re-reads it from every response);
- **idle costs less** — beats are skipped while nothing has been focused
  and nothing is freed;
- **failure backs off** geometrically;
- **sleep stops the timer**, waking beats immediately.

The whole record on the server is one user-meta row.

## Layout

```
openstation-electron-adapter.php   WordPress plugin entry
includes/host.php                  REST handshake + heartbeat, hooks
includes/assets.php                shell enqueues, config blob
src/                               shell adapter (browser, TypeScript)
  index.ts                           wiring: ⋯ row, hooks, wp.os.electron
  host.ts                            detection + freed-window URL rules
  freed-windows.ts                   the here-or-there state machine
  types.ts                           the shell-side contract
assets/js/electron-adapter*.js     build output — do not edit
assets/css/solo-host.css           solo mode inside a real OS window
build/icon.{icns,png}              packaging icons, from .wordpress-org/icon.svg
scripts/brand-dev-bundle.mjs       names the dev Electron bundle OpenStation
app/                               the Electron app (TypeScript)
  src/main.ts                        wiring: windows, IPC, menu
  src/lib/protocol.ts                IPC channels, protocol version, types
  src/lib/connection.ts              handshake + liveness heartbeat
  src/lib/schedule.ts                pacing rules (pure)
  src/lib/free-windows.ts            the freed-window registry
  src/lib/site-url.ts                address parsing + same-site checks
  src/lib/store.ts                   JSON state in userData
  src/preload/{shell,free,connect}.ts
  src/renderer/connect.{ts,html}     first-run "which site?" screen
  src/renderer/openstation.{svg,png} the brand mark, from .wordpress-org/
tests/                             Vitest, both halves
```

### Why the connect screen is bundled, not compiled

The app's `tsconfig` emits **CommonJS**, which is what Electron loads
main-process and preload code as. A renderer is not that: with
`nodeIntegration: false` a CommonJS prologue throws `exports is not
defined` on its first statement, the script dies, and no listener ever
binds — a Connect button that silently does nothing, with no type
error and no lint error to warn you. So `app/src/renderer/**` is
excluded from that tsconfig, bundled to an IIFE by `vite.config.mjs`
(`OPENSTATION_ADAPTER_TARGET=connect`), and typechecked by the root
tsconfig with the rest of the browser code. `tests/connect-bundle.test.ts`
asserts the built artefact stays free of both CommonJS and ESM syntax.

(ESM would be the other fix, but `type="module"` over `file://` is
blocked by CORS.)

### Two halves, kept apart on purpose

`src/**` is browser code that runs inside wp-admin. `app/src/**` is
Electron code. The ESLint config makes that structural rather than
aspirational: `src/**` may not import `electron` or Node built-ins,
`app/src/**` (outside the renderer) may not touch `document`, and
preloads may not expose `ipcRenderer`.

### Wiring vs. decisions

`main.ts` and the preloads are wiring — creating windows, routing IPC,
building a menu — because that is the part that needs a compositor to
observe. Everything worth testing was moved out of them: pacing into
`schedule.ts`, the connection state machine into `connection.ts`,
bookkeeping into `free-windows.ts` and `freed-windows.ts`, URL rules
into `site-url.ts` and `host.ts`. `npm test` covers all of it without
launching Electron.

## IPC contract

Renderer → main (`ipcRenderer.invoke`):

| Channel | Payload | Returns |
|---|---|---|
| `openstation:host-info` | — | platform, versions, host id, freed ids |
| `openstation:free-window` | `{ windowId, url, title?, width?, height?, native? }` | `{ ok, windowId, reused, error? }` |
| `openstation:dock-window` | `{ windowId }` | `{ ok }` |
| `openstation:focus-free-window` | `{ windowId }` | `{ ok }` |
| `openstation:list-free-windows` | — | `{ windowIds }` |
| `openstation:handshake` | `{ restUrl, nonce, siteUrl? }` | connection state |
| `openstation:connection` | — | connection state |
| `openstation:disconnect` | — | `{ ok }` |
| `openstation:open-window` | same as free-window | `{ ok, windowId, reused, error? }` |

`openstation:open-window` is the one channel on the **freed-window**
preload. It does what `free-window` does; what differs is who may call
it. A freed window paints exactly one window, so anything opening a
second one there — a game launched from a freed Games hub — has nowhere
to go, and forwarding it to the host turns a dead end into a new window
on the desktop. Siblings, not children.

Main → renderer (`webContents.send`):

| Channel | Payload |
|---|---|
| `openstation:free-window-freed` | `{ windowId }` |
| `openstation:free-window-docked` | `{ windowId }` |
| `openstation:connection-changed` | connection state |
| `openstation:frame-init` | `{ windowId }` *(to a freed window)* |

`app/src/lib/protocol.ts` carries `HOST_PROTOCOL_VERSION`. An adapter
that sees a **higher** version than it understands treats the host as
absent rather than guessing at payload shapes — the app's own fallbacks
beat a mis-shaped call.

The connect screen has its own window, its own preload, and its own two
channels. It is the only surface that can point the app at a different
site, so that channel is never reachable from the WordPress page.

## Dependency advisories

`npm audit` is not expected to be silent here, and the difference
between the two kinds of finding matters more than the count.

**Electron is kept current**, because it is the only dependency that
actually ships. Its advisories are real ones against the runtime your
users execute, so it gets upgraded on its own schedule rather than
waiting for anything else.

**Everything else in this package is a devDependency** — the packager,
the bundler, the linter. They run on a developer's machine over inputs
that developer already controls. That does not make them exempt, and
most have been cleared (`electron-builder` upgraded; `minimatch` pinned
through `overrides`). Two remain, both the same root cause:

| Finding | Why it is still here |
|---|---|
| `esbuild` ≤0.24.2 (moderate), and `vite` for depending on it | The advisory is that esbuild's **dev server** lets any website read its responses. This package never runs a dev server — `vite build` only — so the vulnerable surface is not reachable. Clearing it means vite 7+, which would diverge from the plugin's own pinned vite 5. It follows the plugin when the plugin moves. |

If you add a dependency here, the question to ask is which of those two
categories it lands in. Anything that ends up inside the shipped app
belongs to the first, and is not something to defer.

## Documentation

Plugin-side contract, hooks, solo mode, and `wp.os.electron`:
[`docs/desktop-host.md`](../../docs/desktop-host.md).

## License

GPL-2.0-or-later — same as OpenStation.
