# WP OpenStation — Developer Documentation

This folder is the contract between WP OpenStation and the plugins that extend it.

If you are **building a plugin** that interacts with the desktop shell — opens windows, adds dock items, listens to window events, drops icons on the wallpaper — start here.

## Index

1. **[Getting Started](./getting-started.md)** — your first hook, in five minutes.
2. **[Event-Driven Framework](./event-driven-framework.md)** — *Stable.* The mental model: framework as transport, apps own UX policy. Read once before building anything non-trivial.
3. **[Agents Security Model](./agents-security.md)** — *Experimental.* The trust model for the one part of the framework that acts with capability: why agents can never authenticate, why a run is ceilinged at the invoker's capabilities, why tool output is untrusted input, and why granting an agent a role is granting capability. **Read before registering an ability agents can call or adding a trigger intake.**
4. **[Architecture](./architecture.md)** — what renders where, and why.
4. **[Hooks Reference](./hooks-reference.md)** — every PHP action and filter, with signatures, defaults, and minimal examples.
5. **[JavaScript Reference](./javascript-reference.md)** — CustomEvents on `document`, the `window.wp.os` API, and the iframe `postMessage` bridge.
6. **[API Index](./api-index.md)** — single-page table of every `wp.os.*` method, CustomEvent, and `postMessage` type with its current status. Use this when you need to grep the surface, then jump to the per-API reference for details.
7. **[Examples](./examples/README.md)** — recipes you can copy into a plugin.
8. **[Bridge Protocol Overview](./bridge-protocol.md)** — *internals doc.* End-to-end wiring of `wp.os.connect()` / `wp.os.iframe.*` / the synthesised iframe inside native windows. Read when debugging a stuck handshake or building unusual integrations.
9. **[Native Windows & Framework Interop](./native-windows-proposal.md)** — *Stable.* Public API for `open_station_register_window()` / `open_station_register_window_tab()`, Web Components as first-class, and how React / Vue / Svelte plug in without the shell taking a framework dependency. See also [examples/native-windows.md](./examples/native-windows.md) and [examples/native-window-with-tabs.md](./examples/native-window-with-tabs.md).
10. **[Dock Customization](./dock-customization.md)** — *Stable.* Three orthogonal registries — decoration hooks, submenu renderer, dock rail renderer — that let a plugin author go from "tweak a className" to "replace the entire rail with a circular ring." Start here if you want to customize the dock visual.
11. **[Plugin Compatibility Layer](./plugin-compat-layer.md)** — *internals doc.* How OpenStation adapts third-party plugins (WooCommerce, Yoast, etc.) whose CSS or menu-registration assumes classic admin chrome. The three-tier mental model — CSS variables → runtime offset scanner → targeted overrides — and the decision tree for adding a new fix. Read before touching `chromeless.css` or the dock builder for plugin-specific work.
12. **[Files on the Desktop](./files-on-desktop.md)** — *Experimental.* `Open_Station_File` base class, `open_station_register_file_type()`, and `wp.os.files.*`. Phase-0 registry only today; folders, opener associations, sharing, and drag-from-Recycle-Bin land in subsequent phases.
13. **[Desktop Themes](./desktop-themes.md)** — *Experimental.* Whole-OS reskins uploaded as a ZIP of `theme.json` plus images and fonts: every design token, the typeface, a texture on any of 22 surfaces (chrome, dock, desk, menus, dialogs, tables, buttons) plus a documented way to add your own, and a complete iconset down to the window control glyphs. No author CSS or JS ever executes — PHP validates the manifest and compiles the stylesheet, `@font-face` rules included. Read before authoring a theme, or before touching the texture and typography tokens in `variables.css`. See also [examples/register-desktop-theme.md](./examples/register-desktop-theme.md).
13. **[Folder Sharing](./folder-sharing.md)** — *Experimental.* Per-principal read / write grants on desktop folders with first-sight opt-in, polymorphic `target_type` schema, If-Match conflict detection, and a `<os-modal>`-based Share Settings UI.
13. **[Mio](./mio.md)** — *Experimental.* The desk companion: a PixiJS soft-body blob with a chroma neon outline that floats over the wallpaper, feels the gravity of nearby windows and settles onto them, watches your cursor (including across window iframes), and can be dragged anywhere. Covers the simulation, the two soft-body failure modes worth knowing before touching it, the `open_station_mio_config` filter, and `wp.os.mio`.
13. **[Progressive Web App (PWA)](./pwa.md)** — *Stable.* Web app manifest, service worker (root-scope, narrow fetch handler), install affordance, and `wp.os.notify()` for local notifications. Phase-4 Web Push wiring lands later without breaking the v1 call surface.
14. **[Migration 0.7 → 0.8.1](./migration-0.7-to-0.8.1.md)** — what landed in the architecture-0.8.1 refactor: the `@core` / `@api` / `@protocol` / `@layout` / `@ui` path aliases, the registry / server-sync / api-client primitives, the public-API facade home, and the PHP slicing of `helpers.php` / `components.php` / `render.php`. Read once before adopting any of the new modules in your plugin.
15. **[Migration — AI comment-only + native search (0.11.0)](./migration-ai-comment-only.md)** — the AI Copilot is scoped to comment spam scoring; post/term auto-analysis and its hooks are removed, the assistant now finds content with native keyword search, and the bulk `/ai/reindex` endpoint is gone. Read if you depended on any `open_station_ai_*post*` / `*term*` hook or the reindex route.
16. **[Register a widget — polling, storage, canvas charts](./register-widget.md)**
17. **[The Living Tree — algorithm definition](./living-tree-algorithm.md)** — *Experimental.* The full normative spec for the `wp-living-tree` canvas wallpaper: WordPress emits hormones, the biology (Space Colonization) decides geometry inside age-bounded morphological constraints. Read before touching any part of the wallpaper.

## Conventions used in this docs folder

- **Status labels** — every hook, event, or API surface carries one of:
  - **Stable** — shipping today, backwards-compatible inside the current major version.
  - **Experimental** — shipping but signature may change.
  - **Planned** — reserved name, not yet fired. Do not rely on it.
- **Code examples** are complete, drop-in, and use `my_plugin_` / `my-plugin` prefixes as they would in a real plugin.
- **PHP examples** assume a plugin file with `defined( 'ABSPATH' ) || exit;` at the top.
- **No version tags** — these docs describe what the current release does, not when a given surface was added. Breaking changes get a `migration-*.md` note instead of inline version annotations.

## Reporting breakage

If a documented hook behaves differently than what's written here, that is a bug in either the code or the docs. Open an issue or PR. Do not work around it silently — the docs are source of truth for plugin authors.
