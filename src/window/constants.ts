/**
 * OpenStation — Window constants.
 *
 * Shared between the `Window` class and its sibling helper modules
 * (drag, resize, tabs, menus, iframe-bridge).
 */

/**
 * Minimum distance from viewport edges when dragging.
 *
 * Set to 0 so a dragged window can travel flush with the desktop-area
 * edges — needed for edge-snap (the snap preview rectangle starts at
 * x=0, so the window visually aligns with it on commit) and to match
 * the feel of native OS windows. A small positive value (8px) used
 * to keep a gap for legibility, but on modern macOS / Windows you
 * can drag a window to the very edge — and snap gestures expect it.
 */
export const EDGE_MARGIN = 0;

/**
 * Minimum visible area (in pixels) of the title bar that must remain
 * on-screen when dragging or reflowing windows. Prevents the window
 * from becoming completely unreachable.
 */
export const GRAB_MARGIN = 40;

/**
 * Minimum cursor travel (in pixels) before a pointerdown counts as a
 * drag rather than a click. Applied as squared distance so the check
 * is cheap (no sqrt) inside the pointermove loop. 5 px matches the
 * feel of native OS drag-to-tear gestures — tight enough to feel
 * responsive, loose enough to forgive a jittery pointer on a touchpad.
 */
export const DRAG_THRESHOLD_PX = 5;
export const DRAG_THRESHOLD_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

/**
 * How long an external sub-tab's iframe gets to fire its initial
 * `load` event before we assume the request failed and fall back to
 * opening the URL in a real browser tab.
 */
export const EXTERNAL_IFRAME_READY_TIMEOUT_MS = 3000;

/**
 * Duration of the loading overlay's fade-out before the element is
 * removed from the DOM. Must match the `transition: opacity` duration
 * on `.os-window__loading` in
 * `assets/css/window-chrome.css` — overshooting wastes a frame,
 * undershooting yanks the spinner mid-fade.
 *
 * Also the delay the window-reveal surface waits before it starts
 * receding, so the spinner's exit and the reveal read as one sequence
 * instead of a cross-fade.
 */
export const LOADING_OVERLAY_FADE_OUT_MS = 250;

/**
 * Entry delay before the loading overlay may fade IN. Owned by JS:
 * `ensureLoadingOverlay` waits this long before adding the
 * `os-window__loading--visible` modifier that the CSS rule keys off.
 *
 * It cannot be a `transition-delay` on the overlay itself. The overlay
 * is appended into a body that ALREADY carries `os-window__body--loading`,
 * so its very first computed style is the visible one — there is no
 * before-change value for a transition to run from, and the delay is
 * skipped entirely. That made the spinner reach full strength on every
 * open regardless of how fast the content landed.
 *
 * Loads that finish inside this window never paint a spinner at all,
 * which is what the reveal surface checks to decide whether it has a
 * fade-out to wait for.
 */
export const LOADING_OVERLAY_SHOW_DELAY_MS = 120;

/**
 * How long the body content takes to fade in once the loading overlay
 * has finished fading out. Must match the `transition` duration on
 * `.os-window__body--loading-out > …` in
 * `assets/css/window-chrome.css`; the shell waits
 * {@link LOADING_OVERLAY_FADE_OUT_MS} plus this span before dropping
 * the hand-off modifier.
 *
 * The two spans are sequential, never concurrent: a spinner fading out
 * over content that has already painted puts both layers on screen at
 * once, which is the flash this hand-off exists to prevent.
 */
export const LOADING_CONTENT_FADE_IN_MS = 250;
