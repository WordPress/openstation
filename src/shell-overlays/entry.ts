/**
 * Shell-overlays lazy bundle — entry.
 *
 * Compiled by Vite (target `shell-overlays`) into
 * `assets/js/shell-overlays[.min].js`. Holds every `<os-*>`
 * component class the shell needs ONLY for *triggered* actions:
 *
 *   - Toasts (`<os-toast>` + `<os-toast-container>`) — fired by
 *     `wp.os.showToast( … )`.
 *   - Confirm dialog (`<os-confirm-dialog>`) — fired by
 *     `wp.os.confirm( … )` / `osConfirm( … )`.
 *   - Right-click context menus (`<os-context-menu>` +
 *     `<os-context-menu-option>`) — fired by item-visibility,
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
import '../ui/components/os-toast/os-toast';
import '../ui/components/os-confirm-dialog/os-confirm-dialog';
import '../ui/components/os-context-menu/os-context-menu';
// Window-chrome + folder-dialog components (Stage 10). None are
// constructed at first paint: window chrome only renders when a
// window opens; the form fields only render when a user opens a
// folder-window dialog (rename URL, file-association settings) or
// the preview pane. The shell pre-loads this bundle right after
// first paint via `preloadShellOverlays( … )` in `desktop.ts`, so
// by the time the user clicks an icon and the Window class
// constructs its DOM, the custom-element classes are registered
// and the chrome upgrades synchronously.
import '../ui/components/os-menu/os-menu'; // registers os-menu + os-menu-item
import '../ui/components/os-window-button/os-window-button';
import '../ui/components/os-tab-chip/os-tab-chip';
import '../ui/components/os-save-status/os-save-status';
import '../ui/components/os-spinner/os-spinner';
import '../ui/components/os-button/os-button';
import '../ui/components/os-text-field/os-text-field';
import '../ui/components/os-select/os-select'; // registers os-select + os-option

// Readiness marker the main-bundle loader polls. It has to be a flag
// this bundle and ONLY this bundle sets: the loader used to sniff
// `customElements.get( 'os-confirm-dialog' )`, and the moment a
// component in that list also reached `desktop.min.js` through some
// other import chain, the sniff answered "already loaded" at boot and
// this bundle was never fetched. The tags nothing else happened to
// register — `os-context-menu` above all — then stayed inert, which
// is a right-click that does nothing rather than an error anyone
// would notice. Mirrors `window.openStationWindowSystem`.
window.openStationShellOverlays = true;
