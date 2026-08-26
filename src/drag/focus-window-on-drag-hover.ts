/**
 * OpenStation — Focus the hovered window during a drag.
 *
 * While a drag is in flight — ANY drag, whatever its source, origin,
 * or payload — the window under the cursor is raised (focused) after
 * a short hover dwell, macOS spring-loading style. Without this,
 * dragging a payload toward a background window leaves the drop
 * target buried behind the source window: the drop works, but the
 * user can't see where it lands.
 *
 * Three channels feed one shared dwell state machine:
 *
 *   1. Shell `DragManager` sessions (file tiles, My WordPress tiles,
 *      plugin sources) — pointer-event gestures, driven by the
 *      `DRAG_EVENTS.MOVE` / `.END` CustomEvents on `document`.
 *   2. Native HTML5 drags over shell surfaces — OS files, images,
 *      text, links, cross-iframe bridge drags (Media Library). The
 *      parent document's own `dragover` supplies the coordinates.
 *      For bridge drags this covers iframe windows too: the
 *      iframe-drop-targets module suppresses `pointer-events` on
 *      every iframe for the session, so `dragover` falls through to
 *      the parent everywhere.
 *   3. Native HTML5 drags hovering an iframe window OUTSIDE a bridge
 *      session (an OS file held over a post window, an image dragged
 *      out of one admin page over another). Those `dragover` events
 *      fire inside the iframe's document and never reach the parent
 *      — but the hovered window IS the iframe's window, so the
 *      chromeless bridge (`includes/render/chromeless-bridge.php`,
 *      mirrored in `iframe-bridge-standalone.ts`) posts a throttled
 *      `os-drag-hover` message and the parent resolves the
 *      sender to its window id. No coordinates needed.
 *
 * Ends are heterogeneous — `DRAG_EVENTS.END` for channel 1,
 * `drop` / `dragend` / leave-the-window `dragleave` for channel 2,
 * and nothing at all for channel 3 (a drop inside the iframe is
 * invisible to the parent) — so the HTML5 channels additionally arm
 * a watchdog: when hover signals stop arriving, the state resets and
 * any pending dwell dies with it.
 *
 * The dwell (rather than focus-on-enter) is deliberate:
 *
 *   - Focus permanently reorders the z-stack. Sweeping across
 *     intermediate windows on the way to a target must not raise
 *     every window the path happens to cross.
 *   - Each focus change fans out `WINDOW_BLURRED` / `WINDOW_FOCUSED`
 *     hooks and CustomEvents to the dock, unfocus effects, etc. —
 *     per-crossing churn is real work.
 *   - `WindowManager.focus()` auto-exits a fullscreen window; an
 *     accidental 50 ms crossing must not kick one out.
 *
 * Like `iframe-drop-targets.ts`, this module never imports the
 * WindowManager — it takes a minimal structural focus host, keeping
 * `src/drag/` framework-agnostic. Raising a window mid-drag is safe:
 * `WindowManager.focus()` only reorders z-indices and CSS classes,
 * it never moves keyboard focus, so the drag-recovery blur-cancel
 * cannot trip.
 *
 * Plugins can veto per activation via the
 * `os.window.focus-on-drag-hover` filter.
 */

import { applyFilters, HOOKS } from '../hooks';
import { DRAG_EVENTS, type DragPayload } from './types';
import {
	DRAG_BRIDGE_EVENTS,
	type DragBridgePayload,
} from '../drag-bridge';
import { findWindowRootAtPoint, windowIdFromRoot } from './window-at-point';

/** How long the cursor must rest on a window before it is raised. */
export const FOCUS_ON_DRAG_HOVER_DWELL_MS = 250;

/**
 * How long the HTML5 channels may go silent before the hover state
 * resets. `dragover` re-fires every ~350 ms even on a stationary
 * cursor (and the iframe forwarder throttles to well under that), so
 * a full second of silence reliably means the drag ended somewhere
 * the parent can't observe (a drop inside an iframe, an Escape
 * cancel, the cursor leaving the browser).
 */
export const FOCUS_ON_DRAG_HOVER_WATCHDOG_MS = 1000;

/** Iframe→parent postMessage announcing an in-iframe drag hover. */
export const DRAG_HOVER_MESSAGE_TYPE = 'os-drag-hover';

/** The one window method the dwell activation needs. */
export interface FocusableWindow {
	isFocused(): boolean;
}

/**
 * Minimal structural slice of the WindowManager. Kept local so
 * `src/drag/` stays decoupled from the window system (see the module
 * rationale in `types.ts`).
 */
export interface WindowFocusHost< W extends FocusableWindow = FocusableWindow > {
	getById( id: string ): W | undefined;
	/**
	 * The `| string` mirrors the real `WindowManager.focus()`, which
	 * takes a window or its id. Without it this slice is narrower than
	 * the thing it describes and the manager stops being assignable
	 * to it.
	 */
	focus( win: W | string ): void;
}

let _installed = false;
let _host: WindowFocusHost | null = null;
let _lastHoverWindowId: string | null = null;
let _dwellTimer: ReturnType< typeof setTimeout > | null = null;
let _watchdogTimer: ReturnType< typeof setTimeout > | null = null;
/** Payload slug of the active bridge session, or null when none. */
let _bridgePayloadKind: string | null = null;

function clearDwell(): void {
	if ( _dwellTimer !== null ) {
		clearTimeout( _dwellTimer );
		_dwellTimer = null;
	}
}

function clearWatchdog(): void {
	if ( _watchdogTimer !== null ) {
		clearTimeout( _watchdogTimer );
		_watchdogTimer = null;
	}
}

function resetHoverState(): void {
	clearDwell();
	clearWatchdog();
	_lastHoverWindowId = null;
}

function bumpWatchdog(): void {
	clearWatchdog();
	_watchdogTimer = setTimeout( () => {
		_watchdogTimer = null;
		resetHoverState();
	}, FOCUS_ON_DRAG_HOVER_WATCHDOG_MS );
}

function fireFocus( windowId: string, payloadType: string ): void {
	const win = _host?.getById( windowId );
	if ( ! win || win.isFocused() ) {
		// Closed mid-dwell, or already on top (e.g. the drag-source
		// window) — nothing to raise.
		return;
	}
	const shouldFocus = applyFilters<
		boolean,
		[ { windowId: string; payloadType: string } ]
	>(
		HOOKS.WINDOW_FOCUS_ON_DRAG_HOVER,
		true,
		{ windowId, payloadType },
	);
	if ( ! shouldFocus ) {
		return;
	}
	try {
		_host?.focus( win );
	} catch ( err ) {
		console.error( '[openstation] focus-on-drag-hover focus() threw:', windowId, err );
	}
}

/**
 * The shared dwell state machine. Fed the hovered window id (or null
 * for wallpaper/dock/none) by whichever channel is driving the drag.
 */
function trackHoverWindowId( windowId: string | null, payloadType: string ): void {
	if ( windowId === _lastHoverWindowId ) {
		// Still over the same window (or still over none) — let a
		// pending dwell run to completion rather than restarting it.
		return;
	}
	clearDwell();
	_lastHoverWindowId = windowId;
	if ( windowId === null ) {
		// Wallpaper, dock, taskbar — leave focus as-is.
		return;
	}
	_dwellTimer = setTimeout( () => {
		_dwellTimer = null;
		fireFocus( windowId, payloadType );
	}, FOCUS_ON_DRAG_HOVER_DWELL_MS );
}

function trackHoverAtPoint( clientX: number, clientY: number, payloadType: string ): void {
	const root = findWindowRootAtPoint( clientX, clientY );
	trackHoverWindowId( root ? windowIdFromRoot( root ) : null, payloadType );
}

// ------------------------------------------------------------------
// Channel 1 — shell DragManager sessions (pointer-event gesture).
// Has a definitive END event, so no watchdog involvement.
// ------------------------------------------------------------------

const onDragMove = ( e: Event ): void => {
	const detail = ( e as CustomEvent ).detail as
		| { payload?: DragPayload; clientX?: number; clientY?: number }
		| undefined;
	if (
		typeof detail?.clientX !== 'number' ||
		typeof detail?.clientY !== 'number'
	) {
		return;
	}
	trackHoverAtPoint( detail.clientX, detail.clientY, detail.payload?.type ?? '' );
};

const onDragEnd = (): void => {
	resetHoverState();
};

// ------------------------------------------------------------------
// Channel 2 — native HTML5 drags over shell surfaces (parent-document
// `dragover`). Covers OS files, images/text/links from anywhere, and
// — because iframe pointer-events are suppressed during a bridge
// session — cross-iframe bridge drags over iframe windows too.
// ------------------------------------------------------------------

function dragHasFiles( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	// DataTransfer.types is a frozen array in modern engines, a
	// DOMStringList in older ones.
	const list = types as unknown as {
		includes?: ( s: string ) => boolean;
		contains?: ( s: string ) => boolean;
	};
	if ( typeof list.includes === 'function' ) {
		return list.includes( 'Files' );
	}
	return typeof list.contains === 'function' && list.contains( 'Files' );
}

const onNativeDragOver = ( e: DragEvent ): void => {
	bumpWatchdog();
	const payloadType =
		_bridgePayloadKind ?? ( dragHasFiles( e ) ? 'os-file' : 'external' );
	trackHoverAtPoint( e.clientX, e.clientY, payloadType );
};

const onNativeDragSettled = (): void => {
	// `drop` or `dragend` anywhere in the parent document — the
	// gesture is over.
	resetHoverState();
};

const onNativeDragLeave = ( e: DragEvent ): void => {
	// A null relatedTarget means the drag left the parent document
	// (out of the browser window, or into an iframe — where channel 3
	// takes over). Kill any pending dwell rather than letting it fire
	// on a window the cursor is no longer over.
	if ( e.relatedTarget === null ) {
		resetHoverState();
	}
};

// ------------------------------------------------------------------
// Channel 3 — in-iframe drag hovers, forwarded by the chromeless
// bridge as `os-drag-hover` postMessages. The sender iframe
// IS the hovered window; no coordinates travel.
// ------------------------------------------------------------------

/** Resolve a posted-from `Window` source to its host window id. */
function windowIdFromMessageSource(
	source: MessageEventSource | null,
): string | null {
	if ( ! source ) {
		return null;
	}
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const f of Array.from( iframes ) ) {
		if ( f.contentWindow === source ) {
			const host = f.closest( '[data-window-id]' );
			return host?.getAttribute( 'data-window-id' ) || null;
		}
	}
	return null;
}

const onHoverMessage = ( e: MessageEvent ): void => {
	if ( e.origin !== window.location.origin ) {
		return;
	}
	const data = e.data as { type?: unknown; payloadType?: unknown } | null;
	if ( ! data || data.type !== DRAG_HOVER_MESSAGE_TYPE ) {
		return;
	}
	const windowId = windowIdFromMessageSource( e.source );
	if ( ! windowId ) {
		return;
	}
	bumpWatchdog();
	trackHoverWindowId(
		windowId,
		typeof data.payloadType === 'string' ? data.payloadType : 'external',
	);
};

// ------------------------------------------------------------------
// Bridge session bookkeeping — only used to tag channel-2 hovers with
// the bridge payload's kind for the veto filter.
// ------------------------------------------------------------------

const onBridgeStart = ( e: Event ): void => {
	const detail = ( e as CustomEvent ).detail as
		| { payload?: DragBridgePayload }
		| undefined;
	if ( detail?.payload ) {
		_bridgePayloadKind = detail.payload.kind ?? '';
	}
};

const onBridgeEnd = (): void => {
	_bridgePayloadKind = null;
	resetHoverState();
};

/**
 * Install the focus-on-drag-hover behavior. Idempotent. Bind ONCE at
 * shell boot; the rest is driven by drag events.
 *
 * @public
 *
 * @param host The WindowManager (or any object exposing `getById` +
 *             `focus`).
 */
export function installFocusWindowOnDragHover( host: WindowFocusHost ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_host = host;
	// Channel 1 — END fires last on both the commit and cancel
	// paths, so one listener covers all teardown.
	document.addEventListener( DRAG_EVENTS.MOVE, onDragMove );
	document.addEventListener( DRAG_EVENTS.END, onDragEnd );
	document.addEventListener( DRAG_BRIDGE_EVENTS.START, onBridgeStart );
	document.addEventListener( DRAG_BRIDGE_EVENTS.END, onBridgeEnd );
	// Channel 2 — capture phase so the coordinates arrive regardless
	// of what deeper handlers do with the events.
	document.addEventListener( 'dragover', onNativeDragOver, true );
	document.addEventListener( 'drop', onNativeDragSettled, true );
	document.addEventListener( 'dragend', onNativeDragSettled, true );
	document.addEventListener( 'dragleave', onNativeDragLeave, true );
	// Channel 3.
	window.addEventListener( 'message', onHoverMessage );
}

/** Test-only. Drops the install latch + detaches the listeners. */
export function __resetFocusWindowOnDragHoverForTests(): void {
	resetHoverState();
	_bridgePayloadKind = null;
	document.removeEventListener( DRAG_EVENTS.MOVE, onDragMove );
	document.removeEventListener( DRAG_EVENTS.END, onDragEnd );
	document.removeEventListener( DRAG_BRIDGE_EVENTS.START, onBridgeStart );
	document.removeEventListener( DRAG_BRIDGE_EVENTS.END, onBridgeEnd );
	document.removeEventListener( 'dragover', onNativeDragOver, true );
	document.removeEventListener( 'drop', onNativeDragSettled, true );
	document.removeEventListener( 'dragend', onNativeDragSettled, true );
	document.removeEventListener( 'dragleave', onNativeDragLeave, true );
	window.removeEventListener( 'message', onHoverMessage );
	_installed = false;
	_host = null;
}
