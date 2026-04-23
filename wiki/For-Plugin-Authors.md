# For Plugin Authors

WP Desktop Mode is built to be extended. Every significant behavior is hookable — drop an icon on the desktop, add a dock item, gate desktop mode by role, react to window events, register a native window — all from your own plugin with zero patches to the shell.

## Where the contract lives

The plugin-author API contract is versioned alongside the code in [`docs/`](https://github.com/WordPress/desktop-mode/tree/trunk/docs). This wiki page is the "you are here" landing pad; the real reference is one click away.

## Quick links

- **[Getting Started](https://github.com/WordPress/desktop-mode/blob/trunk/docs/getting-started.md)** — your first hook, in five minutes: a plugin skeleton, a dock icon, and a native window.
- **[Architecture](https://github.com/WordPress/desktop-mode/blob/trunk/docs/architecture.md)** — what renders where, and why. The shell, the iframe mode, the registries, the persistence layer.
- **[Hooks Reference](https://github.com/WordPress/desktop-mode/blob/trunk/docs/hooks-reference.md)** — every PHP action and filter the shell fires, with signatures, defaults, and minimal examples.
- **[JavaScript Reference](https://github.com/WordPress/desktop-mode/blob/trunk/docs/javascript-reference.md)** — CustomEvents on `document`, the `window.wp.desktop` API, and the iframe `postMessage` bridge.
- **[Examples](https://github.com/WordPress/desktop-mode/tree/trunk/docs/examples)** — copy-paste recipes for common plugin patterns.
- **[Native Windows & Framework Interop](https://github.com/WordPress/desktop-mode/blob/trunk/docs/native-windows-proposal.md)** — stable public API for `wp_register_desktop_window()` / `wp_register_desktop_window_tab()`, Web Components as first-class citizens, and how React / Vue / Svelte plug in without the shell taking a framework dependency.

## Status labels (so you know what's safe to rely on)

- **Stable** — shipping today, backwards-compatible inside the current major version.
- **Experimental** — shipping but signature may change.
- **Planned** — reserved name, not yet fired. Do not rely on it.

Every hook, event, and API surface in the reference carries one of those labels. If a documented hook behaves differently than what's written, open an issue — the docs are source of truth.

## A small taste

From [`docs/getting-started.md`](https://github.com/WordPress/desktop-mode/blob/trunk/docs/getting-started.md):

```php
add_action( 'wp_desktop_mode_init', function () {
    wp_register_desktop_window( 'my-plugin/stats', [
        'title' => __( 'Stats', 'my-plugin' ),
        'url'   => admin_url( 'admin.php?page=my-plugin-stats' ),
    ] );
} );
```

That's a new dock-ready native window, registered through a public hook, with zero shell patches. Read the five-minute tour for the complete walkthrough.

## Where to file issues and PRs

[github.com/WordPress/desktop-mode/issues](https://github.com/WordPress/desktop-mode/issues). When reporting a hook bug, include the `@since` version from the reference — that's what pins down "is this the contract I was promised?".
