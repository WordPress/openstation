# Using `desktop-mode` from your own plugin

This doc explains how a sibling WordPress plugin can use `desktop-mode`'s TypeScript types and component classes (`WpdLog`, `WpdCode`, `WpdTabs`, …) *without* publishing `desktop-mode` to npm and *without* reaching into its `src/` tree via relative paths.

## The short version

`desktop-mode`'s `package.json` is `"private": true` (so it can never be accidentally `npm publish`ed) but exposes its public API via the `exports` map. Any sibling plugin can install it as a local file dependency:

```jsonc
// my-plugin/package.json
{
    "dependencies": {
        "desktop-mode": "file:../desktop-mode"
    }
}
```

```bash
cd my-plugin
npm install
```

That's it. After install, the import resolves through `desktop-mode`'s `exports`:

```typescript
import { WpdLog, type WpdLogRowRenderer, HOOKS } from 'desktop-mode';
```

No relative paths, no monorepo refactor, no npm registry.

## What you get

Everything re-exported from `src/public-api.ts`:

- **TypeScript types** — `WindowConfig`, `WallpaperDef`, `WidgetDef`, `DragManagerApi`, `DragBridgePayload`, `WindowConnection`, …
- **Component classes** — `WpdLog`, `WpdCode`, `WpdTabs`, `WpdAvatar`, `WpdBadge`, …
- **Hook constants** — `HOOKS.WINDOW_OPENED`, `HOOKS.CONNECTION_OPENED`, `HOOKS.WINDOW_FOCUSED`, …
- **Public surface helpers** — `DRAG_EVENTS`, `DRAG_BRIDGE_EVENTS`, etc.

Both runtime values AND types — the same file backs both conditions in the `exports` map.

## Runtime use of components — the import is what registers the tags

`wpd-*` custom elements are **side-effect registered at import time, per bundle** — they are *not* all registered globally by `desktop.min.js`. The shell bundle registers only a core subset and pre-loads `shell-overlays.min.js` (the toast / confirm-dialog / context-menu / menu / select / window-chrome kit) right after first paint; every other tag upgrades only once a loaded bundle has imported its module. Emitting a tag that no loaded bundle has imported renders inert HTML, and the missing-component warner logs a `console.error` with the exact import line to add.

For plugin bundles the fix is built in: **any** import from `'desktop-mode'` registers every tag as a side effect (the package entry re-exports the component barrel). Once your bundle imports it, templates can just emit the markup:

```html
<wpd-log id="agent-trace" max-rows="500"></wpd-log>
```

```javascript
const log = document.getElementById( 'agent-trace' );
log.push( { level: 'info', message: 'Agent started' } );
```

See [`components-reference.md`](./components-reference.md) for the full tag → class → source mapping. Beyond registration, the named class import (`import { WpdLog } from 'desktop-mode'`) is useful for:

1. **TypeScript type-checking** of the element handle (`document.getElementById('agent-trace') as WpdLog`).
2. **Subclassing** a component to override behavior.
3. **Programmatic instantiation** (`new WpdLog()` then `document.body.appendChild(el)`) — rare; the HTML route is preferred.

## Avoiding duplicate bundling

If your plugin bundles its own JS (Vite, esbuild, webpack, …) and imports `WpdLog`, the bundler will include the component's source in your bundle by default. For a single-component import this is ~3 KB gzip; for the full kit it's much more.

If you want to **externalize** — load desktop-mode's classes at runtime from the shell's bundle rather than your own — your bundler config needs:

```javascript
// vite.config.js
export default {
    build: {
        rollupOptions: {
            external: [ 'desktop-mode' ],
        },
    },
};
```

Combined with a small browser shim that resolves the import to a runtime global (e.g. `window.desktopMode`). This is an advanced setup; for most plugins, just letting the bundler include the components is fine.

## Why not just publish to npm?

We could. We deliberately don't, because:

- Bundle distribution within WordPress.org plugin reviews is already covered by the build step in this repo (`assets/js/*.min.js`). Publishing a parallel npm artifact would be a second source of truth that drifts.
- The TypeScript surface is the contract; type-only consumers don't need an npm fetch — they need a path.
- `file:` dependencies are stable, version-locked at install time, and don't require a registry.

If you genuinely need a registry-based install (e.g. a CI runner that can't see this repo's filesystem), open an issue and we'll re-evaluate.

## Iframe bridge gotcha — `whenWindowId()` never rejects

If your plugin code runs inside a chromeless wp-admin iframe and calls
`wp.desktop.iframe.whenWindowId()`, be aware that the returned Promise
**never rejects**. When the page is not running inside Desktop Mode (a
cross-origin parent, a direct admin URL visit, a unit-test harness) the
Promise simply hangs forever — any `await` after it will never resume.

Always guard with `isParentReachable()` first:

```javascript
if ( ! wp.desktop.iframe.isParentReachable() ) {
    return; // Not inside Desktop Mode — skip iframe-bridge code.
}
const windowId = await wp.desktop.iframe.whenWindowId();
```

The same caveat applies to `Window.whenContentReady()` on the shell side —
it never rejects if the content iframe never signals readiness.

## Troubleshooting

- **`Cannot find module 'desktop-mode'`** — confirm the `file:` path is correct relative to your plugin's `package.json` location, then re-run `npm install`.
- **Types resolve but runtime imports fail** — your bundler is configured to externalize without a runtime shim. Either remove the externalization or wire a global resolver.
- **Defining `wpd-*` elements twice** — the elements register themselves on import through a guarded `defineComponent()` that silently skips already-defined tags, so loading both your bundle and `desktop.min.js` is a no-op (the first-loaded class wins for each tag); no browser warning is logged.
- **Editing `desktop-mode/src/*` doesn't reflect in your plugin** — `file:` dependencies on some npm versions copy at install time. Run `npm install` again, or switch to `npm link` for an active symlink while developing both packages in parallel.
