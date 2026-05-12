/**
 * Shell-overlays lazy bundle — entry.
 *
 * Compiled by Vite (target `shell-overlays`) into
 * `assets/js/shell-overlays[.min].js`. Holds every `<wpd-*>`
 * component class the shell needs ONLY for *triggered* actions:
 *
 *   - Toasts (`<wpd-toast>` + `<wpd-toast-container>`) — fired by
 *     `wp.desktop.showToast( … )`.
 *   - Confirm dialog (`<wpd-confirm-dialog>`) — fired by
 *     `wp.desktop.confirm( … )` / `wpdConfirm( … )`.
 *   - Right-click context menus (`<wpd-context-menu>` +
 *     `<wpd-context-menu-option>`) — fired by item-visibility,
 *     wallpaper, tile, icon-canvas, and built-in-openers menus.
 *
 * None of these are constructed at first paint — the desktop on
 * boot shows wallpaper + dock + desktop icons, none of which use
 * these components. Shipping them in `desktop.min.js` was pure
 * eager-load waste.
 *
 * The bundle has only side-effect imports: each leaf module runs
 * its `defineComponent( … )` call at top level. Nothing else.
 * Pre-loaded by main after first paint (via
 * `preloadShellOverlays( … )` in `src/shell-overlays/loader.ts`)
 * so by the time the user triggers an overlay, the components are
 * already registered.
 *
 * @since 0.8.4
 */

import '../ui/components/wpd-toast/wpd-toast';
import '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../ui/components/wpd-context-menu/wpd-context-menu';
