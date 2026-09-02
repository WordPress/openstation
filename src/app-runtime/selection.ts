/**
 * App Framework — selection math.
 *
 * Finder-style multi-selection over a visual order: plain click
 * replaces, Ctrl/Cmd toggles, Shift extends from the anchor. Pure
 * functions of their inputs, shared so every list window answers a
 * modified click the same way.
 *
 * @public
 */

/**
 * The next selection after a row click. Plain click replaces, Ctrl/Cmd
 * toggles, Shift extends from the anchor (the last selected id) across
 * the current visual order.
 */
export function applySelection(
	selected: number[],
	order: number[],
	id: number,
	mods: { ctrl?: boolean; shift?: boolean },
): number[] {
	if ( mods.shift && selected.length > 0 ) {
		const anchor = selected[ selected.length - 1 ];
		const from = order.indexOf( anchor );
		const to = order.indexOf( id );
		if ( from !== -1 && to !== -1 ) {
			const range = order.slice( Math.min( from, to ), Math.max( from, to ) + 1 );
			const merged = new Set( [ ...selected, ...range ] );
			return Array.from( merged );
		}
	}
	if ( mods.ctrl ) {
		return selected.includes( id ) ? selected.filter( ( s ) => s !== id ) : [ ...selected, id ];
	}
	return [ id ];
}

/**
 * Drawn marquee selection over a list canvas.
 *
 * A press on empty canvas (never on a row — that is a click or a
 * drag-out) starts a fixed-position selection box on `document.body`;
 * every pointer move reports the ids of the rows the box intersects.
 * A plain press reports an empty selection first; a Ctrl/Cmd/Shift
 * press keeps the existing one, matching {@link applySelection}'s
 * modifier semantics. Returns the teardown.
 *
 * The box carries `os-app__marquee` (styled by the runtime sheet);
 * pass `className` to keep an app-specific class instead.
 */
export function createMarquee( opts: {
	/** The mount root the row query runs under. */
	root: HTMLElement;
	/** Selector for the canvas a marquee may start on. */
	canvas: string;
	/** Selector for selectable rows; must carry `data-item-id`. */
	item?: string;
	/** Receives the intersected ids on every pointer move (and `[]` on a plain start). */
	select: ( ids: number[] ) => void;
	className?: string;
} ): () => void {
	const { root, select } = opts;
	const itemSelector = opts.item ?? '[data-item-id]';
	let marquee: { x: number; y: number; box: HTMLDivElement } | null = null;
	const onDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		const canvas = ( e.target as Element | null )?.closest< HTMLElement >( opts.canvas );
		if ( ! canvas || ( e.target as Element ).closest( itemSelector ) ) {
			return;
		}
		const box = document.createElement( 'div' );
		box.className = opts.className ?? 'os-app__marquee';
		document.body.appendChild( box );
		marquee = { x: e.clientX, y: e.clientY, box };
		if ( ! e.ctrlKey && ! e.metaKey && ! e.shiftKey ) {
			select( [] );
		}
	};
	const onMove = ( e: PointerEvent ): void => {
		if ( ! marquee ) {
			return;
		}
		const left = Math.min( marquee.x, e.clientX );
		const top = Math.min( marquee.y, e.clientY );
		const width = Math.abs( e.clientX - marquee.x );
		const height = Math.abs( e.clientY - marquee.y );
		Object.assign( marquee.box.style, {
			left: `${ left }px`,
			top: `${ top }px`,
			width: `${ width }px`,
			height: `${ height }px`,
		} );
		const ids: number[] = [];
		for ( const row of Array.from( root.querySelectorAll< HTMLElement >( itemSelector ) ) ) {
			const r = row.getBoundingClientRect();
			if ( r.left < left + width && r.right > left && r.top < top + height && r.bottom > top ) {
				ids.push( Number( row.getAttribute( 'data-item-id' ) ) );
			}
		}
		select( ids );
	};
	const onUp = (): void => {
		if ( marquee ) {
			marquee.box.remove();
			marquee = null;
		}
	};
	root.addEventListener( 'pointerdown', onDown );
	document.addEventListener( 'pointermove', onMove );
	document.addEventListener( 'pointerup', onUp );
	return () => {
		root.removeEventListener( 'pointerdown', onDown );
		document.removeEventListener( 'pointermove', onMove );
		document.removeEventListener( 'pointerup', onUp );
		onUp();
	};
}
