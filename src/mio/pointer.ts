/**
 * OpenStation — Mio pointer tracking.
 *
 * Mio looks at the cursor. That is trivially easy right up
 * until the cursor moves over a window, because a window's content
 * is a chromeless `<iframe>` and pointer events do not cross frame
 * boundaries — the parent document simply stops hearing about the
 * mouse. Since Mio floats *above* windows, that is most of
 * the desk, and Mio whose gaze freezes the moment you touch a
 * window looks broken rather than alive.
 *
 * So this module tracks two sources and merges them:
 *
 *   1. `pointermove` on the shell document (wallpaper, dock,
 *      taskbar, window chrome).
 *   2. `os-pointer-move` messages forwarded by the
 *      chromeless bridge inside each window iframe, rebased from the
 *      iframe's own client coordinates into viewport coordinates via
 *      the iframe element's rect.
 *
 * The forwarder inside the iframe is **opt-in and off by default**:
 * the tracker broadcasts `os-pointer-track` when it starts
 * and again whenever an iframe announces `os-bridge-ready`
 * (which fires on every navigation), and broadcasts the disable on
 * teardown. A shell with no companion pays nothing.
 *
 * See `docs/bridge-protocol.md` for the message contract.
 */

/** Latest-known pointer position, in viewport coordinates. */
export interface PointerTracker {
	/**
	 * The pointer, or `null` when its position is genuinely unknown —
	 * the cursor left the browser window and no iframe is reporting.
	 * Callers should treat `null` as "look straight ahead".
	 */
	get: () => { x: number; y: number } | null;
	/** Stop listening and tell every iframe to stop forwarding. */
	destroy: () => void;
}

/** Grace period before a cursor that left the document counts as gone. */
const LEAVE_GRACE_MS = 250;

/**
 * Start tracking. Idempotent per caller — each call installs its own
 * listeners and must be individually destroyed.
 */
export function createPointerTracker(): PointerTracker {
	let position: { x: number; y: number } | null = null;
	let leaveTimer: ReturnType< typeof setTimeout > | null = null;
	let destroyed = false;

	// Window → iframe element. Rebuilt lazily on a miss; a stale
	// entry is harmless because we re-verify `contentWindow` before
	// trusting it.
	const frameCache = new WeakMap< MessageEventSource, HTMLIFrameElement >();

	const cancelLeave = (): void => {
		if ( leaveTimer !== null ) {
			clearTimeout( leaveTimer );
			leaveTimer = null;
		}
	};

	const set = ( x: number, y: number ): void => {
		cancelLeave();
		position = { x, y };
	};

	const onMove = ( e: PointerEvent ): void => {
		set( e.clientX, e.clientY );
	};

	// Entering an iframe fires `mouseout` on the parent document even
	// though the cursor is still on screen, so we can't clear
	// immediately — the iframe's first forwarded position lands a
	// frame or two later and cancels this.
	const onLeave = (): void => {
		cancelLeave();
		leaveTimer = setTimeout( () => {
			leaveTimer = null;
			position = null;
		}, LEAVE_GRACE_MS );
	};

	const resolveFrame = (
		source: MessageEventSource | null,
	): HTMLIFrameElement | null => {
		if ( ! source ) {
			return null;
		}
		const cached = frameCache.get( source );
		if ( cached && cached.isConnected && cached.contentWindow === source ) {
			return cached;
		}
		const frames = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
		for ( const frame of Array.from( frames ) ) {
			if ( frame.contentWindow === source ) {
				frameCache.set( source, frame );
				return frame;
			}
		}
		return null;
	};

	const enableIn = ( target: MessageEventSource | null ): void => {
		if ( ! target ) {
			return;
		}
		try {
			( target as Window ).postMessage(
				{ type: 'os-pointer-track', enabled: true },
				window.location.origin,
			);
		} catch {
			/* Cross-origin or torn-down frame — nothing to do. */
		}
	};

	const broadcast = ( enabled: boolean ): void => {
		const frames = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
		for ( const frame of Array.from( frames ) ) {
			try {
				frame.contentWindow?.postMessage(
					{ type: 'os-pointer-track', enabled },
					window.location.origin,
				);
			} catch {
				/* Cross-origin or torn-down frame — nothing to do. */
			}
		}
	};

	const onMessage = ( e: MessageEvent ): void => {
		if ( destroyed || e.origin !== window.location.origin ) {
			return;
		}
		const data = e.data as { type?: string; x?: number; y?: number } | null;
		if ( ! data || typeof data.type !== 'string' ) {
			return;
		}
		// A freshly-loaded (or freshly-navigated) iframe announces
		// itself; turn its forwarder on.
		if ( data.type === 'os-bridge-ready' ) {
			enableIn( e.source );
			return;
		}
		if ( data.type !== 'os-pointer-move' ) {
			return;
		}
		if ( typeof data.x !== 'number' || typeof data.y !== 'number' ) {
			return;
		}
		const frame = resolveFrame( e.source );
		if ( ! frame ) {
			return;
		}
		const rect = frame.getBoundingClientRect();
		set( rect.left + data.x, rect.top + data.y );
	};

	window.addEventListener( 'pointermove', onMove, {
		capture: true,
		passive: true,
	} );
	window.addEventListener( 'pointerdown', onMove, {
		capture: true,
		passive: true,
	} );
	document.documentElement.addEventListener( 'mouseleave', onLeave );
	window.addEventListener( 'message', onMessage );
	broadcast( true );

	return {
		get: () => position,
		destroy: () => {
			if ( destroyed ) {
				return;
			}
			destroyed = true;
			cancelLeave();
			window.removeEventListener( 'pointermove', onMove, { capture: true } );
			window.removeEventListener( 'pointerdown', onMove, { capture: true } );
			document.documentElement.removeEventListener( 'mouseleave', onLeave );
			window.removeEventListener( 'message', onMessage );
			broadcast( false );
		},
	};
}
