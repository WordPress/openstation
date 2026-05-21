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
 * @since 0.22.0
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
import type { DragBridgePayload } from '../drag-bridge';

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
	// regression bubbles up. Cheap (one log per drag, no inner loop
	// noise) so it's fine to leave in shipped code.
	// eslint-disable-next-line no-console
	console.log(
		'[desktop-mode] drag-start: suppressing %d iframe(s); bridgeable=%s',
		iframes.length,
		isBridgeable,
		payload,
	);
	iframes.forEach( ( iframe ) => {
		if ( _suppressedIframes.has( iframe ) ) {
			return;
		}
		// Snapshot inline pointerEvents so we can restore it on END.
		// Empty string means "no inline override — use stylesheet".
		_suppressedIframes.set( iframe, iframe.style.pointerEvents );
		iframe.style.pointerEvents = 'none';

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
 * @since 0.22.0
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
			// DOM mid-drag.
			_suppressedIframes.forEach( ( _prev, iframe ) => {
				if ( ! iframe.isConnected ) {
					_suppressedIframes.delete( iframe );
				}
			} );
			_activeRegistrations.forEach( ( deregister, iframe ) => {
				if ( ! iframe.isConnected ) {
					try {
						deregister();
					} catch {
						// already cleaned up
					}
					_activeRegistrations.delete( iframe );
				}
			} );
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
