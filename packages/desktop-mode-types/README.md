# `@desktop-mode/types`

TypeScript types and ambient globals for plugins building on top of WordPress Desktop Mode.

## Install

This package isn't published to npm yet — it lives in-tree under `packages/desktop-mode-types/` so plugin authors developing alongside the desktop-mode source can already point their `tsconfig.json` at it. A future release will publish to npm under the same name.

For now, plugin authors can either:

- **Vendor it.** Copy `packages/desktop-mode-types/src/*.d.ts` into the plugin's repo (or git-submodule it).
- **Path-alias it.** Add a `paths` entry in the plugin's `tsconfig.json` pointing at this directory.

## What you get

```ts
import type {
    WindowConfig,
    WallpaperDef,
    WidgetDef,
    NativeWindowDef,
    DesktopCommand,
    Palette,
    DesktopSettingsTab,
    HOOKS,
    SessionWindow,
    WallpapersFilter,
    BridgeEventFromIframe,
    BridgeEventToIframe,
} from '@desktop-mode/types';
```

Every `Stable` type re-exported from `src/public-api.ts` — windows, wallpapers, widgets, native windows, commands, palettes, settings tabs, dock items, the hook constants, and the bridge protocol.

## Ambient `wp.desktop`

Add `@desktop-mode/types/global` to your plugin's `tsconfig.json`:

```json
{
    "compilerOptions": {
        "types": [ "@desktop-mode/types/global" ]
    }
}
```

Now `wp.desktop.*` is typed everywhere in your plugin without any explicit import:

```ts
wp.desktop.hooks.addAction(
    wp.desktop.HOOKS.WINDOW_OPENED,
    'myplugin/track',
    ( e ) => console.log( 'Window opened:', e.windowId )
);

const ok = await wp.desktop.confirm( {
    title: 'Delete?',
    message: 'Cannot undo.',
    danger: true,
} );

await wp.desktop.fetch( '/wp-json/myplugin/v1/save', {
    method: 'POST',
    body: JSON.stringify( payload ),
} );
```

## Versioning

The package version mirrors the desktop-mode plugin version. The Stable types follow semver — a backwards-incompatible signature change ships a major bump and a deprecation shim. See [`docs/migration-0.7-to-0.8.1.md`](../../docs/migration-0.7-to-0.8.1.md) for the running list of renames.

## License

GPL-2.0-or-later — same as the desktop-mode plugin.
