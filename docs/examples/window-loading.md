# Window loading state — spinner overlay & ready signal

Every desktop window starts in a **loading** state. The shell paints a `<os-spinner>` overlay over the body and fades the content in when the window reports ready. The affordance is automatic for the common cases — your only job is to tell the framework when an *async* native render is done, or to re-arm the spinner before a refetch.

> Status: **Stable**.

## Why this exists

In production, iframe windows take a non-trivial amount of time to boot (PHP load, plugin filters, asset enqueue). Without an overlay, users see an empty white box for hundreds of milliseconds and assume the window is broken. The spinner gives them the same affordance they see everywhere else in the admin — *something is happening*.

The overlay is sized responsively (`clamp(96px, 14vw, 192px)`) so it scales with the window's width. A small popover gets a small spinner; a maximized 1600px window gets a big one.

## Iframe windows — automatic

Iframe windows mark themselves ready when the chromeless bridge posts `os-ready`. **You don't write any code.** Just open the window:

```js
wp.os.openWindow( 'edit-post' );
```

The spinner shows during iframe boot; once the bridge announces ready, the spinner fades out and the iframe content fades in.

## Native windows — synchronous render

Synchronous renders mark themselves ready on the next animation frame. Again, no code:

```js
wp.os.registerWindow( {
    id: 'my-plugin/quick-note',
    title: 'Quick Note',
    icon: 'dashicons-edit',
    render: ( body ) => {
        body.innerHTML = `<os-text-field label="Note"></os-text-field>`;
    },
} );
```

The spinner barely flashes for a synchronous render — the CSS transition has a 120ms entry delay, so loads that finish under that threshold never paint the spinner.

## Native windows — async render (Promise)

Return a `Promise` from `render` and the framework holds the spinner until it resolves:

```js
wp.os.registerWindow( {
    id: 'my-plugin/inbox',
    title: 'Inbox',
    icon: 'dashicons-email',
    render: async ( body ) => {
        const messages = await fetch( '/wp-json/myapi/v1/messages' )
            .then( ( r ) => r.json() );
        body.innerHTML = renderInbox( messages );

        // Optional teardown — return a function (or `() => …` from
        // the resolved value of the Promise) and the shell calls it
        // on close. Same contract as the synchronous return.
        return () => clearInterval( pollTimer );
    },
} );
```

The spinner stays up while `fetch` is in flight. When the Promise resolves, the spinner fades out and the table fades in.

## Native windows — refetch (manual `markLoading` / `markReady`)

Use `ctx.window.markLoading()` to re-show the spinner before an in-window refetch, and `ctx.window.markReady()` after the new data renders:

```js
wp.os.registerWindow( {
    id: 'my-plugin/dashboard',
    title: 'Dashboard',
    icon: 'dashicons-chart-bar',
    render: async ( body, ctx ) => {
        const refresh = async () => {
            ctx.window.markLoading();          // re-show spinner
            const data = await fetch( '/api/dashboard' ).then( ( r ) => r.json() );
            body.innerHTML = renderDashboard( data, refresh );
            ctx.window.markReady();            // hide spinner, fade in
        };

        await refresh();   // initial load — first paint
        // Returning here triggers the framework's auto-mark-ready
        // (next rAF), which is idempotent here since we already
        // marked ready inside `refresh()`. No-op.
    },
} );
```

The same shape works from outside the render — `wp.os.windowManager.getById( id ).markContentLoading()` / `.markContentLoaded()` give you the equivalent escape hatch.

## React to the loading lifecycle from another plugin

Both edges fire **CustomEvents** on `document` and **`wp.hooks` actions**. Subscribe to whichever shape is more idiomatic for your plugin:

```js
// CustomEvent — short-and-sweet for one-off subscribers.
document.addEventListener( 'os-window-content-loaded', ( e ) => {
    if ( e.detail.windowId !== 'my-plugin/inbox' ) return;
    analytics.complete( 'inbox-load' );
} );

// wp.hooks action — supports priorities + namespaced unsubscribe.
wp.os.hooks.addAction(
    'os.window.content-loaded',
    'my-plugin/track-load',
    ( { windowId } ) => {
        if ( windowId === 'my-plugin/inbox' ) {
            analytics.complete( 'inbox-load' );
        }
    },
);
```

Both `os-window-content-loading` and `os-window-content-loaded` are **edge-triggered**: idempotent calls don't re-fire. A loading → ready → loading → ready cycle fires `loaded` exactly twice.

## Customizing the overlay — ship your own loader

Two extension points, one for per-window overrides, one for shell-wide skinning. Both run on every paint (initial + every `markContentLoading()` re-arm), so a refetch shows the same custom loader the first paint did.

### Per-window — `config.loading.render`

Best for a single plugin window that wants its own affordance. Mutates the default overlay (the `<os-spinner>` is already inside `host`) — append, replace, retune, whatever.

```js
wp.os.registerWindow( {
    id: 'my-plugin/inbox',
    title: 'Inbox',
    icon: 'dashicons-email',
    loading: {
        render: ( host, ctx ) => {
            // Append a status line under the default spinner.
            const status = document.createElement( 'p' );
            status.textContent = 'Connecting to your inbox…';
            status.style.cssText = 'margin-top:1em;font-size:14px;opacity:.7;';
            host.appendChild( status );
        },
    },
    render: async ( body ) => {
        const messages = await fetchInbox();
        body.innerHTML = renderInbox( messages );
    },
} );
```

Want to **replace** the default spinner entirely with your brand mark? Use `replaceChildren`:

```js
loading: {
    render: ( host ) => {
        const logo = document.createElement( 'img' );
        logo.src = '/wp-content/plugins/my-plugin/assets/loader.svg';
        logo.alt = '';
        logo.style.cssText = 'width:96px;height:96px;animation:spin 1.2s linear infinite;';
        host.replaceChildren( logo );
    },
},
```

`host` is the `.os-window__loading` div — already absolutely positioned + centered in the body. Just put your content inside.

### Shell-wide — `WINDOW_LOADING_OVERLAY` filter

Best for a theme/skin plugin that wants to override every window's loader at once. Filter receives the overlay (post-per-window-render) and can mutate it or return a replacement.

```js
wp.os.whenReady( () => {
    wp.os.hooks.addFilter(
        'os.window.loading-overlay',
        'my-skin/branded-loader',
        ( host, ctx ) => {
            // Retune the default spinner to a different preset/color.
            const spinner = host.querySelector( 'os-spinner' );
            if ( spinner ) {
                spinner.setAttribute( 'preset', 'comet' );
                spinner.setAttribute( 'color', '#6f42c1' );
            }
            host.style.background = 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)';
            return host;
        },
    );
} );
```

Filters can also **fully replace** the overlay element. The shell defensively re-adds the `.os-window__loading` class so positioning + transition rules still apply:

```js
wp.os.hooks.addFilter(
    'os.window.loading-overlay',
    'my-skin/wholesale-replacement',
    ( host, ctx ) => {
        const replacement = document.createElement( 'div' );
        replacement.appendChild( buildBrandedLoader() );
        // The shell re-adds `os-window__loading` for you.
        return replacement;
    },
);
```

### Resolution order

For each overlay paint (first paint AND every re-arm via `markContentLoading()`):

1. **Default** — the shell paints `<os-spinner preset="classic" size="clamp(96px, 14vw, 192px)">` inside a positioned div.
2. **Per-window inline** — `config.loading.render( host, ctx )` runs if defined.
3. **Global filter** — `WINDOW_LOADING_OVERLAY` filter runs.
4. **Painted** — final element is appended to the window body.

Both customization paths can choose between **mutation** (return / leave the input alone) or **replacement** (return a different `HTMLElement`). The shell takes the filter's return when it's an `HTMLElement`, otherwise keeps the input.

Plugin failures in either step are caught and logged so a buggy customizer can't strand the user with a broken window — the shell falls back to the last good overlay.

### Boot order (F5 / session restore)

On page reload the shell rebuilds every restored window during startup — **before** plugin scripts' `whenReady( … )` callbacks have run. Naively, that would leave the first paint of restored windows showing the default `<os-spinner>` even when a plugin had registered a `WINDOW_LOADING_OVERLAY` filter inside `whenReady`.

**The shell handles this for you.** After `HOOKS.INIT` fires (and one microtask later, so all `whenReady` callbacks have drained), the shell sweeps every currently-loading window and re-paints its overlay through the customization pipeline. So the canonical plugin shape:

```js
wp.os.whenReady( () => {
    wp.os.hooks.addFilter(
        'os.window.loading-overlay',
        'my-skin/branded',
        ( host ) => { /* … */ },
    );
} );
```

Just works on F5, on first visit, on plugin activation mid-session — without any extra plumbing.

### Late filter registrations

If you need to register the `WINDOW_LOADING_OVERLAY` filter **after** init (a deferred async import, a runtime feature flag flip, a settings change), call `wp.os.repaintLoadingOverlays()` after registering — it sweeps every still-loading window and re-paints them through the pipeline:

```js
async function activateBrandSkin() {
    const { brandRenderer } = await import( './brand-renderer.js' );
    wp.os.hooks.addFilter(
        'os.window.loading-overlay',
        'my-skin/lazy-branded',
        brandRenderer,
    );
    // Catch any windows still loading right now — those that
    // opened before `addFilter` ran.
    wp.os.repaintLoadingOverlays();
}
```

Idempotent and cheap — windows that already finished loading are unaffected.

## Style the default loader without a callback

If you only want to retune the spinner colors / size, the CSS variables work fine — no JS needed:

```css
/* Window element ids are `wp-window-` + your window id verbatim, so a
   slashed id like `my-plugin/inbox` needs an attribute selector (or an
   escaped `#wp-window-my-plugin\/inbox`). */
[id='wp-window-my-plugin/inbox'] .os-window__loading os-spinner {
    --os-ui-spinner-color: #6f42c1;
    --os-ui-spinner-accent: #fff8e7;
}
```

The overlay has `pointer-events: none` so it never blocks clicks even if it lingers a frame longer than expected.

## See also

- [`os-window-content-loading` / `os-window-content-loaded` CustomEvents](../javascript-reference.md#os-window-content-loading--stable)
- [`Window.markContentLoading()` / `Window.markContentLoaded()`](../javascript-reference.md#windowmarkcontentloading--windowmarkcontentloaded--stable)
- [`<os-spinner>` component](./spinner.md)
- [`HOOKS.WINDOW_CONTENT_LOADING` / `WINDOW_CONTENT_LOADED`](../javascript-reference.md#4-hooks--openstation)
