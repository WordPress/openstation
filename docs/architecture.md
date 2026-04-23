# Architecture

A high-level tour, mostly so hook reference + examples make sense.

## The big picture

```
Browser tab
├── Parent shell  (wp-admin, desktop class on body)
│   ├── Admin bar            — classic WP toolbar + desktop-mode toggle
│   ├── Dock                 — left edge, core WP menus from $menu
│   ├── Desktop area         — wallpaper; hosts windows + desktop icons
│   │   ├── Window A         — <iframe src="edit.php?wp_desktop=1">
│   │   ├── Window B         — <iframe src="upload.php?wp_desktop=1">
│   │   └── Window C (native)— <div> with plugin-rendered content
│   └── Taskbar              — bottom pill, plugin-contributed admin.php?page=* menus
│
└── Each iframe renders a chromeless admin page
    — real WordPress request, stripped of wp-admin chrome
```

## PHP flow (per request)

1. `admin_init` — portal redirect logic decides whether to keep the request where it is or send the user to `/wp-desktop/`.
2. `admin_body_class` — the `wp-desktop-active` or `wp-desktop-chromeless` class is appended so CSS and JS can key off it.
3. `admin_enqueue_scripts` — CSS and JS are registered on a per-mode basis (shell assets in desktop mode, chromeless overrides in iframes).
4. `in_admin_header @ 5` — the shell markup is injected right after the admin bar (`<div id="wp-desktop-shell">`).
5. `admin_footer` — the chromeless bridge script is injected inside iframes so they can `postMessage` back to the shell.

Key server-side entry points:

| File | Purpose |
|---|---|
| `wp-desktop-mode.php` | Plugin bootstrap — loads the `includes/` files. |
| `includes/helpers.php` | `wpdm_is_enabled()`, `wpdm_is_chromeless_request()`, dock builder, chromeless admin-bar suppression. |
| `includes/ajax.php` | `wpdm_ajax_save()` — the `wp_ajax_save-desktop-mode` endpoint. |
| `includes/admin-bar.php` | Toggle node + inline JS click handler. |
| `includes/assets.php` | Registers CSS/JS handles on `init`. |
| `includes/render.php` | Shell markup, chromeless bridge emission, body classes. |
| `includes/portal.php` | Portal URL (`/wp-desktop/`) and redirect rules. |
| `includes/session.php` | REST endpoints for saving/restoring the per-user window session. |

## Browser flow

1. `/wp-admin/` loads → portal redirect sends the user to `/wp-desktop/`.
2. `/wp-desktop/` serves a real admin page (Dashboard by default) with the shell wrapped around it.
3. The shell's Vite-built TypeScript bundle (`desktop.js` in dev, `desktop.min.js` in prod) initializes:
   - Creates the `WindowManager`.
   - Creates the `Dock`.
   - Either restores the saved session (if one exists) **or** opens the current page in a new window.
   - Wires persistence — debounced `POST /wp-json/wp-desktop-mode/v1/session`.
4. When a dock icon is clicked, the manager opens a window whose iframe `src` is the admin URL with `?wp_desktop=1` appended.
5. The iframe renders WordPress normally, but the chromeless stylesheet hides the admin bar, side menu, and wp-footer.
6. The iframe `postMessage`s its title, navigation, and screen-meta state up to the parent.

## Two window types

### Iframe windows (default)

Used for **every existing admin page**. Zero plugin changes required — the chromeless request strips chrome and the iframe does the rest. Trade-off: no direct DOM access between parent and iframe (so cross-frame communication is `postMessage`-only).

### Native windows (shipped — 0.11.0)

Registered via `wp_register_desktop_window()` (PHP) or `wp.desktop.registerWindow()` (JS). Content renders **directly in the parent DOM** — no iframe, direct shell access, lower overhead. Good for lightweight tools (color picker, settings panels, quick notes) and for anything that wants to participate in cross-window interactions directly.

Additional tabs can be attached to any native window with `wp_register_desktop_window_tab()` — the first tab is the window's own template, and subsequent registrations (from any plugin) append after it. When two or more tabs exist the shell auto-wraps the render tree in `<wpd-stack>` + `<wpd-tabs>` so plugin authors don't hand-write tabstrip markup.

The shell's own **OS Settings** native window (wallpaper / accent / dock-size / AI config / default-window) is both a shipped feature and the reference implementation. Lifecycle hooks — `wp-desktop.native-window.before-render` (filter), `after-render`, `before-close` — let a plugin decorate or wrap another plugin's render output.

## Session persistence

Every window lifecycle event — open, close, focus, move, resize, state change — is pushed into a debounced writer that `POST`s the full stack to a REST endpoint. On next load, the shell reads the session and rebuilds the stack before the user sees anything (no "flash of default layout"). Clamping logic adapts window coordinates when the viewport shrinks.

REST surface:

- `GET  /wp-json/wp-desktop-mode/v1/session` — current user's saved session.
- `POST /wp-json/wp-desktop-mode/v1/session` — overwrite the session. Body: `{ session: { windows: [...], focused, updated } }`.
- `DELETE /wp-json/wp-desktop-mode/v1/session` — clear it.

All session routes require a valid `X-WP-Nonce` (the standard REST nonce) and the current user to be logged in with capability `read`.

We also extend Core's `/wp/v2/media` endpoint with two opt-in query parameters so the OS Settings wallpaper picker (and any plugin that wants the same capability) can ask the server to filter out images that are too small to look good stretched across the desktop:

- `wpdm_min_width=<int>`  — only return images at least this many pixels wide.
- `wpdm_min_height=<int>` — only return images at least this many pixels tall.

Both params are purely additive — omitting them keeps the endpoint's default behavior untouched. Implementation lives in `includes/media-query.php`: every new upload gets stamped with two flat numeric post-meta keys (`_wpdm_width`, `_wpdm_height`) via `wp_generate_attachment_metadata` / `wp_update_attachment_metadata`, and the params translate into a `WP_Meta_Query` NUMERIC `>=` clause. Pre-existing attachments are backfilled opportunistically — each filtered REST request stamps up to 50 unstamped images — so a site upgrading into this feature starts seeing real filtered results within a few picker opens rather than requiring a CLI run. Once every image has been stamped, the `wpdm_media_dims_backfilled` site option flips to `1` and the sweep query is skipped from then on.

## Command palette bridge (Cmd+K, hijacked)

WordPress 6.4+ ships a command palette via `@wordpress/commands` — the one that opens on Cmd+K in Gutenberg / site editor. Inside a desktop-mode iframe we **suppress it** and reroute the keystroke to the shell's own palette, then **harvest** the iframe's `core/commands` registry and re-publish every command as a slash-command in the shell. The user sees one palette; it's ours; it contains whatever the focused window contributes.

This is a deliberate hack — there is no public API on `@wordpress/commands` for a parent frame to read and invoke commands from a child iframe. The implementation lives in two places:

- **Iframe side** (`includes/render.php`, chromeless bridge script):
  1. A capture-phase `keydown` handler `preventDefault`s Cmd/Ctrl+K and posts `wp-desktop-palette-cycle` to the parent. No more "native palette flashes before ours wins the race."
  2. A React component is mounted into a hidden div (via `wp.element.createRoot`). It `useSelect`s `getCommandLoaders(true)` and `getCommands(true)` from `core/commands`; one child component per loader invokes the loader's hook under a legal render context. Results are collected into a ref-based bucket (state would setState-loop — every hook call returns a fresh array reference).
  3. Callbacks are NOT executed to classify navigation commands. `Location.prototype.href` is non-configurable so a sandbox can't intercept `location.href = X` without real navigation — an earlier attempt cascaded into infinite window spawning. We now match `Function.prototype.toString()` against a string-literal regex instead. Computed URLs fall back to `action`.
  4. React icons (`@wordpress/icons` elements) are flattened to SVG markup via `wp.element.renderToString` so they can cross `postMessage`'s structured clone.
  5. A private `__wpdCommandCallbacks` cache, rebuilt every harvest, keeps live references to the loader commands' callbacks. Loader results aren't in `getCommands()` so the invoke path needs its own lookup.

- **Parent side** (`src/commands/iframe-bridge.ts`):
  1. On `wp-desktop-window-focused`, send `wp-desktop-commands-subscribe` to that window's iframe; evict the previous window's commands tagged with owner `iframe:<windowId>`.
  2. On `wp-desktop-commands-list`, re-register everything under the new owner. Navigation-kind commands become "open a new desktop window" via `manager.open`; action-kind commands post `wp-desktop-commands-invoke` back to the iframe.
  3. On `wp-desktop-window-changed` with `state: 'minimized'` for the subscribed window, evict its commands — minimized windows shouldn't contribute to a palette that's supposed to reflect what's actionable right now. The next focus event rehydrates.
  4. On `wp-desktop-bridge-ready` (handshake posted by the iframe once its listener is attached), re-send subscribe if the iframe matches the currently focused window. Fixes the race where the parent sends subscribe before the iframe script has run.

Each harvested command is tagged `eager: true` so it surfaces in the palette without requiring the user to type `/`. The palette renders eager commands on empty input; typing `/` switches to the slash-only surface (disjoint from eager — see [JavaScript Reference](./javascript-reference.md#commands)).

**Caveats.** Gutenberg block-level loader hooks are tightly coupled to current editor state; invoking a stale closure after the editor re-renders can no-op. The harvester re-runs on every React re-render, so in practice the cache is fresh, but don't expect the bridge to work if the iframe page hasn't booted its editor yet. Non-Gutenberg admin screens generally expose no contextual commands, so the palette falls back to its AI suggestions view when the focused window's registry is empty.

## CSS layering

```
assets/css/
├── variables.css    — Custom properties, color-scheme aware.
├── desktop.css      — Shell layout; hides classic chrome via body.wp-desktop-active.
├── windows.css      — Window chrome, animations, states.
├── dock.css         — Left-edge dock.
└── chromeless.css   — Loaded INSIDE iframes; scoped to body.wp-desktop-chromeless.
```

Never edit Core's `common.css` or color scheme files. Everything we need is exposed as a CSS Custom Property in `variables.css`.

## What's shipped vs. what comes next

**Shipped** — taskbar (0.5), multi-window orchestration + session restore, virtual desktops / Spaces (0.6), wallpaper registry (0.6), widget registry (0.7), overview + arrange + snap (0.8–0.9), native windows and tabs (0.10–0.11), AI assistant + slash commands + palette registry (0.13–0.14), cross-frame drag bridge for Media Library (0.14), OS Settings native window, accent + custom-gradient editor, toast notifications, iframe observability (`iframe-ready` / `iframe-error` / `iframe-network-completed`), letter-badge icon fallback, batch `closeAll()` with protection filter, primary-desktop filter, iframe command-palette bridge (0.16 — harvests `@wordpress/commands` from the focused window into the shell palette; see "Command palette bridge" above).

**Coming up**

- **Polish** — color-scheme-aware variables across every shell surface, View Transitions API animations, full accessibility audit (ARIA, focus traps, keyboard navigation).
- **Mobile (phone OS)** — `responsive.ts` + `mobile.ts`: home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar. `wp.desktop.mode` returns `'desktop' | 'tablet' | 'mobile'`.
- **Tablet hybrid** — split view, slide-over overlay, horizontal bottom dock, optional desktop-mode toggle for large tablets.
- **The North Star — cross-window drag & drop** — extend the existing cross-frame drag bridge beyond Media Library attachments: pluggable mime-type negotiation (`wp_desktop_drag_mime_types` / `wp_desktop_drag_payload` / `wp_desktop_drop_accepts`), Gutenberg block-insertion target, visual lift-and-drop feedback.

See [Hooks Reference](./hooks-reference.md) for the filter/action names each phase will introduce.
