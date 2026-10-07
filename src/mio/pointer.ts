export interface PointerTracker {

	get: () => { x: number; y: number } | null;

	destroy: () => void;
}

const LEAVE_GRACE_MS = 250;

export function createPointerTracker(): PointerTracker {
	let position: { x: number; y: number } | null = null;
	let leaveTimer: ReturnType< typeof setTimeout > | null = null;
	let destroyed = false;

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
