/**
 * Desktop Mode — Centralized drag-and-drop types.
 *
 * The DragManager unifies every in-shell drag gesture (file tiles on
 * the wallpaper, entity tiles inside My WordPress, future plugin
 * surfaces) onto a single pointer-event-based pipeline. Native HTML5
 * drag was abandoned for in-shell gestures because:
 *
 *   1. `setPointerCapture` (used by tile rearrange handlers) silently
 *      breaks HTML5 `dragstart` detection — the browser never fires
 *      it, so payloads attached to `DataTransfer` never reach a drop
 *      target. That was the long-standing "I can drag a Posts tile
 *      but nothing accepts the drop" bug.
 *   2. HTML5 drag has no programmatic cancel. Pressing Escape, alt-
 *      tabbing away, or system modals leave drag state stranded; the
 *      pointer-event model gives us full control over teardown.
 *   3. The "Lift and Drop" cross-iframe pattern (architecture.md North
 *      Star) needs a parent-shell-controlled drag anyway. Building
 *      that on top of native HTML5 means routing drops through
 *      postMessage shims; building it on pointer events keeps a single
 *      mental model.
 *
 * The legacy `setShortcutDragPayload` / `hasShortcutPayload` /
 * `readShortcutPayload` helpers in `desktop-files/drag-shortcut.ts`
 * are kept for backwards compat — third-party plugins that emitted
 * HTML5 drags with the legacy MIME continue to work, the manager
 * bridges them into a session at `dragstart` time and `preventDefault`s
 * the browser's native drag.
 *
 * Cross-iframe Media Library drags (`src/drag-bridge.ts`) remain a
 * separate channel. That bridge is a payload carrier, not a gesture
 * driver — its lifecycle is owned by the source/destination iframes,
 * not the parent shell.
 */

/**
 * Payload carried by an in-flight drag. `type` is a free-form slug
 * that drop targets switch on. The framework knows about
 * `'desktop-file'` and `'shortcut'`; plugins can introduce their
 * own.
 */
export interface DragPayload {
	/** Slug. `'desktop-file'`, `'shortcut'`, or plugin-defined. */
	type: string;
	/** Originating element. Used for the default ghost + click fallback. */
	source: HTMLElement;
	/** Type-specific data. Shape is the consumer's contract. */
	data: Record< string, unknown >;
	/** Optional override for the ghost element + offset. */
	ghost?: GhostConfig;
}

export interface GhostConfig {
	/** Element to render under the cursor. Defaults to a clone of `source`. */
	element?: HTMLElement;
	/** Pointer-to-ghost-origin offset, in CSS px. */
	offsetX: number;
	offsetY: number;
	/**
	 * Optional "Drop here" / "Can't drop here" chip floated next to
	 * the ghost — gives the user an explicit textual confirmation of
	 * whether the current hover region accepts the payload, on top of
	 * the cursor + colored-outline cues. Defaults to sensible
	 * messages for the framework payload types (`'shortcut'` /
	 * `'desktop-file'`); pass `hidden: true` to opt out.
	 */
	hint?: GhostHintConfig;
}

export interface GhostHintConfig {
	/** Suppress the chip entirely. Defaults to false. */
	hidden?: boolean;
	/** Label when the cursor is over an accepting drop target. */
	accept?: string;
	/** Label when over a rejecting / non-target region. */
	reject?: string;
	/** Label before the cursor has entered any target (idle state). */
	neutral?: string;
}

/** Reasons a drag session can end without committing a drop. */
export type CancelReason =
	| 'escape' // user pressed Escape
	| 'blur' // window lost focus
	| 'visibility' // tab became hidden
	| 'pointercancel' // browser fired pointercancel (touch interrupted, etc.)
	| 'no-target' // pointerup over a non-accepting region
	| 'rejected' // pointerup over a registered target that rejected
	| 'caller'; // manual `session.cancel()`

/**
 * The in-flight session. Returned from `manager.start()`. Sources
 * generally don't keep a reference — drop targets receive it as the
 * first arg of their callbacks.
 */
export interface DragSession {
	readonly payload: DragPayload;
	/** Has the session already exited (cancel or commit). */
	isFinished(): boolean;
	/** Manually cancel. Idempotent. */
	cancel( reason?: CancelReason ): void;
}

/**
 * A registered drop target. Multiple targets can be live at once;
 * the manager hit-tests under the cursor and picks the deepest
 * match in the DOM.
 *
 * Accept-vs-reject semantics: `accept(payload)` returns true if
 * this target wants the payload. If false, the manager still treats
 * the target as a *claimant* — the cursor shows `no-drop` and the
 * drop is rejected. This prevents the ghost from "falling through"
 * a window onto the wallpaper underneath.
 */
export interface DropTarget {
	/** Stable id for diagnostics + idempotent re-registration. */
	id: string;
	/** DOM container that defines the hit-test region. */
	element: HTMLElement;
	/** Pure predicate. Cheap. Called on every entry transition. */
	accept( payload: DragPayload ): boolean;
	/** Fired once when the cursor enters this target. */
	onEnter?( session: DragSession ): void;
	/** Fired once when the cursor leaves this target. */
	onLeave?( session: DragSession ): void;
	/**
	 * Fired on pointerup over this target if `accept()` returned
	 * true. Coordinates are in client (viewport) space.
	 */
	onDrop( session: DragSession, ev: { clientX: number; clientY: number } ): void | Promise< void >;
	/**
	 * Optional override for the ghost hint chip's "accept" label
	 * while the cursor is over this target. Falls back to the
	 * payload-default ("Drop here to create shortcut" / "Drop here
	 * to move") when omitted. Use it when the target's semantic
	 * differs from a generic placement — e.g. the recycle bin shows
	 * "Move to Trash" instead of "create shortcut".
	 */
	acceptLabel?: string;
}

/** Public manager API. Mounted on `wp.desktop.dragManager`. */
export interface DragManagerApi {
	/**
	 * Begin a drag. Returns a session, or `null` when:
	 *
	 *   - Another session is already active.
	 *   - The pointerdown was on a non-primary button.
	 *
	 * The manager attaches its own document-level move/up/cancel
	 * listeners; the source DOES NOT call `setPointerCapture`.
	 * Pointer capture is incompatible with HTML5 drag detection
	 * and has no benefit on the document-listener model.
	 */
	start( opts: StartOpts ): DragSession | null;
	/** Register a drop target. Returns a deregister function. */
	registerDropTarget( target: DropTarget ): () => void;
	/** Is a session currently active? */
	isDragging(): boolean;
	/**
	 * Whether a real (lifted) drag ended within `withinMs` of now.
	 *
	 * Surfaces that bind plain `click` listeners on a backdrop or
	 * wallpaper element use this to ignore the synthesized click
	 * that fires immediately after a drop. Without the guard, every
	 * successful cross-window drag whose pointerup happens to land
	 * over the wallpaper (or whose ghost teardown bubbles a click
	 * up to it) would invoke "Show Desktop" — minimizing every
	 * window the user was working in.
	 *
	 * Default window of 500 ms covers the browser's ~10–50 ms
	 * pointerup→click gap with margin for any plugin-side
	 * `requestAnimationFrame` chains.
	 */
	recentlyEndedDrag( withinMs?: number ): boolean;
	/** Currently active session, or null. */
	getActive(): DragSession | null;
	/** Diagnostics — exposed for tests + manual QA. */
	debug(): {
		findOrphans(): Element[];
		listTargets(): readonly DropTarget[];
	};
}

export interface StartOpts {
	payload: DragPayload;
	/** The pointerdown that initiated the gesture. */
	origin: PointerEvent;
	/**
	 * Called if the gesture never crosses the drag threshold (the
	 * user clicked rather than dragged). Source code should treat
	 * this as the click handler.
	 */
	onClickOnly?: () => void;
	/** Called when the session is cancelled (any reason). */
	onCancel?: ( reason: CancelReason ) => void;
	/** Called when the session commits to a drop target. */
	onCommit?: ( target: DropTarget ) => void;
}

/** Distance the pointer must travel to "lift" the source. */
export const DRAG_THRESHOLD_PX = 4;

/** CustomEvent names dispatched on `document`. */
export const DRAG_EVENTS = {
	START: 'desktop-mode.drag.start',
	MOVE: 'desktop-mode.drag.move',
	ENTER: 'desktop-mode.drag.enter',
	LEAVE: 'desktop-mode.drag.leave',
	REJECTED: 'desktop-mode.drag.rejected',
	COMMIT: 'desktop-mode.drag.commit',
	CANCEL: 'desktop-mode.drag.cancel',
	END: 'desktop-mode.drag.end',
} as const;
