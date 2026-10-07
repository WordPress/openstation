export interface SelectionModelOptions< K > {

	order: () => K[];

	onChange?: ( keys: K[] ) => void;
}

export interface SelectionModel< K > {

	keys: () => K[];
	has: ( key: K ) => boolean;
	size: () => number;

	anchor: () => K | null;

	set: ( keys: readonly K[] ) => void;
	add: ( key: K ) => void;
	remove: ( key: K ) => void;

	toggle: ( key: K ) => void;

	selectRange: ( key: K, additive?: boolean ) => void;
	selectAll: () => void;
	clear: () => void;

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
				console.error( '[openstation] selection listener threw:', err );
			}
		}
	};

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
