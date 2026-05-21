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
- **Hook constants** — `HOOKS.WINDOW_OPENED`, `HOOKS.CONNECTION_OPENED`, `HOOKS.DRAG_BRIDGE_EVENTS`, …
- **Public surface helpers** — `DRAG_EVENTS`, `DRAG_BRIDGE_EVENTS`, etc.

Both runtime values AND types — the same file backs both conditions in the `exports` map.

## Runtime use of components — you usually don't need the import at all

The `wpd-*` custom elements are **already registered globally** by `desktop.min.js` when desktop mode is active. Plugin templates can just emit the markup:

```html
<wpd-log id="agent-trace" max-rows="500"></wpd-log>
```

```javascript
const log = document.getElementById( 'agent-trace' );
log.appendRow( { level: 'info', message: 'Agent started' } );
```

The class import (`import { WpdLog } from 'desktop-mode'`) is only useful for:

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

## Troubleshooting

- **`Cannot find module 'desktop-mode'`** — confirm the `file:` path is correct relative to your plugin's `package.json` location, then re-run `npm install`.
- **Types resolve but runtime imports fail** — your bundler is configured to externalize without a runtime shim. Either remove the externalization or wire a global resolver.
- **Duplicate custom element warning in DevTools** — the `wpd-*` elements register themselves on import; if both your bundle AND `desktop.min.js` define them, browsers log a warning (harmless — the registry is idempotent per tag name).
- **Editing `desktop-mode/src/*` doesn't reflect in your plugin** — `file:` dependencies on some npm versions copy at install time. Run `npm install` again, or switch to `npm link` for an active symlink while developing both packages in parallel.
