/**
 * Desktop Mode — Iframe-window drop targets.
 *
 * Cross-iframe pointer routing for shell-side shortcut drags. The
 * problem: when a DragManager session runs in the parent shell and
 * the cursor moves over an iframe-window's iframe, the iframe's
 * `pointer-events: auto` (default) captures the move and the
 * parent's `pointermove` handler stops firing — the ghost "freezes"
 * at the iframe boundary.
 *
 * The fix has to be bulletproof across browsers and stacking
 * variations, so it's driven entirely from JavaScript via the
 * DragManager lifecycle events (no CSS rules to cache, no overlay
 * stacking-context puzzles):
 *
 *   - On `DRAG_EVENTS.START` with a `'shortcut'` payload that
 *     carries a `bridgePayload`:
 *       1. Walk every `iframe.desktop-mode-window__iframe` in the
 *          document, save its current inline `pointer-events`, and
 *          set it to `'none'`. The iframe stops capturing pointer
 *          events. The browser routes the move to whatever is
 *          behind it — typically the iframe's parent
 *          (`.desktop-mode-window__body`).
 *       2. Register that parent as a drop target via the
 *          DragManager. `elementFromPoint` returns the parent, the
 *          registry's deepest-ancestor walk finds the registered
 *          target, and `onEnter` / `onDrop` post the cross-window
 *          message into the iframe.
 *
 *   - On `DRAG_EVENTS.END`:
 *       1. Restore every iframe's `pointer-events` to its prior
 *          value.
 *       2. Deregister the drop targets.
 *
 * Why this design beats the previous overlay-based attempt:
 *
 *   - The overlay required body attributes to flip in time AND its
 *     CSS rule to be applied AND the overlay to be appended to the
 *     right element AND the overlay's stacking context to win
 *     against the iframe — any one breaking left the ghost stuck.
 *   - Driving the iframe's `pointer-events` from JS at the START
 *     event is a single observable side effect (visible in
 *     DevTools' inline styles) with no caching or specificity
 *     surface.
 *
 * @since 0.8.7
 */

import { addAction, HOOKS } from '../hooks';
import {
	DRAG_EVENTS,
	type DragManagerApi,
	type DragSession,
} from './types';
import type {
	DesktopFileDragData,
	ShortcutDragData,
} from '../desktop-files/drag-payloads';
import {
	DRAG_BRIDGE_EVENTS,
	type DragBridgePayload,
} from '../drag-bridge';
import { findWindowRootAtPoint } from './window-at-point';

const TARGET_ID_PREFIX = 'desktop-mode-iframe-drop-';
const IFRAME_SELECTOR = 'iframe.desktop-mode-window__iframe';
const DROP_ACTIVE_ATTR = 'data-desktop-mode-iframe-drop-active';

let _installed = false;
let _dragManager: DragManagerApi | null = null;

type DeregisterFn = () => void;

/** Snapshot of iframe inline `pointerEvents` values during a drag. */
const _suppressedIframes = new Map< HTMLIFrameElement, string >();
/** Registered drop-target deregister fns during a drag, keyed by iframe. */
const _activeRegistrations = new Map< HTMLIFrameElement, DeregisterFn >();

/** Active bridge payload while iframe-to-iframe drag intercept is live. */
let _bridgeInterceptPayload: DragBridgePayload | null = null;
let _lastHoveredBridgeIframe: HTMLIFrameElement | null = null;

function suppressIframePointerEventsBridge(): void {
	const iframes = document.querySelectorAll< HTMLIFrameElement >(
		IFRAME_SELECTOR,
	);
	iframes.forEach( ( iframe ) => {
		if ( _suppressedIframes.has( iframe ) ) {
			return;
		}
		_suppressedIframes.set( iframe, iframe.style.pointerEvents );
		iframe.style.pointerEvents = 'none';
	} );
}

function restoreIframePointerEvents(): void {
	_suppressedIframes.forEach( ( prev, iframe ) => {
		iframe.style.pointerEvents = prev;
	} );
	_suppressedIframes.clear();
}

/**
 * Find the iframe-window that contains the cursor at the given
 * client coords. With iframe pointer-events suppressed during a
 * bridge session, `elementFromPoint` returns the body div *inside*
 * an iframe-window; walking up to `.desktop-mode-window` and back
 * down to the iframe child is the reliable resolution path.
 */
function findIframeAtCursor(
	clientX: number,
	clientY: number,
): HTMLIFrameElement | null {
	const win = findWindowRootAtPoint( clientX, clientY );
	if ( ! win ) {
		return null;
	}
	const iframe = win.querySelector( IFRAME_SELECTOR );
	return iframe instanceof HTMLIFrameElement ? iframe : null;
}

const onBridgeDragOver = ( e: DragEvent ): void => {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	e.preventDefault();
	if ( e.dataTransfer ) {
		e.dataTransfer.dropEffect = 'copy';
	}
	const iframe = findIframeAtCursor( e.clientX, e.clientY );
	if ( iframe === _lastHoveredBridgeIframe ) {
		return;
	}
	if ( _lastHoveredBridgeIframe ) {
		postIntoIframe( _lastHoveredBridgeIframe, {
			type: 'desktop-mode-drag-leave',
		} );
	}
	_lastHoveredBridgeIframe = iframe;
	if ( iframe ) {
		postIntoIframe( iframe, {
			type: 'desktop-mode-drag-over',
			payload: _bridgeInterceptPayload,
		} );
	}
};

const onBridgeDrop = ( e: DragEvent ): void => {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	if ( typeof e.stopImmediatePropagation === 'function' ) {
		e.stopImmediatePropagation();
	}
	const iframe = findIframeAtCursor( e.clientX, e.clientY );
	const payload = _bridgeInterceptPayload;
	stopBridgeIntercept();
	if ( ! iframe ) {
		return;
	}
	const rect = iframe.getBoundingClientRect();
	postIntoIframe( iframe, {
		type: 'desktop-mode-drop',
		payload,
		position: {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		},
	} );
};

const onBridgeDragEnd = (): void => {
	stopBridgeIntercept();
};

function startBridgeIntercept( payload: DragBridgePayload ): void {
	if ( _bridgeInterceptPayload ) {
		_bridgeInterceptPayload = payload;
		return;
	}
	_bridgeInterceptPayload = payload;
	suppressIframePointerEventsBridge();
	document.addEventListener( 'dragover', onBridgeDragOver, true );
	document.addEventListener( 'drop', onBridgeDrop, true );
	document.addEventListener( 'dragend', onBridgeDragEnd, true );
}

function stopBridgeIntercept(): void {
	if ( ! _bridgeInterceptPayload ) {
		return;
	}
	_bridgeInterceptPayload = null;
	if ( _lastHoveredBridgeIframe ) {
		postIntoIframe( _lastHoveredBridgeIframe, {
			type: 'desktop-mode-drag-leave',
		} );
		_lastHoveredBridgeIframe = null;
	}
	document.removeEventListener( 'dragover', onBridgeDragOver, true );
	document.removeEventListener( 'drop', onBridgeDrop, true );
	document.removeEventListener( 'dragend', onBridgeDragEnd, true );
	restoreIframePointerEvents();
}

/**
 * Extract the cross-frame `bridgePayload` from a DragManager payload
 * regardless of payload type. Both `'shortcut'` (fresh tile from My
 * WordPress) and `'desktop-file'` (existing wallpaper placement) data
 * shapes optionally carry the same `bridgePayload` field. Returns
 * `undefined` when the payload either isn't a known shape or doesn't
 * carry a bridge payload.
 */
function extractBridgePayload(
	payload: unknown,
): DragBridgePayload | undefined {
	if ( ! payload || typeof payload !== 'object' ) {
		return undefined;
	}
	const obj = payload as { type?: unknown; data?: unknown };
	if ( obj.type !== 'shortcut' && obj.type !== 'desktop-file' ) {
		return undefined;
	}
	const data = obj.data as
		| ShortcutDragData
		| DesktopFileDragData
		| undefined;
	return data?.bridgePayload;
}

function postIntoIframe(
	iframe: HTMLIFrameElement,
	msg: unknown,
): void {
	const w = iframe.contentWindow;
	if ( ! w ) {
		return;
	}
	try {
		w.postMessage( msg, window.location.origin );
	} catch {
		// Cross-origin or detached frame — no receiver to talk to.
	}
}

function registerDropTargetFor(
	dragManager: DragManagerApi,
	iframe: HTMLIFrameElement,
	target: HTMLElement,
	windowId: string,
): () => void {
	return dragManager.registerDropTarget( {
		id: `${ TARGET_ID_PREFIX }${ windowId }`,
		element: target,
		accept: ( payload ) => !! extractBridgePayload( payload ),
		onEnter: ( session: DragSession ) => {
			const bridge = extractBridgePayload( session.payload );
			if ( ! bridge ) {
				return;
			}
			target.setAttribute( DROP_ACTIVE_ATTR, '' );
			postIntoIframe( iframe, {
				type: 'desktop-mode-drag-over',
				payload: bridge,
			} );
		},
		onLeave: () => {
			target.removeAttribute( DROP_ACTIVE_ATTR );
			postIntoIframe( iframe, { type: 'desktop-mode-drag-leave' } );
		},
		onDrop: ( session, ev ) => {
			target.removeAttribute( DROP_ACTIVE_ATTR );
			const bridge = extractBridgePayload( session.payload );
			if ( ! bridge ) {
				return;
			}
			const rect = iframe.getBoundingClientRect();
			postIntoIframe( iframe, {
				type: 'desktop-mode-drop',
				payload: bridge,
				position: {
					x: ev.clientX - rect.left,
					y: ev.clientY - rect.top,
				},
			} );
		},
	} );
}

function deriveWindowIdFromIframe( iframe: HTMLIFrameElement ): string {
	// Each iframe-window stamps its outer root with `id="wp-window-<id>"`.
	// Walk up to find that root so the drop target's id is stable +
	// debuggable.
	let cur: HTMLElement | null = iframe.parentElement;
	while ( cur ) {
		if ( cur.id.startsWith( 'wp-window-' ) ) {
			return cur.id.slice( 'wp-window-'.length );
		}
		cur = cur.parentElement;
	}
	// Fallback — unique-enough id so the registry doesn't collide.
	return `unknown-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

function onDragStart( payload: unknown ): void {
	const dragManager = _dragManager;
	if ( ! dragManager ) {
		return;
	}
	// Always suppress iframe pointer-events for the duration of ANY
	// drag — including desktop-file repositions and plugin payloads
	// that don't carry a `bridgePayload`. This is the only way the
	// ghost can track the cursor across iframe boundaries; without it
	// the iframe captures the move and the ghost freezes the moment
	// the cursor crosses the edge. The drop side still gates on
	// payload kind via the registered DropTarget's `accept()`.
	const iframes = document.querySelectorAll< HTMLIFrameElement >( IFRAME_SELECTOR );
	const isBridgeable = !! extractBridgePayload( payload );
	// Diagnostic — visible in DevTools console at every drag start.
	// Helps narrow down which side of the wiring is breaking when a
	// regression bubbles up. `console.info` is in the lint
	// allowlist; `console.log` would need an inline disable.
	console.info(
		'[desktop-mode] drag-start: suppressing %d iframe(s); bridgeable=%s',
		iframes.length,
		isBridgeable,
		payload,
	);
	iframes.forEach( ( iframe ) => {
		// Suppress pointer-events idempotently. If the bridge
		// intercept already suppressed this iframe (shell-side
		// drags fan a bridge-payload through desktop.ts and that
		// fires DRAG_BRIDGE_EVENTS.START synchronously BEFORE the
		// DragManager's DRAG_EVENTS.START listener runs here), we
		// don't want to overwrite the prior-value snapshot — but
		// we also must NOT early-return: this loop is also the
		// only place that registers the per-iframe DragManager
		// drop targets the hit-test needs to land an `onDrop`.
		if ( ! _suppressedIframes.has( iframe ) ) {
			_suppressedIframes.set( iframe, iframe.style.pointerEvents );
			iframe.style.pointerEvents = 'none';
		}

		// Only register a drop target when the payload is one we know
		// how to deliver into the iframe (`bridgePayload` present).
		// For other drag types the suppression alone is enough to
		// keep the ghost tracking — `elementFromPoint` returns the
		// iframe's parent body div, which the registry's deepest-
		// ancestor walk fails to match and the ghost stays in reject
		// mode (correct UX — the iframe window doesn't want this
		// payload type).
		if ( ! isBridgeable ) {
			return;
		}
		if ( _activeRegistrations.has( iframe ) ) {
			return;
		}
		const dropTargetEl = iframe.parentElement;
		if ( ! dropTargetEl ) {
			return;
		}
		const windowId = deriveWindowIdFromIframe( iframe );
		const deregister = registerDropTargetFor(
			dragManager,
			iframe,
			dropTargetEl,
			windowId,
		);
		_activeRegistrations.set( iframe, deregister );
	} );
}

function onDragEnd(): void {
	_suppressedIframes.forEach( ( prev, iframe ) => {
		iframe.style.pointerEvents = prev;
	} );
	_suppressedIframes.clear();
	_activeRegistrations.forEach( ( deregister ) => {
		try {
			deregister();
		} catch {
			// Registry already cleaned up; ignore.
		}
	} );
	_activeRegistrations.clear();
}

/**
 * Install the cross-window iframe drop-target machinery. Idempotent.
 * Bind ONCE at shell boot; the rest is driven by drag events.
 *
 * Also exposes `window.__desktopModeIframeDropDebug` returning the
 * live state of the registration map, so users hitting a regression
 * can paste that into DevTools and report exactly which side of the
 * wiring is broken.
 *
 * @public
 * @since 0.8.7
 */
export function installIframeDropTargets( dragManager: DragManagerApi ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;
	_dragManager = dragManager;

	document.addEventListener( DRAG_EVENTS.START, ( e ) => {
		const detail = ( e as CustomEvent ).detail as
			| { payload?: unknown }
			| undefined;
		onDragStart( detail?.payload );
	} );
	document.addEventListener( DRAG_EVENTS.END, () => {
		onDragEnd();
	} );

	// Iframe-to-iframe HTML5 drag intercept. The legacy Media Library
	// patch (`assets/js/media-library-enhanced.js`) starts a native
	// HTML5 drag inside `upload.php`, and the user drops on
	// Gutenberg's nested editor-canvas iframe. Without intervention,
	// every drag event (dragover / drop) fires INSIDE whichever
	// iframe the cursor is over and never reaches the parent shell —
	// the bridge payload is stranded, Gutenberg's own handler
	// doesn't recognise the drop (Chromium strips the custom MIME
	// across iframe boundaries), and nothing inserts.
	//
	// The fix mirrors the DragManager pattern: while a bridge
	// session is in flight, suppress `pointer-events` on every
	// iframe-window. Drag events then fall through to the parent
	// document, where we can identify which iframe-window the
	// cursor is over and postMessage `desktop-mode-drop` to its
	// content window — the same protocol the Gutenberg receiver
	// already implements for shell-side DragManager drops.
	document.addEventListener( DRAG_BRIDGE_EVENTS.START, ( e ) => {
		const detail = ( e as CustomEvent ).detail as
			| { payload?: DragBridgePayload }
			| undefined;
		if ( ! detail?.payload ) {
			return;
		}
		startBridgeIntercept( detail.payload );
	} );
	document.addEventListener( DRAG_BRIDGE_EVENTS.END, () => {
		stopBridgeIntercept();
	} );

	// On WINDOW_CLOSED we don't need to do anything special — if the
	// drag is in flight when a window closes, the closing window's
	// iframe is gone from the DOM and the registry's element-keyed
	// store silently drops the orphan reference. The deregister fn we
	// stored becomes a harmless no-op.
	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/drag/iframe-drop-targets-window-close',
		() => {
			// Re-walk to drop any iframes that disappeared from the
			// DOM mid-drag. Iterate over a snapshot — mutating the
			// Map inside `forEach` is spec-safe but reads as a
			// hazard at the call site.
			for ( const [ iframe ] of Array.from( _suppressedIframes ) ) {
				if ( ! iframe.isConnected ) {
					_suppressedIframes.delete( iframe );
				}
			}
			for ( const [ iframe, deregister ] of Array.from( _activeRegistrations ) ) {
				if ( ! iframe.isConnected ) {
					try {
						deregister();
					} catch {
						// already cleaned up
					}
					_activeRegistrations.delete( iframe );
				}
			}
		},
	);

	type DesktopModeIframeDropDebugWindow = Window & {
		__desktopModeIframeDropDebug?: () => {
			installed: boolean;
			iframesInDom: number;
			suppressedCount: number;
			registeredCount: number;
			suppressedIframeIds: string[];
		};
	};
	( window as DesktopModeIframeDropDebugWindow ).__desktopModeIframeDropDebug = () => ( {
		installed: _installed,
		iframesInDom: document.querySelectorAll( IFRAME_SELECTOR ).length,
		suppressedCount: _suppressedIframes.size,
		registeredCount: _activeRegistrations.size,
		suppressedIframeIds: Array.from( _suppressedIframes.keys() ).map(
			deriveWindowIdFromIframe,
		),
	} );
}

/** Test-only. Drops the install latch + clears any in-flight state. */
export function __resetIframeDropTargetsForTests(): void {
	onDragEnd();
	_installed = false;
	_dragManager = null;
}
