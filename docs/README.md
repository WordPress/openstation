# WP Desktop Mode — Developer Documentation

This folder is the contract between WP Desktop Mode and the plugins that extend it.

If you are **building a plugin** that interacts with the desktop shell — opens windows, adds dock items, listens to window events, drops icons on the wallpaper — start here.

## Index

1. **[Getting Started](./getting-started.md)** — your first hook, in five minutes.
2. **[Event-Driven Framework](./event-driven-framework.md)** — *Stable (since 0.5.5).* The mental model: framework as transport, apps own UX policy. Read once before building anything non-trivial.
3. **[Architecture](./architecture.md)** — what renders where, and why.
4. **[Hooks Reference](./hooks-reference.md)** — every PHP action and filter, with signatures, defaults, and minimal examples.
5. **[JavaScript Reference](./javascript-reference.md)** — CustomEvents on `document`, the `window.wp.desktop` API, and the iframe `postMessage` bridge.
6. **[Examples](./examples/README.md)** — recipes you can copy into a plugin.
7. **[Bridge Protocol Overview](./bridge-protocol.md)** — *internals doc.* End-to-end wiring of `wp.desktop.connect()` / `wp.desktop.iframe.*` / the synthesised iframe inside native windows. Read when debugging a stuck handshake or building unusual integrations.
8. **[Native Windows & Framework Interop](./native-windows-proposal.md)** — *Stable (shipped 0.11.0).* Public API for `desktop_mode_register_window()` / `desktop_mode_register_window_tab()`, Web Components as first-class, and how React / Vue / Svelte plug in without the shell taking a framework dependency. See also [examples/native-windows.md](./examples/native-windows.md) and [examples/native-window-with-tabs.md](./examples/native-window-with-tabs.md).
9. **[Dock Customization](./dock-customization.md)** — *Stable (since 0.18.0).* Three orthogonal registries — decoration hooks, submenu renderer, dock rail renderer — that let a plugin author go from "tweak a className" to "replace the entire rail with a circular ring." Start here if you want to customize the dock visual.
10. **[Plugin Compatibility Layer](./plugin-compat-layer.md)** — *internals doc.* How Desktop Mode adapts third-party plugins (WooCommerce, Yoast, etc.) whose CSS or menu-registration assumes classic admin chrome. The three-tier mental model — CSS variables → runtime offset scanner → targeted overrides — and the decision tree for adding a new fix. Read before touching `chromeless.css` or the dock builder for plugin-specific work.
11. **[Progressive Web App (PWA)](./pwa.md)** — *Stable (since 0.8.0).* Web app manifest, service worker (root-scope, narrow fetch handler), install affordance, and `wp.desktop.notify()` for local notifications. Phase-4 Web Push wiring lands later without breaking the v1 call surface.

## Conventions used in this docs folder

- **Status labels** — every hook, event, or API surface carries one of:
  - **Stable** — shipping today, backwards-compatible inside the current major version.
  - **Experimental** — shipping but signature may change.
  - **Planned** — reserved name, not yet fired. Do not rely on it.
- **Code examples** are complete, drop-in, and use `desktop_mode_` / `desktop_mode_` prefixes as they would in a real plugin.
- **PHP examples** assume a plugin file with `defined( 'ABSPATH' ) || exit;` at the top.
- **Versions** — features are tagged `@since` with the desktop-mode plugin version that introduced them, not the WordPress version.

## Reporting breakage

If a documented hook behaves differently than what's written here, that is a bug in either the code or the docs. Open an issue or PR. Do not work around it silently — the docs are source of truth for plugin authors.
