# Migration — `windowManager.open()` is async in 0.8.4

> **TL;DR.** `wp.os.windowManager.open( cfg )`,
> `wp.os.windowManager.openNew( cfg )`, and
> `wp.os.registerWindow( def )` now return `Promise< Window >`
> instead of `Window`. Add `await` (or `.then(...)`) on every call
> site that uses the returned `Window`. Calls that already discard
> the return value need no change in behavior, but should prefix
> with `void` (or `await`) to silence "floating promise" lints.

---

## Why the change

Before 0.8.4, the `Window` class lived in `desktop.min.js`. It was
the single largest module in the shell — ~68 kB of code that
**never runs at first paint**. Opening OpenStation shows just the
wallpaper, the dock, and the desktop icons; the user typically
hasn't asked for a window yet.

0.8.4 ships the `Window` class (and its DOM / pointer / tab
helpers) in a separate `assets/js/window-system[.min].js`
bundle that `desktop.ts` `<script>`-injects in the background
right after first paint. The window-chrome components themselves
(`<os-window-button>`, `<os-menu>`, `<os-tab-chip>`,
`<os-save-status>`, `<os-spinner>`) live in a sibling
`assets/js/shell-overlays[.min].js` bundle that pre-loads on the
same idle-callback. Both are guaranteed to be ready before
`manager.open()` constructs the first window — `createWindow()`
awaits *both* bundles via `Promise.all( … )` internally — so
plugins never see partially-rendered chrome.

For users who never open a window, the ~30–35 kB minified /
~10 kB gzipped of `window-system.min.js` never downloads, and the
chrome components in `shell-overlays.min.js` only matter to other
surfaces (toasts, context menus) that may not fire either.

Lazy loading means `manager.open()` must wait for the bundle —
hence `Promise< Window >`. The promise resolves immediately in
steady state (factory already registered after the post-paint
preload), but the type system requires `await` regardless.

---

## What changed

### Affected API

| Surface | Pre-0.8.4 | 0.8.4 |
| ------- | --------- | ----- |
| `wp.os.windowManager.open( cfg )` | returns `Window` | returns `Promise< Window >` |
| `wp.os.windowManager.openNew( cfg )` | returns `Window` | returns `Promise< Window >` |
| `wp.os.registerWindow( def )` | returns `Window` | returns `Promise< Window >` |

### Unchanged API

These keep their pre-0.8.4 signatures:

- `wp.os.openWindow( id, opts? )` — still returns `boolean`. Semantics: "did the shell accept the open intent?" The actual window opens asynchronously; this hasn't changed observable behaviour for plugins.
- `wp.os.openNewWindow( id, opts? )` — same.
- `wp.os.windowManager.getById( id )` — still synchronous, still returns `Window | undefined`.
- `wp.os.windowManager.getWindows()` — still synchronous, still returns `Window[]`.
- `wp.os.windowManager.focus( win )` — still synchronous; you already have a `Window` reference.
- Every method on a `Window` instance (`win.focus()`, `win.close()`, `win.minimize()`, etc.) — unchanged.

---

## Migration patterns

### Pattern A — you used the return value

**Before:**

```ts
const win = wp.os.windowManager.open( {
    id: 'my-window',
    url: '/wp-admin/edit.php',
    title: 'Posts',
} );
win.focus();
```

**After:**

```ts
const win = await wp.os.windowManager.open( {
    id: 'my-window',
    url: '/wp-admin/edit.php',
    title: 'Posts',
} );
win.focus();
```

The enclosing function must be `async`. If it can't be (e.g. an
event handler that can't await), use `.then( … )`:

```ts
wp.os.windowManager
    .open( { id, url, title } )
    .then( ( win ) => win.focus() );
```

### Pattern B — you discarded the return value

**Before:**

```ts
wp.os.windowManager.open( { id, url, title } );
```

**After:**

```ts
void wp.os.windowManager.open( { id, url, title } );
```

The runtime behaviour is identical — the window opens
asynchronously, you don't care about the result. The `void`
prefix silences ESLint's "floating promise" rule on stricter
configs. You can also use `await` if your function is already
async.

### Pattern C — you registered a native window

**Before:**

```ts
const win = wp.os.registerWindow( {
    id: 'my-plugin/dashboard',
    title: 'My Dashboard',
    icon: 'dashicons-chart-bar',
    render: ( body ) => mount( body ),
} );
```

**After:**

```ts
const win = await wp.os.registerWindow( {
    id: 'my-plugin/dashboard',
    title: 'My Dashboard',
    icon: 'dashicons-chart-bar',
    render: ( body ) => mount( body ),
} );
```

If you don't use the returned `Window`, prefix with `void` as in
Pattern B. The `render` callback already runs asynchronously
(after the window's DOM is constructed) so its semantics don't
change.

### Pattern D — you checked the boolean result of `openWindow`

**No change needed.**

```ts
const opened = wp.os.openWindow( 'my-window' );
if ( ! opened ) {
    showFallbackUi();
}
```

`wp.os.openWindow` still returns `boolean` — `true` when
the shell accepted the open intent (the id is registered),
`false` when it didn't (e.g. the id isn't known). The actual
window opens asynchronously under the hood; the boolean has
always been about *acceptance*, not *visibility*.

### Pattern E — you used `windowManager.open()` from a top-level
script (no enclosing function)

If you can't add `await` because you're in module-top-level
code without `<script type="module">`, wrap in an IIFE:

```ts
( async () => {
    const win = await wp.os.windowManager.open( cfg );
    win.focus();
} )();
```

Or use `.then( … )` as in Pattern A.

---

## What about the rejection case?

`manager.open( … )` rejects if the lazy bundle can't be loaded
(network failure on `<script>` fetch, mis-configured deploy
with no bundle URL, …). Real-world failure rate is very low —
the bundle is on the same origin, served by the plugin itself,
and the preload after first paint catches network blips before
the user clicks.

Defensive handling:

```ts
try {
    const win = await wp.os.windowManager.open( cfg );
    win.focus();
} catch ( err ) {
    console.error( '[my-plugin] failed to open window:', err );
    showFallbackUi();
}
```

For fire-and-forget calls (`void manager.open( … )`), the
rejection becomes an unhandled-promise rejection logged to the
console. The shell's `desktop.ts` boot path adds its own
`.catch( … )` on the rare cases where it dispatches open from
boot (`restoreSession`, `openCurrentPage`). Plugin code that
genuinely doesn't care about failure can leave the `void` prefix
and let the browser log the rejection.

### "bundle loaded but did not register" during development

If you see this exact error in the console while iterating on the
framework:

```
Error: [openstation] window-system bundle loaded but did not
register `window.openStationWindowSystem`.
```

…it almost always means **the browser is serving a cached old
copy of the lazy bundle**, from before the assignment was added.
The PHP-emitted URLs use `?ver=<filemtime>` since 0.8.4 so
on-disk rebuilds invalidate the cache automatically — but a hard
reload (`Cmd+Shift+R` / `Ctrl+Shift+F5`) clears any in-memory
copy a previous session may have stuck on. Same fix applies for
the analogous shell-overlays / ai-assistant / os-settings-panel
errors.

---

## Why not keep the API synchronous via a Window-proxy?

A `Proxy`-wrapped `Window` that queued calls until the real
instance resolved was the alternative. We considered it and
chose the breaking change instead because:

1. **The proxy can't satisfy synchronous return values.** Code
   like `if ( manager.open( cfg ).fullscreen ) { … }` reads a
   property — the proxy can't return the right value until the
   real Window is materialised.
2. **The proxy hides the lazy load from authors.** Plugin
   authors who hit a subtle bug with property reads would have
   to know that `Window` is a proxy. The async signature makes
   the lazy boundary explicit — "this returns a promise; the
   load might take a moment."
3. **`Promise<Window>` is the idiom every modern JavaScript
   surface uses for resource-deferred returns** (`fetch`,
   dynamic `import()`, `await import()`). The shape is
   familiar; the proxy isn't.

The trade-off: every plugin that calls `manager.open()` /
`openNew()` / `registerWindow()` needs a one-line update.

---

## CI / lint catches

The Stage-7 ESLint rule (`local-rules/os-component-registration`)
doesn't catch missing `await` on its own. To enforce the
migration across a plugin codebase, enable the standard
TypeScript-ESLint rules:

```jsonc
// .eslintrc / eslint.config.js
{
    "rules": {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/await-thenable": "error"
    }
}
```

`no-floating-promises` flags every un-awaited `manager.open( … )`
call; you either add `await` or `void`. `await-thenable` catches
the inverse (awaiting something that isn't a thenable —
unlikely but possible if you typo a method).

---

## Bundle-size impact

| | Pre-0.8.4 | 0.8.4 |
| - | --------- | ----- |
| First-paint download (`desktop.min.js`) | 360 kB / 101 kB gz | **307 kB / 88 kB gz** |
| Lazy `window-system.min.js` (post-paint preload) | — | 67 kB / 17 kB gz |
| Total bytes if user opens a window | 360 kB | 374 kB |
| Total bytes if user never opens a window | 360 kB | **307 kB** |

A user who enters OpenStation and never opens a window saves
~53 kB minified / ~13 kB gzipped. A user who opens a window
pays slightly more total bytes (~14 kB minified / ~4 kB gz —
overhead from the lazy-loader plumbing + per-bundle utility
duplication), split across two requests the browser fetches in
parallel after first paint.

`shell-overlays.min.js` (54 kB / 16 kB gz, also lazy-loaded
after first paint) is shared by toast, confirm-dialog, context-
menu, and the window-chrome components. It would have downloaded
anyway the moment a toast or right-click fired, so it doesn't
materially change the "open a window" cost.

---

## Reference

- Loader implementation: `src/window-system/loader.ts`
- Lazy bundle entry: `src/window-system/entry.ts`
- Cross-bundle factory contract: `src/window-system/types.ts`
- Pre-load hook in shell boot: `src/desktop.ts` (search for `preloadWindowSystem`)
- Shared-store contract for chrome registries: `src/window-chrome/{controls,slots,themes,chrome}/registry.ts` + `src/title-bar-buttons/registry.ts` (all back their state on `createSharedStore` since 0.8.4 so the lazy bundle sees the same registry main writes to — see `AGENTS.md` for the underlying primitive)
- PHP-side lazy-bundle URL helper: `$lazy_bundle_url( … )` in `includes/render/assets.php` (uses `filemtime()` so rebuilds invalidate the browser cache without bumping `OPENSTATION_VERSION`)
- Migration discussion: [PR #190 — "Faster OpenStation, main bundle cut by 59 %"](https://github.com/WordPress/desktop-mode/pull/190).
