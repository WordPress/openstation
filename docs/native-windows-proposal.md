# Native Windows & Framework Interop

**Status:** Historical RFC — kept for the design rationale. The API has since shipped — `openstation_register_window()` and `openstation_register_window_tab()` are the public PHP API; `wp.os.registerWindow()` is the JS counterpart — but the shipped argument surface differs from this proposal: a required `template` callback plus singular `script` / `style` handles replaced the `custom_element` / `render` / `module` authoring paths and the `scripts` / `styles` arrays; a `capabilities` array replaced `capability`; `placement` (`'dock'` / `'none'`) replaced `show_in_dock`; and the size defaults are 520×400 with a 280×220 minimum, not 420×320 / 320×200. The shipped docs are authoritative: see [`examples/native-windows.md`](./examples/native-windows.md) and [`examples/native-window-with-tabs.md`](./examples/native-window-with-tabs.md) for working recipes.

This document describes the public contract for **native desktop windows** — windows whose content renders directly in the parent DOM instead of through an iframe — and the story for how plugins written with React, Vue, Svelte, Lit, or plain custom elements plug in without the shell taking a framework dependency.

The goal is to make one decision up front: **the shell's extension contract is the DOM, not a framework.** Every authoring style (render callback, Web Component, React mount, Vue app) reduces to "you are handed a DOM node, you own it." That keeps the shell's core small, portable, and future-proof, and lets plugin authors pick whatever tool they already know.

## Goals

- A single PHP registration API for native windows: `openstation_register_window()`.
- A single JS registration API for runtime-defined windows: `wp.os.registerWindow()`.
- Web Components as a **first-class authoring path**, on equal footing with a render callback. No framework gets special treatment.
- Zero bundled UI framework in the shell. A plugin that wants React pays React's cost; a plugin that ships a custom element pays nothing extra.
- A clean lifecycle contract: `mount → visible → hidden → unmount`, driven by the existing window manager.

## Non-goals

- Migrating the shell itself (drag, resize, z-order, dock, pointer capture) to Web Components or any framework. The shell is imperative by nature; a reconciler or shadow-DOM lifecycle would add overhead and actively fight the global CSS-variable theming the OS Settings panel depends on.
- Bundling React, Vue, or Lit. WordPress Core already ships React; plugins that want it already use it. Anything else the plugin brings itself.
- Replacing iframe windows. Every existing admin page continues to render through the iframe path — native windows are additive, not a migration.

## The API

### PHP: `openstation_register_window()`

> **As shipped, the signature differs** — see the status note at the top and [`examples/native-windows.md`](./examples/native-windows.md) for the real argument list. The proposal-era shape:

```php
openstation_register_window( 'jorvy', array(
    // Required. Human-readable label for the title bar, dock tooltip, a11y.
    'title'          => __( 'Jorvy', 'jorvy' ),

    // Required. Dashicons class, data-URI, or image URL — same rules as
    // `openstation_sanitize_dock_icon()` uses for menu-item icons today.
    'icon'           => 'dashicons-star-filled',

    // Pick exactly one of the three authoring paths below.

    // (a) Custom element — shell does: container.appendChild(
    //     document.createElement( 'jorvy-panel' ) ). Plugin ships the
    //     element definition and a script that calls
    //     customElements.define( 'jorvy-panel', ... ).
    'custom_element' => 'jorvy-panel',

    // (b) JS render callback — resolved from `window.<path>` at open time.
    //     Plugin script attaches its render function there.
    'render'         => 'jorvy.renderQuotePanel',

    // (c) Module URL — shell dynamically imports the module and calls its
    //     default export with the container. For plugins that want ESM
    //     without touching global scope.
    'module'         => plugins_url( 'js/jorvy-panel.js', __FILE__ ),

    // Optional. Scripts the shell enqueues before opening. Same contract
    // as wp_enqueue_script handles — the plugin registers them on
    // `admin_enqueue_scripts` as usual.
    'scripts'        => array( 'jorvy-panel' ),

    // Optional. Stylesheets enqueued before open. Scoped by the plugin;
    // the shell does not sandbox them. Use a namespace on your selectors.
    'styles'         => array( 'jorvy-panel' ),

    // Optional window defaults. Overridable per-open via the JS API.
    // `width` / `height` are the size used the very first time a
    // user opens this window. From then on, the shell remembers
    // the last size, position, AND maximize state the user left
    // the window in (per baseId, in localStorage under
    // `os-native-window-geometry`) and replays them on
    // the next fresh open. The same persistence covers classic
    // iframe-backed windows opened from a dock click or desktop
    // icon. Size is clamped to `min_width` / `min_height` so
    // raising the minimum in a plugin update never reopens at the
    // older smaller size. Position is clamped to the current
    // desktop area so a window remembered at x=2800 on a 3440px
    // display doesn't open off-screen on a laptop. Snap-zone tiles
    // are not persisted; only geometry the user picks while the
    // window is in the normal floating state. Width / height /
    // position ALWAYS represent the floating values, even when
    // state=maximized; they are what un-maximize restores to.
    // Duplicate instances opened via `openNewWindow` or the "+"
    // dock-peek affordance always cascade off the primary's
    // remembered position into a fresh floating slot.
    'width'          => 420,
    'height'         => 320,
    'min_width'      => 320,
    'min_height'     => 200,

    // Optional capability gate. Defaults to 'read'.
    'capability'     => 'read',

    // Optional. When true, adds a dock icon automatically. When false,
    // the window is only reachable via wp.os.openWindow() — for
    // plugins that prefer to surface it from a button on another page.
    'show_in_dock'   => true,
) );
```

Behind the scenes this populates a registry exposed to the shell via `openstation_shell_config` → `nativeWindows`. There is no registry-level filter; the shipped extension points are the `openstation_native_window_registered` action (fires after every successful registration) and the `openstation_native_window_allowed_html` filter (the kses allowlist used to escape `<template>` payloads).

#### Shipping config to the bundle

Use the `'config'` arg for any session-bound data the bundle needs — REST URLs, nonces, capability flags:

```php
openstation_register_window( 'my/window', array(
    /* … */
    'script' => 'my-script-handle',
    'config' => array(
        'restNonce' => wp_create_nonce( 'wp_rest' ),
        'eventsUrl' => esc_url_raw( rest_url( 'my/v1/events' ) ),
    ),
) );
```

Read it from JS:

```js
const cfg = wp.os.getWindowConfig( 'my/window' );
```

Why this matters: native-window scripts may be loaded **eagerly** (via `wp_enqueue_script` at boot) or **lazily** (the shell appends a `<script>` after a payload-refresh, e.g. mid-session plugin activation). The lazy path bypasses `wp_print_scripts()` entirely. Without the `'config'` arg's delivery path, any data attached via `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations` would be silently dropped on the lazy path.

The shell harvests that `extra` data into the payload and re-injects it inline alongside the lazy `<script>` tag, so existing `wp_localize_script` callers continue to work — but the `'config'` arg is the discoverable, supported way and is recommended for new windows. See [`examples/window-with-config.md`](./examples/window-with-config.md).

For diagnostics, `wp.os.debug.window( id )` (read-only) reports the load path, whether the tag is in the DOM, and whether the config global landed.

### JS: `wp.os.registerWindow()`

For windows whose definition is easier to express in JS than in PHP (or for shell-internal modules like OS Settings):

```js
// Shipped shape: a single def object (including `id`); returns a
// Promise that resolves to the opened DesktopWindow — registering
// also opens the window. There is no `customElement` option:
// create and append your element inside `render()` instead.
wp.os.registerWindow( {
    id:     'jorvy',
    title:  'Jorvy',
    icon:   'dashicons-star-filled',
    width:  420,
    height: 320,
    render: ( body ) => {
        body.appendChild( document.createElement( 'jorvy-panel' ) );
    },
} );
```

The PHP and JS registries merge at shell boot — JS wins on conflict, so a plugin that needs to override a PHP registration from its own script can do so without juggling hook priorities.

## Three authoring paths, one contract

> **As shipped, only one path exists** — closest to Path B: a PHP `template` callback (cloned into the window body) plus an optional JS render callback the plugin's `script` registers at `window.openStationNativeWindows[ <id> ]`. The `custom_element` and `module` args below were never shipped; a plugin can still use a custom element or a dynamic `import()` *inside* its render callback.
>
> The shell also consults the legacy `window.openStationNativeWindows` bag for backwards compatibility — it merges both at read time, with the canonical `openStationNativeWindows` winning on id collisions. New code registers on `openStationNativeWindows`.

Each path reduces to: *the shell gives you an empty HTML element, you fill it, you get lifecycle callbacks.*

### Path A — Web Component (recommended default)

```js
class JorvyPanel extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `<p class="quote">Loading…</p>`;
        this._timer = setInterval( () => this.rotate(), 10_000 );
    }
    disconnectedCallback() {
        clearInterval( this._timer );
    }
    rotate() { /* swap the quote */ }
}
customElements.define( 'jorvy-panel', JorvyPanel );
```

The shell does:

```js
const el = document.createElement( config.customElement );
container.appendChild( el );
// Window close → container.removeChild → disconnectedCallback fires.
```

Why this is the recommended default:

- No framework contract to version. Matches the platform.
- Built-in lifecycle: `connectedCallback` / `disconnectedCallback` map cleanly to open/close.
- Any framework **outputs** to this path — React via `createRoot()` inside `connectedCallback`, Vue via `createApp().mount()`, Svelte via `new Component({ target: this })`. The shell doesn't know or care.
- Works with or without shadow DOM. Our recommendation: **don't use shadow DOM by default** — shell theming flows through CSS Custom Properties and you want to inherit them. Opt in only if you need strict isolation.

### Path B — Render callback

For plugins that don't want to define a custom element and just need a DOM node:

```js
window.jorvy = window.jorvy || {};
window.jorvy.renderQuotePanel = function ( container, ctx ) {
    container.innerHTML = '<p class="quote">Loading…</p>';

    const timer = setInterval( rotate, 10_000 );

    // Return a teardown function — called on window close.
    return () => clearInterval( timer );
};
```

Signature: `( container: HTMLElement, ctx: WindowContext ) => void | ( () => void )`.

### Path C — Dynamic module import

```js
// jorvy-panel.js
export default function mount( container, ctx ) {
    const root = ReactDOM.createRoot( container );
    root.render( <QuotePanel ctx={ ctx } /> );
    return () => root.unmount();
}
```

The shell does `const { default: mount } = await import( config.module ); mount( el, ctx );`. This is the right fit for plugins that want ESM, code splitting, or React-style ergonomics without polluting globals.

## Lifecycle contract

Every native window sees the same shipped lifecycle surface, delivered through the render callback's second argument (`NativeRenderContext`) and document-level CustomEvents:

| Event | When | Shipped surface |
|---|---|---|
| **mount** | Window opens. | The render callback is invoked after the registered template is cloned into the body. |
| **focus** | Window gains focus. | `os-window-focused` CustomEvent on `document` (hook: `os.window.focused`). |
| **blur** | Loses focus. | `os-window-blurred` CustomEvent on `document` (hook: `os.window.blurred`). |
| **resize** | Geometry changes. | `ctx.onResize( ( width, height ) => { … } )`. |
| **hidden** | Window minimized. | `ctx.onHide( fn )`. |
| **visible** | Window restored. | `ctx.onShow( fn )`. |
| **unmount** | Window closed. | `ctx.signal` (an `AbortSignal`) aborts, then the teardown function returned from render is called. |

The `ctx` object also exposes the window-scoped channel pair (`ctx.window.send` / `ctx.window.on`) and the loading-overlay controls (`ctx.markLoading()` / `ctx.markReady()`). To rename a window after data loads, use the window handle: `wp.os.windowManager.getById( id ).setTitle( title )`. See [`examples/render-ctx.md`](./examples/render-ctx.md) for the full contract.

## Security & sandboxing

- **Same origin, same realm.** Native window code executes in the parent shell's JS realm — there is no iframe boundary. This is the point: direct DOM access, shared state, cross-window coordination. But it means a misbehaving plugin can reach the rest of the shell. Treat this like any other `wp_enqueue_script` — it's a plugin author surface, not an end-user one.
- **Capability checks stay server-side.** `openstation_register_window()` enforces the `capabilities` array (every listed capability must match — fail closed) before storing the registration. A user without the caps never sees the icon and cannot open the window via `wp.os.openWindow()`.
- **No eval, no Function constructors.** The shipped render callback is a function the plugin's own script registers at `window.openStationNativeWindows[ <id> ]` — the shell looks it up by id and invokes it; no strings are ever evaluated as code. (The legacy `window.openStationNativeWindows` bag is also consulted for backwards compatibility — the shell merges both at read time, canonical wins on id collisions.) Template HTML is escaped through the `openstation_native_window_allowed_html` kses allowlist before it is emitted.
- **Nonces for server interaction** are the plugin's responsibility; the shell doesn't wrap fetch calls.

## Why not just…

**…migrate the shell itself to Web Components?** The shell does imperative work — pointer capture, z-order math, drag coordination, focus trapping — that doesn't benefit from a reactive lifecycle. Shadow DOM would also break the CSS-variable theming (OS Settings flips `--wp-admin-theme-color` on `#os-shell` and every descendant inherits it; shadow roots don't inherit that without explicit opt-in per element). Staying vanilla is a feature, not debt.

**…ship a React-first API?** React is already available everywhere in WP, so plugins that want React can use it — inside a Web Component, inside a render callback, inside a dynamic module. Making the shell itself React-first would force every non-React plugin to ship a reconciler they don't need. The DOM is the common denominator; standardize on it.

**…use shadow DOM by default?** It would isolate a plugin's CSS — but at the cost of losing access to shell Custom Properties (wallpaper, accent, dock size) unless every plugin manually pierces it. For OS-level consistency, light DOM is the better default. Plugins that need isolation can opt in.

**…let the render callback return JSX / a Vue vnode / a Svelte component?** That's a framework opinion baked into the core contract. Keep the shell's surface strictly DOM; the plugin does the framework glue. Two lines in the plugin, zero lines in the shell.

## Worked example: Jorvy as a Web Component

> Proposal-era recipe — the `custom_element` / `scripts` args did not ship. For the working equivalent (PHP `template` callback + singular `script` handle + JS render callback), see [`examples/register-icon.md`](./examples/register-icon.md).

```php
// jorvy.php
add_action( 'init', function () {
    wp_register_script(
        'jorvy-panel',
        plugins_url( 'jorvy-panel.js', __FILE__ ),
        array(),
        '1.0.0',
        true
    );

    openstation_register_window( 'jorvy', array(
        'title'          => 'Jorvy',
        'icon'           => 'dashicons-star-filled',
        'custom_element' => 'jorvy-panel',
        'scripts'        => array( 'jorvy-panel' ),
        'width'          => 380,
        'height'         => 220,
    ) );
} );
```

```js
// jorvy-panel.js
const QUOTES = [
    { quote: 'I am Iron Man.', who: 'Tony Stark · Iron Man' },
    // …
];

class JorvyPanel extends HTMLElement {
    connectedCallback() {
        this.classList.add( 'jorvy' );
        this.render();
        this._timer = setInterval( () => this.render(), 10_000 );
    }
    disconnectedCallback() {
        clearInterval( this._timer );
    }
    render() {
        const q = QUOTES[ Math.floor( Math.random() * QUOTES.length ) ];
        this.innerHTML = `
            <blockquote class="jorvy__quote">${ q.quote }</blockquote>
            <cite class="jorvy__who">— ${ q.who }</cite>
        `;
    }
}
customElements.define( 'jorvy-panel', JorvyPanel );
```

No build step, no framework, ~30 lines total. This is the bar.

## Worked example: the same panel in React

> Proposal-era recipe — the `module` arg did not ship. The shipped equivalent is a render callback that does the `createRoot()` mount itself (dynamic `import()` inside the callback if you want code splitting).

```js
// Same registration in PHP, but with 'module' instead of 'custom_element':
//     'module' => plugins_url( 'jorvy-panel.js', __FILE__ ),

import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';

function QuotePanel() {
    const [ q, setQ ] = useState( pick() );
    useEffect( () => {
        const t = setInterval( () => setQ( pick() ), 10_000 );
        return () => clearInterval( t );
    }, [] );
    return (
        <>
            <blockquote className="jorvy__quote">{ q.quote }</blockquote>
            <cite className="jorvy__who">— { q.who }</cite>
        </>
    );
}

export default function mount( container ) {
    const root = createRoot( container );
    root.render( <QuotePanel /> );
    return () => root.unmount();
}
```

Same window, same dock icon, same OS Settings theming — different authoring style. The shell never learns the difference.

## Migration plan for what already exists

*(Proposal-era section.)* When this was written, the only native-window content was the **OS Settings** panel (shell-internal, Phase 6); its `render( body )` callback already matched Path B exactly. The API has since landed and is used in-tree by the shipped Posts, Pages, Users, Plugins, Comments, Trash, site folder, Corkboard, and user-edit windows — all registered via `openstation_register_window()`. The original plan for OS Settings:

1. Stay a render callback (it's shell-internal, no reason to register it through the public registry).
2. Gain the same `ctx` lifecycle wiring other plugins get — currently it does nothing on focus / blur / resize; with `ctx` it can, e.g., re-check `matchMedia` on resize if we ever add a "follow system dark mode" toggle.

Nothing else migrates. Iframe windows stay iframe windows — that's the whole point of the iframe path.

## Open questions

1. **Shadow DOM opt-in format.** Do we expose `'shadow_dom' => 'open'` on the PHP side, or is it entirely the plugin's call inside `connectedCallback`? Leaning: plugin's call. The shell shouldn't mediate.
2. **Async mounts.** Should `render` / `module` be allowed to return a Promise, and the shell shows a spinner until it resolves? Leaning: yes, but keep the spinner opt-in via `ctx.setLoading( true )` rather than implicit.
3. **Multi-instance native windows.** The iframe side has `multi: true`; native windows currently don't. Jorvy doesn't need it, but a "Quick Note" native window probably does. Low risk to add the flag now even if no shipping caller uses it.
4. **Persistence.** Native windows are currently skipped from session snapshot because `render` is a closure. With a registry, we can serialize by id and rehydrate — at the cost of requiring every plugin to either be idempotent on re-mount or opt out. Leaning: opt-in per registration (`'persist' => true`, default false).
5. **Dock registration vs. separate `openstation_register_icon()`.** The CLAUDE.md vision has both dock items and wallpaper icons. Should `openstation_register_window()` be orthogonal to `openstation_register_icon()`, or should the window registration produce both when `show_in_dock` / `show_on_desktop` are set? Leaning: orthogonal — windows and icons are different concepts, even if most plugins use them together.

## Next steps

1. Land this proposal in `docs/` as Planned status (this document).
2. Prototype the registry + merge logic in `includes/native-windows.php` and `src/native-windows.ts`.
3. Port **Jorvy** to Path A (Web Component) as the acceptance test.
4. Add a second reference plugin using Path C (dynamic module + React) so both paths have a known-working example.
5. Promote from Planned → Experimental once Jorvy ships; Experimental → Stable after one minor release with no signature changes.
