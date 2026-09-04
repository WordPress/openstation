/**
 * My WordPress — long press.
 *
 * Part of the `my-wordpress` client view. A finger has no right
 * button: on a phone the context menu is a press held still, and iOS
 * never turns that into a `contextmenu` event (Android does, but not
 * reliably inside a scroller). So the press is read from Pointer
 * Events here — down, held for {@link LONG_PRESS_MS} without moving
 * past {@link LONG_PRESS_SLOP_PX}, no release — and the caller is
 * told where. A mouse or a trackpad is left to its right button.
 *
 * The state hangs off the ELEMENT (a WeakMap), not the handler
 * closure: the view is a template that re-renders, and a repaint in
 * the middle of a press would otherwise leave a timer nobody can
 * cancel — the menu opening a moment after the finger had lifted.
 *
 * @public
 */

/** How long a finger holds still before it is a long press. */
export const LONG_PRESS_MS = 500;
/** How far it may drift (px) and still be holding still. */
export const LONG_PRESS_SLOP_PX = 10;

/** The four listeners a template attaches to the pressed element. */
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

/**
 * Whether a pointer is one that has no right button. A pen counts:
 * its barrel button, where it exists, is not what people reach for.
 */
export function pressesForMenu( e: Pick< PointerEvent, 'pointerType' | 'isPrimary' > ): boolean {
	return e.isPrimary && ( e.pointerType === 'touch' || e.pointerType === 'pen' );
}

/**
 * Build the listeners for one element.
 *
 * @param fire   Called once with the press's viewport position.
 * @param accept Optional gate on the pointerdown — a canvas uses it to
 *               leave presses that began on a tile to the tile.
 */
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
				// The release that follows would be a click on the
				// element — a select, an open. It is the end of the
				// press, not a tap; swallow it.
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
