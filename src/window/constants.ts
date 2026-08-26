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
 * How long to wait before the loading overlay may fade in. A load that
 * finishes inside this window never paints a spinner at all.
 *
 * Owned by JS, not a CSS `transition-delay`: the overlay is appended
 * into a body that already carries `os-window__body--loading`, so its
 * first computed style is the visible one and the transition never
 * runs.
 */
export const LOADING_OVERLAY_SHOW_DELAY_MS = 120;

/**
 * How long the content takes to fade in after the overlay has faded
 * out. The `transition` on `.os-window__body--loading-out` in
 * `assets/css/window-chrome.css` encodes both halves of the hand-off:
 * its duration is this constant, its delay is
 * {@link LOADING_OVERLAY_FADE_OUT_MS}. Keep all three in step.
 *
 * The two fades run back to back, never together, so the spinner and
 * the content are never both on screen.
 */
export const LOADING_CONTENT_FADE_IN_MS = 250;

/** The loading overlay element's own class. */
export const LOADING_OVERLAY_CLASS = 'os-window__loading';

/**
 * Marks a spinner as on screen. This is the single answer to "did the
 * spinner paint?": both the loaded edge in `src/window/loading.ts` and
 * the reveal surface in `src/reveals/surface.ts` read it, so they
 * cannot disagree. Do not re-derive it from a clock.
 */
export const LOADING_OVERLAY_VISIBLE_CLASS = 'os-window__loading--visible';
