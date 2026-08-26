/**
 * Ordering within a zone.
 *
 * One flat list of ids covers every zone. Each zone filters it for its
 * own members, so a core menu keeps the position the user dragged it
 * to when the layout switch moves it from the dock to the sidebar —
 * a per-zone list keyed by rail would lose that on every switch.
 */

/**
 * Sort `items` to match `order`. Ids absent from `order` keep their
 * relative source position and render after the listed ones, which is
 * what makes a newly-activated plugin's menu land at the end rather
 * than at a random index.
 */
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

/**
 * Fold one zone's new order back into the flat list, leaving every
 * other zone's entries exactly where they were.
 *
 * The slots the zone already occupies in `order` are refilled from
 * `nextZoneIds` in sequence; ids the zone gained (a tile the user
 * just pinned) are appended. Nothing else moves — which is why a drag
 * in the apps zone cannot perturb the sidebar.
 */
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

/**
 * The zone's baseline order, before the user's own.
 *
 * A stable sort by each item's `order`, which is how the shell's
 * trailing cluster (Mio, Overview, System, Exit, Trash) holds its
 * sequence whatever order the tiles happen to register in. Everything
 * at the default 0 keeps registration order and leads.
 */
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
