/**
 * OpenStation — phone layer: gestures.
 *
 * Three pointer gestures, each a pure decision plus a thin binder:
 *
 *   - `swipeOutcome()`     — a card swiped sideways: commit or spring back.
 *   - `bindEdgeBack()`     — a drag in from the left edge: back.
 *   - `bindSwipeUp()`      — a flick up on the tab bar: the switcher.
 *
 * All three use Pointer Events with capture, never touch events, so
 * a pen or a mouse drag behaves the same as a finger and jsdom can
 * drive them in tests. Every binder returns its unbind function.
 *
 * The iframes are the reason the back gesture needs its own zone:
 * a pointer that starts over an iframe belongs to that document,
 * and the shell never hears about it. The zone is a thin strip the
 * shell owns along the edge (`.os-mobile-edge` in `mobile.css`),
 * which is how every phone OS does it too.
 */

/** Fraction of the card width a swipe must travel to commit. */
export const SWIPE_COMMIT_FRACTION = 0.35;
/** Flick speed (px/ms) that commits a short swipe. */
export const SWIPE_COMMIT_VELOCITY = 0.6;
/** Minimum travel for a velocity commit, so a tap never commits. */
export const SWIPE_MIN_TRAVEL = 24;
/** Travel before a drag counts as horizontal intent. */
export const SWIPE_INTENT_PX = 10;
/** Default travel for the edge-back gesture to commit. */
export const EDGE_BACK_THRESHOLD = 64;
/** Default travel for the swipe-up gesture to commit. */
export const SWIPE_UP_THRESHOLD = 44;

export interface SwipeOutcomeInput {
	/** Horizontal travel since pointerdown. */
	dx: number;
	/** Vertical travel since pointerdown. */
	dy: number;
	/** Horizontal velocity at release, px/ms (signed). */
	velocity: number;
	/** Width of the element being swiped. */
	width: number;
}

/** Whether a released sideways swipe dismisses the card. Pure. */
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

/** How far along (0..1) an edge-back drag is. Pure. */
export function edgeSwipeProgress( dx: number, threshold: number = EDGE_BACK_THRESHOLD ): number {
	if ( threshold <= 0 ) {
		return dx > 0 ? 1 : 0;
	}
	return Math.min( 1, Math.max( 0, dx / threshold ) );
}

export interface EdgeBackOptions {
	threshold?: number;
	/** Called on every move with the 0..1 progress; `0` on cancel. */
	onProgress?: ( progress: number ) => void;
	onCommit: () => void;
}

/**
 * Bind the edge-back gesture to its zone. The zone must own the
 * pointer (it is the shell's element, over the iframe), so capture
 * is enough to track the drag wherever it wanders.
 */
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
			// jsdom: no capture support; the listeners are on the zone.
		}
		e.preventDefault();
	};
	const onMove = ( e: PointerEvent ): void => {
		if ( e.pointerId !== pointerId || vertical ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		// A drag that goes up or down before it goes right is a
		// scroll that happened to start at the edge.
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

export interface SwipeUpOptions {
	threshold?: number;
	onCommit: () => void;
}

/**
 * Bind a swipe-up on an element that also holds buttons. When the
 * gesture commits, the click the release would otherwise fire on
 * the button under the finger is swallowed once, so a flick up on
 * the tab bar opens the switcher without also opening Posts.
 */
export function bindSwipeUp( el: HTMLElement, opts: SwipeUpOptions ): () => void {
	return bindVerticalSwipe( el, 'up', opts );
}

/** The mirror: a flick down on the top bar sends the app home. */
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
		// If no click follows (the release landed outside), drop the
		// trap before it eats a real tap.
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
