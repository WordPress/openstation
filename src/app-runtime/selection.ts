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

export function createMarquee( opts: {

	root: HTMLElement;

	canvas: string;

	item?: string;

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
