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
