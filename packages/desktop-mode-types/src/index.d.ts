/**
 * `@desktop-mode/types` — public TypeScript surface for plugins
 * building on top of WordPress Desktop Mode.
 *
 * Re-exports every Stable type the shell exposes through
 * `wp.desktop.*` so plugin authors get IDE autocomplete and
 * compile-time checks against the desktop-mode public API.
 *
 * Usage in a plugin's tsconfig.json:
 *
 *   ```json
 *   {
 *     "compilerOptions": {
 *       "types": [ "@desktop-mode/types/global" ]
 *     }
 *   }
 *   ```
 *
 * Then in code:
 *
 *   ```ts
 *   import type {
 *     WindowConfig,
 *     WallpaperDef,
 *     WidgetDef,
 *     HOOKS,
 *   } from '@desktop-mode/types';
 *
 *   wp.desktop.hooks.addAction(
 *     wp.desktop.HOOKS.WINDOW_OPENED,
 *     'myplugin/track',
 *     ( e ) => console.log( 'Window opened:', e.windowId )
 *   );
 *   ```
 *
 * The .d.ts files in this package are the SAME types the shell
 * itself uses (re-exported from `src/public-api.ts`); a build-time
 * step copies them when packaging for npm.
 */

export * from '../../../src/public-api';
