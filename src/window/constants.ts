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
 * Entry delay before the loading overlay fades IN. Must match the
 * `transition-delay` on `.os-window__body--loading >
 * .os-window__loading` in `assets/css/window-chrome.css`.
 *
 * Loads that finish inside this window never paint a spinner at all,
 * which is what the reveal surface checks to decide whether it has a
 * fade-out to wait for.
 */
export const LOADING_OVERLAY_SHOW_DELAY_MS = 120;
