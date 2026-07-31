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
 */

// Action-triggered overlays (Stage 9).
import '../ui/components/wpd-toast/wpd-toast';
import '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import '../ui/components/wpd-context-menu/wpd-context-menu';
// Window-chrome + folder-dialog components (Stage 10). None are
// constructed at first paint: window chrome only renders when a
// window opens; the form fields only render when a user opens a
// folder-window dialog (rename URL, file-association settings) or
// the preview pane. The shell pre-loads this bundle right after
// first paint via `preloadShellOverlays( … )` in `desktop.ts`, so
// by the time the user clicks an icon and the Window class
// constructs its DOM, the custom-element classes are registered
// and the chrome upgrades synchronously.
import '../ui/components/wpd-menu/wpd-menu'; // registers wpd-menu + wpd-menu-item
import '../ui/components/wpd-window-button/wpd-window-button';
import '../ui/components/wpd-tab-chip/wpd-tab-chip';
import '../ui/components/wpd-save-status/wpd-save-status';
import '../ui/components/wpd-spinner/wpd-spinner';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-text-field/wpd-text-field';
import '../ui/components/wpd-select/wpd-select'; // registers wpd-select + wpd-option
