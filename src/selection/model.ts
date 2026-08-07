/**
 * OpenStation — selection model.
 *
 * A set of keys plus an anchor, with the four gestures every
 * desktop file manager shares: replace, toggle, extend-from-anchor,
 * select-all. Nothing here touches the DOM — `controller.ts` owns
 * that half — so the semantics can be tested as plain data.
 *
 * Deliberately NOT a `createSharedStore`: a selection belongs to one
 * canvas inside one window. Two folder windows showing the same
 * folder each have their own, the same way two Finder windows do.
 * Cross-bundle sharing would fuse them.
 *
 * `order()` is the surface's visual order — DOM order for flow
 * lists, row-major geometry for absolute-positioned canvases. Range
 * selection means "everything between the anchor and the clicked
 * key IN THAT ORDER", so a surface that reports a different order
 * than the user sees produces ranges that look arbitrary.
 */

export interface SelectionModelOptions< K > {
	/** Current keys in visual order. Re-read on every range op. */
	order: () => K[];
	/** Fired after any mutation that actually changed the set. */
	onChange?: ( keys: K[] ) => void;
}

export interface SelectionModel< K > {
	/** Selected keys, in the order `order()` reports them. */
	keys: () => K[];
	has: ( key: K ) => boolean;
	size: () => number;
	/** The last key the user acted on — the origin for `selectRange`. */
	anchor: () => K | null;
	/** Replace the whole set. Anchor becomes the last key passed. */
	set: ( keys: readonly K[] ) => void;
	add: ( key: K ) => void;
	remove: ( key: K ) => void;
	/** Toggle one key (Ctrl / Cmd click). Anchor follows the key. */
	toggle: ( key: K ) => void;
	/**
	 * Select everything between the anchor and `key` inclusive.
	 * Without an anchor this degrades to selecting `key` alone.
	 * `additive` keeps the pre-existing selection (Ctrl+Shift click).
	 */
	selectRange: ( key: K, additive?: boolean ) => void;
	selectAll: () => void;
	clear: () => void;
	/**
	 * Drop keys that are no longer in `order()` — called after a
	 * repaint so a deleted item doesn't linger in the set.
	 * Returns true when something was actually pruned.
	 */
	prune: () => boolean;
	subscribe: ( cb: ( keys: K[] ) => void ) => () => void;
}

export function createSelectionModel< K >(
	options: SelectionModelOptions< K >,
): SelectionModel< K > {
	type Listener = ( keys: K[] ) => void;
	const selected = new Set< K >();
	let anchorKey: K | null = null;
	const listeners = new Set< Listener >();
	if ( options.onChange ) {
		listeners.add( options.onChange );
	}

	const orderedKeys = (): K[] =>
		options.order().filter( ( k ) => selected.has( k ) );

	const notify = (): void => {
		const snapshot = orderedKeys();
		for ( const cb of listeners ) {
			try {
				cb( snapshot );
			} catch ( err ) {
				// A misbehaving consumer must not strand the gesture —
				// the tiles are already painted by the time we get here.
				// eslint-disable-next-line no-console
				console.error( '[openstation] selection listener threw:', err );
			}
		}
	};

	/** Run `mutate`, notify only when the membership actually moved. */
	const commit = ( mutate: () => void ): void => {
		const before = selected.size;
		const beforeKeys = Array.from( selected );
		mutate();
		if (
			selected.size === before &&
			beforeKeys.every( ( k ) => selected.has( k ) )
		) {
			return;
		}
		notify();
	};

	return {
		keys: orderedKeys,
		has: ( key ) => selected.has( key ),
		size: () => selected.size,
		anchor: () => anchorKey,
		set( keys ) {
			commit( () => {
				selected.clear();
				for ( const k of keys ) {
					selected.add( k );
				}
			} );
			anchorKey = keys.length > 0 ? keys[ keys.length - 1 ] : null;
		},
		add( key ) {
			commit( () => {
				selected.add( key );
			} );
			anchorKey = key;
		},
		remove( key ) {
			commit( () => {
				selected.delete( key );
			} );
			if ( anchorKey === key ) {
				anchorKey = null;
			}
		},
		toggle( key ) {
			commit( () => {
				if ( selected.has( key ) ) {
					selected.delete( key );
				} else {
					selected.add( key );
				}
			} );
			anchorKey = key;
		},
		selectRange( key, additive = false ) {
			const all = options.order();
			const to = all.indexOf( key );
			const from = anchorKey === null ? -1 : all.indexOf( anchorKey );
			if ( to < 0 ) {
				return;
			}
			// No usable anchor (first click of the session, or the
			// anchor was deleted) — Shift+click behaves like a plain
			// click rather than doing nothing, which is what both
			// Finder and Explorer do.
			if ( from < 0 ) {
				commit( () => {
					if ( ! additive ) {
						selected.clear();
					}
					selected.add( key );
				} );
				anchorKey = key;
				return;
			}
			const lo = Math.min( from, to );
			const hi = Math.max( from, to );
			commit( () => {
				if ( ! additive ) {
					selected.clear();
				}
				for ( let i = lo; i <= hi; i += 1 ) {
					selected.add( all[ i ] );
				}
			} );
			// Anchor deliberately stays put — successive Shift+clicks
			// re-extend from the same origin instead of walking.
		},
		selectAll() {
			const all = options.order();
			commit( () => {
				for ( const k of all ) {
					selected.add( k );
				}
			} );
			if ( anchorKey === null && all.length > 0 ) {
				anchorKey = all[ 0 ];
			}
		},
		clear() {
			commit( () => {
				selected.clear();
			} );
			anchorKey = null;
		},
		prune() {
			const live = new Set( options.order() );
			let pruned = false;
			commit( () => {
				for ( const k of Array.from( selected ) ) {
					if ( ! live.has( k ) ) {
						selected.delete( k );
						pruned = true;
					}
				}
			} );
			if ( anchorKey !== null && ! live.has( anchorKey ) ) {
				anchorKey = null;
			}
			return pruned;
		},
		subscribe( cb ) {
			listeners.add( cb );
			return () => {
				listeners.delete( cb );
			};
		},
	};
}
