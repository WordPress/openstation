/**
 * OpenStation: widget "fit content" height.
 *
 * A card whose def sets `fitContent` grows past the user's height
 * when its content needs the room, so a control a widget adds after
 * the size was saved shows instead of scrolling out of reach inside
 * the body. Two heights are kept apart here:
 *
 *   - the FLOOR is the user's height: the saved geometry height of a
 *     floating card, or the resized height of a docked one. It is the
 *     only height the frame ever hands to persistence.
 *   - the drawn height is the floor grown to fit the content, capped
 *     at `maxHeight` and at the work-area bottom. It lives in the
 *     card's inline style and nowhere else.
 *
 * A floor of `null` means the card sizes naturally (a docked card the
 * user never resized), and nothing is written.
 */

import { subscribeWorkArea, workAreaRectOf } from '../work-area';
import type { WidgetDef } from './types';

export interface FitContentOptions {
	card: HTMLElement;
	body: HTMLElement;
	def: WidgetDef;
	/** The desktop area; the work area is measured against it. */
	parent: HTMLElement;
	/** The user's height at mount, or `null` for a natural height. */
	floor: number | null;
	/** Air kept between the card and the work-area bottom. */
	margin: number;
	isFloating(): boolean;
	/** True mid-drag or mid-resize, when the pointer owns the size. */
	isBusy(): boolean;
}

export interface FitContent {
	/** The user's height, or `null` while the card sizes naturally. */
	floor(): number | null;
	/** Record a new user height. Does not refit; call `refit()`. */
	setFloor( height: number | null ): void;
	/** Measure the content and write the drawn height. */
	refit(): void;
	dispose(): void;
}

export function attachFitContent( opts: FitContentOptions ): FitContent {
	const { card, body, def, parent } = opts;
	let floor = opts.floor;
	let wasFloating = opts.isFloating();
	let frame = 0;
	let mutations: MutationObserver | null = null;

	// The work-area bottom, with the same air the drag clamp keeps.
	const cap = (): number => {
		const area = workAreaRectOf( parent );
		const top =
			card.getBoundingClientRect().top - parent.getBoundingClientRect().top;
		return Math.min(
			def.maxHeight ?? Infinity,
			area.y + area.height - top - opts.margin,
		);
	};

	const refit = (): void => {
		// Liberated or re-docked (by the chrome or by
		// `wp.os.widgetLayer.redock()`): the height just written for
		// the new state is the user's.
		const floating = opts.isFloating();
		if ( floating !== wasFloating ) {
			wasFloating = floating;
			floor = parseFloat( card.style.height ) || null;
		}
		if ( floor === null || opts.isBusy() ) {
			return;
		}
		// Measure at the floor: once the content fits, `scrollHeight`
		// equals `clientHeight`, so a grown card could never tell how
		// much it may shrink. Both writes land before the next paint.
		card.style.height = `${ floor }px`;
		const overflow = body.scrollHeight - body.clientHeight;
		const target =
			overflow > 0 ? Math.max( floor, Math.min( floor + overflow, cap() ) ) : floor;
		card.style.height = `${ target }px`;
		// Our own style writes are not news, but a child that arrived
		// in the same batch still needs watching.
		if ( mutations ) {
			watchChildren( mutations.takeRecords() );
		}
	};

	// A ResizeObserver callback that resizes what it observes ends in
	// a "loop completed with undelivered notifications" error, so it
	// refits on the next frame instead.
	const schedule = (): void => {
		if ( ! frame ) {
			frame = requestAnimationFrame( () => {
				frame = 0;
				refit();
			} );
		}
	};

	// The body keeps its box while its content grows (it scrolls), so
	// the content is watched through the body's children instead.
	// `null` where ResizeObserver is missing (jsdom).
	const resizes =
		typeof ResizeObserver === 'function' ? new ResizeObserver( schedule ) : null;
	const watchChildren = ( records?: MutationRecord[] ): void => {
		if ( records && ! records.some( ( r ) => r.target === body ) ) {
			return;
		}
		resizes?.disconnect();
		for ( const child of Array.from( body.children ) ) {
			resizes?.observe( child );
		}
	};

	if ( typeof MutationObserver === 'function' ) {
		mutations = new MutationObserver( ( records ) => {
			watchChildren( records );
			refit();
		} );
	}
	// Body children come and go; card style and class writes are the
	// layer re-placing the card (reclamp, redock) or a gesture ending.
	mutations?.observe( body, { childList: true } );
	mutations?.observe( card, {
		attributes: true,
		attributeFilter: [ 'style', 'class' ],
	} );
	watchChildren();
	const offWorkArea = subscribeWorkArea( refit );

	return {
		floor: () => floor,
		setFloor: ( height ) => {
			floor = height;
		},
		refit,
		dispose: () => {
			mutations?.disconnect();
			resizes?.disconnect();
			if ( frame ) {
				cancelAnimationFrame( frame );
			}
			offWorkArea();
		},
	};
}
