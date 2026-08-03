# `@desktop-mode/types`

TypeScript types and ambient globals for plugins building on top of WordPress OpenStation.

## Install

This package isn't published to npm yet — it lives in-tree under `packages/desktop-mode-types/` so plugin authors developing alongside the OpenStation source can already point their `tsconfig.json` at it. A future release will publish to npm under the same name.

For now, plugin authors can either:

- **Submodule it.** Git-submodule the full OpenStation repo and point at `packages/desktop-mode-types` inside it. The `.d.ts` files here are relative re-exports of the in-tree source (`../../../src/*`), not self-contained declarations, so copying just this directory won't compile.
- **Path-alias it.** Add a `paths` entry in the plugin's `tsconfig.json` pointing at this directory.

## What you get

```ts
import type {
    WindowConfig,
    WallpaperDef,
    WidgetDef,
    NativeWindowDef,
    DesktopSettingsTab,
    HOOKS,
    SessionWindow,
    WallpapersFilter,
    BridgeEventFromIframe,
    BridgeEventToIframe,
} from '@desktop-mode/types';
```

Every `Stable` type re-exported from `src/public-api.ts` — windows, wallpapers, widgets, native windows, settings tabs, dock items, the hook constants, and the bridge protocol.

## Ambient `wp.os`

Add `@desktop-mode/types/global` to your plugin's `tsconfig.json`:

```json
{
    "compilerOptions": {
        "types": [ "@desktop-mode/types/global" ]
    }
}
```

Now `wp.os.*` is typed everywhere in your plugin without any explicit import:

```ts
wp.os.hooks.addAction(
    wp.os.HOOKS.WINDOW_OPENED,
    'myplugin/track',
    ( e ) => console.log( 'Window opened:', e.windowId )
);

const ok = await wp.os.confirm( {
    title: 'Delete?',
    message: 'Cannot undo.',
    danger: true,
} );

await wp.os.fetch( '/wp-json/myplugin/v1/save', {
    method: 'POST',
    body: JSON.stringify( payload ),
} );
```

## Versioning

The Stable types follow semver — a backwards-incompatible signature change ships a major bump and a deprecation shim. Renames and breaking changes are documented per release in the `docs/migration-*.md` notes (e.g. [`docs/migration-0.8.4-async-windowmanager.md`](../../docs/migration-0.8.4-async-windowmanager.md)), indexed in [`docs/README.md`](../../docs/README.md).

## License

GPL-2.0-or-later — same as the OpenStation plugin.
