export const SWIPE_COMMIT_FRACTION = 0.35;

export const SWIPE_COMMIT_VELOCITY = 0.6;

export const SWIPE_MIN_TRAVEL = 24;

export const SWIPE_INTENT_PX = 10;

export const EDGE_BACK_THRESHOLD = 64;

export const SWIPE_UP_THRESHOLD = 44;

export interface SwipeOutcomeInput {

	dx: number;

	dy: number;

	velocity: number;

	width: number;
}

export function swipeOutcome( input: SwipeOutcomeInput ): 'commit' | 'cancel' {
	const { dx, dy, velocity, width } = input;
	const absX = Math.abs( dx );
	if ( absX <= Math.abs( dy ) ) {
		return 'cancel';
	}
	if ( width > 0 && absX >= width * SWIPE_COMMIT_FRACTION ) {
		return 'commit';
	}
	if (
		Math.abs( velocity ) >= SWIPE_COMMIT_VELOCITY &&
		absX >= SWIPE_MIN_TRAVEL &&
		Math.sign( velocity ) === Math.sign( dx )
	) {
		return 'commit';
	}
	return 'cancel';
}

export function edgeSwipeProgress( dx: number, threshold: number = EDGE_BACK_THRESHOLD ): number {
	if ( threshold <= 0 ) {
		return dx > 0 ? 1 : 0;
	}
	return Math.min( 1, Math.max( 0, dx / threshold ) );
}

export interface EdgeBackOptions {
	threshold?: number;

	onProgress?: ( progress: number ) => void;
	onCommit: () => void;
}

export function bindEdgeBack( zone: HTMLElement, opts: EdgeBackOptions ): () => void {
	const threshold = opts.threshold ?? EDGE_BACK_THRESHOLD;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let vertical = false;

	const reset = (): void => {
		pointerId = null;
		vertical = false;
		opts.onProgress?.( 0 );
	};
	const onDown = ( e: PointerEvent ): void => {
		if ( pointerId !== null || ! e.isPrimary ) {
			return;
		}
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		vertical = false;
		try {
			zone.setPointerCapture( e.pointerId );
		} catch {

		}
		e.preventDefault();
	};
	const onMove = ( e: PointerEvent ): void => {
		if ( e.pointerId !== pointerId || vertical ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		if ( Math.abs( dy ) > SWIPE_INTENT_PX && Math.abs( dy ) > Math.abs( dx ) ) {
			vertical = true;
			opts.onProgress?.( 0 );
			return;
		}
		opts.onProgress?.( edgeSwipeProgress( dx, threshold ) );
	};
	const onUp = ( e: PointerEvent ): void => {
		if ( e.pointerId !== pointerId ) {
			return;
		}
		const commit = ! vertical && edgeSwipeProgress( e.clientX - startX, threshold ) >= 1;
		reset();
		if ( commit ) {
			opts.onCommit();
		}
	};
	const onCancel = ( e: PointerEvent ): void => {
		if ( e.pointerId === pointerId ) {
			reset();
		}
	};

	zone.addEventListener( 'pointerdown', onDown );
	zone.addEventListener( 'pointermove', onMove );
	zone.addEventListener( 'pointerup', onUp );
	zone.addEventListener( 'pointercancel', onCancel );
	return () => {
		zone.removeEventListener( 'pointerdown', onDown );
		zone.removeEventListener( 'pointermove', onMove );
		zone.removeEventListener( 'pointerup', onUp );
		zone.removeEventListener( 'pointercancel', onCancel );
	};
}

export function bindHistorySwipeGuard( zone: HTMLElement ): () => void {
	const onTouchStart = ( e: Event ): void => {
		if ( e.cancelable ) {
			e.preventDefault();
		}
	};
	zone.addEventListener( 'touchstart', onTouchStart, { passive: false } );
	return () => {
		zone.removeEventListener( 'touchstart', onTouchStart );
	};
}

export interface SwipeUpOptions {
	threshold?: number;
	onCommit: () => void;
}

export function bindSwipeUp( el: HTMLElement, opts: SwipeUpOptions ): () => void {
	return bindVerticalSwipe( el, 'up', opts );
}

export function bindSwipeDown( el: HTMLElement, opts: SwipeUpOptions ): () => void {
	return bindVerticalSwipe( el, 'down', opts );
}

function bindVerticalSwipe(
	el: HTMLElement,
	direction: 'up' | 'down',
	opts: SwipeUpOptions,
): () => void {
	const threshold = opts.threshold ?? SWIPE_UP_THRESHOLD;
	const sign = direction === 'up' ? 1 : -1;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let committed = false;

	const swallowNextClick = (): void => {
		const swallow = ( e: Event ): void => {
			e.stopPropagation();
			e.preventDefault();
		};
		el.addEventListener( 'click', swallow, { capture: true, once: true } );

		setTimeout( () => el.removeEventListener( 'click', swallow, { capture: true } ), 350 );
	};
	const onDown = ( e: PointerEvent ): void => {
		if ( pointerId !== null || ! e.isPrimary || e.pointerType === 'mouse' ) {
			return;
		}
		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		committed = false;
	};
	const onMove = ( e: PointerEvent ): void => {
		if ( e.pointerId !== pointerId || committed ) {
			return;
		}
		const dy = ( startY - e.clientY ) * sign;
		const dx = Math.abs( e.clientX - startX );
		if ( dy >= threshold && dy > dx ) {
			committed = true;
			swallowNextClick();
			opts.onCommit();
		}
	};
	const onEnd = ( e: PointerEvent ): void => {
		if ( e.pointerId === pointerId ) {
			pointerId = null;
		}
	};

	el.addEventListener( 'pointerdown', onDown );
	el.addEventListener( 'pointermove', onMove );
	el.addEventListener( 'pointerup', onEnd );
	el.addEventListener( 'pointercancel', onEnd );
	return () => {
		el.removeEventListener( 'pointerdown', onDown );
		el.removeEventListener( 'pointermove', onMove );
		el.removeEventListener( 'pointerup', onEnd );
		el.removeEventListener( 'pointercancel', onEnd );
	};
}
