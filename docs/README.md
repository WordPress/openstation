# WP Desktop Mode — Developer Documentation

This folder is the contract between WP Desktop Mode and the plugins that extend it.

If you are **building a plugin** that interacts with the desktop shell — opens windows, adds dock items, listens to window events, drops icons on the wallpaper — start here.

## Index

1. **[Getting Started](./getting-started.md)** — your first hook, in five minutes.
2. **[Event-Driven Framework](./event-driven-framework.md)** — *Stable (since 0.5.5).* The mental model: framework as transport, apps own UX policy. Read once before building anything non-trivial.
3. **[Architecture](./architecture.md)** — what renders where, and why.
4. **[Hooks Reference](./hooks-reference.md)** — every PHP action and filter, with signatures, defaults, and minimal examples.
5. **[JavaScript Reference](./javascript-reference.md)** — CustomEvents on `document`, the `window.wp.desktop` API, and the iframe `postMessage` bridge.
6. **[API Index](./api-index.md)** — single-page table of every `wp.desktop.*` method, CustomEvent, and `postMessage` type with its current status. Use this when you need to grep the surface, then jump to the per-API reference for details.
7. **[Examples](./examples/README.md)** — recipes you can copy into a plugin.
8. **[Bridge Protocol Overview](./bridge-protocol.md)** — *internals doc.* End-to-end wiring of `wp.desktop.connect()` / `wp.desktop.iframe.*` / the synthesised iframe inside native windows. Read when debugging a stuck handshake or building unusual integrations.
9. **[Native Windows & Framework Interop](./native-windows-proposal.md)** — *Stable (shipped 0.11.0).* Public API for `desktop_mode_register_window()` / `desktop_mode_register_window_tab()`, Web Components as first-class, and how React / Vue / Svelte plug in without the shell taking a framework dependency. See also [examples/native-windows.md](./examples/native-windows.md) and [examples/native-window-with-tabs.md](./examples/native-window-with-tabs.md).
10. **[Dock Customization](./dock-customization.md)** — *Stable (since 0.18.0).* Three orthogonal registries — decoration hooks, submenu renderer, dock rail renderer — that let a plugin author go from "tweak a className" to "replace the entire rail with a circular ring." Start here if you want to customize the dock visual.
11. **[Plugin Compatibility Layer](./plugin-compat-layer.md)** — *internals doc.* How Desktop Mode adapts third-party plugins (WooCommerce, Yoast, etc.) whose CSS or menu-registration assumes classic admin chrome. The three-tier mental model — CSS variables → runtime offset scanner → targeted overrides — and the decision tree for adding a new fix. Read before touching `chromeless.css` or the dock builder for plugin-specific work.
12. **[Files on the Desktop](./files-on-desktop.md)** — *Experimental (since 0.9.0).* `Desktop_Mode_File` base class, `desktop_mode_register_file_type()`, and `wp.desktop.files.*`. Phase-0 registry only today; folders, opener associations, sharing, and drag-from-Recycle-Bin land in subsequent phases.
13. **[Folder Sharing](./folder-sharing.md)** — *Experimental (since 0.18.0).* Per-principal read / write grants on desktop folders with first-sight opt-in, polymorphic `target_type` schema, If-Match conflict detection, and a `<wpd-modal>`-based Share Settings UI.
13. **[Progressive Web App (PWA)](./pwa.md)** — *Stable (since 0.8.0).* Web app manifest, service worker (root-scope, narrow fetch handler), install affordance, and `wp.desktop.notify()` for local notifications. Phase-4 Web Push wiring lands later without breaking the v1 call surface.
14. **[Migration 0.7 → 0.8.1](./migration-0.7-to-0.8.1.md)** — what landed in the architecture-0.8.1 refactor: the `@core` / `@api` / `@protocol` / `@layout` / `@ui` path aliases, the registry / server-sync / api-client primitives, the public-API facade home, and the PHP slicing of `helpers.php` / `components.php` / `render.php`. Read once before adopting any of the new modules in your plugin.
15. **[Migration — AI comment-only + native search (0.11.0)](./migration-ai-comment-only.md)** — the AI Copilot is scoped to comment spam scoring; post/term auto-analysis and its hooks are removed, the assistant now finds content with native keyword search, and the bulk `/ai/reindex` endpoint is gone. Read if you depended on any `desktop_mode_ai_*post*` / `*term*` hook or the reindex route.
16. **[Register a widget — polling, storage, canvas charts](./register-widget.md)**
17. **[The Living Tree — algorithm definition](./living-tree-algorithm.md)** — *Experimental (since 0.9.4).* The full normative spec for the `wp-living-tree` canvas wallpaper: WordPress emits hormones, the biology (Space Colonization) decides geometry inside age-bounded morphological constraints. Read before touching any part of the wallpaper.

## Conventions used in this docs folder

- **Status labels** — every hook, event, or API surface carries one of:
  - **Stable** — shipping today, backwards-compatible inside the current major version.
  - **Experimental** — shipping but signature may change.
  - **Planned** — reserved name, not yet fired. Do not rely on it.
- **Code examples** are complete, drop-in, and use `my_plugin_` / `my-plugin` prefixes as they would in a real plugin.
- **PHP examples** assume a plugin file with `defined( 'ABSPATH' ) || exit;` at the top.
- **Versions** — features are tagged `@since` with the desktop-mode plugin version that introduced them, not the WordPress version.

## Reporting breakage

If a documented hook behaves differently than what's written here, that is a bug in either the code or the docs. Open an issue or PR. Do not work around it silently — the docs are source of truth for plugin authors.
