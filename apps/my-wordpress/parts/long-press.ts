export const LONG_PRESS_MS = 500;

export const LONG_PRESS_SLOP_PX = 10;

export interface LongPressHandlers {
	pointerdown: ( e: PointerEvent ) => void;
	pointermove: ( e: PointerEvent ) => void;
	pointerup: ( e: PointerEvent ) => void;
	pointercancel: ( e: PointerEvent ) => void;
}

interface Press {
	pointerId: number;
	x: number;
	y: number;
	timer: ReturnType< typeof setTimeout >;
}

const presses = new WeakMap< Element, Press >();

function cancel( el: Element ): void {
	const press = presses.get( el );
	if ( press ) {
		clearTimeout( press.timer );
		presses.delete( el );
	}
}

export function pressesForMenu( e: Pick< PointerEvent, 'pointerType' | 'isPrimary' > ): boolean {
	return e.isPrimary && ( e.pointerType === 'touch' || e.pointerType === 'pen' );
}

export function longPress(
	fire: ( x: number, y: number ) => void,
	accept: ( e: PointerEvent ) => boolean = () => true,
): LongPressHandlers {
	return {
		pointerdown: ( e ) => {
			const el = e.currentTarget as Element;
			cancel( el );
			if ( ! pressesForMenu( e ) || ! accept( e ) ) {
				return;
			}
			const x = e.clientX;
			const y = e.clientY;
			const timer = setTimeout( () => {
				presses.delete( el );

				const swallow = ( ev: Event ): void => {
					ev.stopPropagation();
					ev.preventDefault();
				};
				el.addEventListener( 'click', swallow, { capture: true, once: true } );
				setTimeout( () => el.removeEventListener( 'click', swallow, { capture: true } ), 700 );
				fire( x, y );
			}, LONG_PRESS_MS );
			presses.set( el, { pointerId: e.pointerId, x, y, timer } );
		},
		pointermove: ( e ) => {
			const el = e.currentTarget as Element;
			const press = presses.get( el );
			if ( ! press || press.pointerId !== e.pointerId ) {
				return;
			}
			if ( Math.hypot( e.clientX - press.x, e.clientY - press.y ) > LONG_PRESS_SLOP_PX ) {
				cancel( el );
			}
		},
		pointerup: ( e ) => {
			const el = e.currentTarget as Element;
			if ( presses.get( el )?.pointerId === e.pointerId ) {
				cancel( el );
			}
		},
		pointercancel: ( e ) => {
			cancel( e.currentTarget as Element );
		},
	};
}
