export function applyOrder< T extends { id: string } >(
	items: readonly T[],
	order: readonly string[],
): T[] {
	if ( 0 === order.length || items.length <= 1 ) {
		return items.slice();
	}
	const byId = new Map< string, T >();
	for ( const item of items ) {
		byId.set( item.id, item );
	}
	const out: T[] = [];
	const placed = new Set< string >();
	for ( const id of order ) {
		const item = byId.get( id );
		if ( item && ! placed.has( id ) ) {
			out.push( item );
			placed.add( id );
		}
	}
	for ( const item of items ) {
		if ( ! placed.has( item.id ) ) {
			out.push( item );
		}
	}
	return out;
}

export function reorderZone(
	order: readonly string[],
	nextZoneIds: readonly string[],
): string[] {
	const zoneIds = new Set( nextZoneIds );
	const queue = nextZoneIds.slice();
	const out: string[] = [];
	for ( const id of order ) {
		if ( ! zoneIds.has( id ) ) {
			out.push( id );
			continue;
		}
		const next = queue.shift();
		if ( undefined !== next ) {
			out.push( next );
		}
	}
	out.push( ...queue );
	return out;
}

export function sortByOrder< T extends { order?: number } >(
	items: readonly T[],
): T[] {
	return items
		.map( ( item, index ) => ( { item, index } ) )
		.sort(
			( a, b ) =>
				( a.item.order ?? 0 ) - ( b.item.order ?? 0 ) ||
				a.index - b.index,
		)
		.map( ( entry ) => entry.item );
}
