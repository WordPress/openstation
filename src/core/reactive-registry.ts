/**
 * Generic reactive registry factory.
 *
 * **Why this exists.** Across the plugin, ~22 modules implement the
 * same pattern by hand: a seed array (or Map), `register()` /
 * `unregister()` helpers, a Set of listeners, and a `notify()`
 * function. Wallpapers, settings tabs, dock-rail renderers, window
 * themes, window controls, window slots, window chrome,
 * title-bar buttons, commands, palettes — all the same shape with
 * cosmetic differences. Each copy reinvents the snapshot-during-
 * iteration discipline, the late-registration replace semantics,
 * the throw-isolation around listener errors, and (for cross-
 * bundle features) the `createSharedStore` plumbing.
 *
 * **What this provides.** A single `createReactiveRegistry< T >`
 * factory. Pass a stable key + an extractor that pulls the id out
 * of an entry; you get back `register`, `unregister`, `get`, `all`,
 * `subscribe`, and `reset`. Backed by `createSharedStore` so the
 * registry survives bundle boundaries — registering an entry from
 * the main shell and reading it from a feature bundle just works.
 *
 * **What this does NOT do.** It does not apply WordPress filters.
 * Registries that want a `desktop-mode.<thing>` filter chain on
 * read should compose: call `all()` on the registry, then run
 * `applyFilters( HOOK_ID, list )` themselves. The filter contract
 * is feature-specific (some flatten, some reorder, some swap) so
 * baking it into the primitive would either bloat it or constrain
 * callers. The wallpapers registry is the canonical example of
 * that composition shape.
 *
 * @since 0.8.1
 */

import { createSharedStore } from '../shared-store';

/**
 * Public surface returned by {@link createReactiveRegistry}.
 *
 * Generic over the entry shape `T`. Callers supply an `idOf`
 * extractor when they create the registry; everything keys off
 * that.
 */
export interface ReactiveRegistry< T > {
	/**
	 * Register an entry. Late registrations with an existing id
	 * REPLACE rather than duplicate — matches WordPress's
	 * `register_*` semantics. Fires every subscriber after the
	 * mutation.
	 */
	register( entry: T ): void;
	/** Remove an entry by id. No-op if no such id is registered. */
	unregister( id: string ): void;
	/** Look up a single entry by id. */
	get( id: string ): T | undefined;
	/** Snapshot of every registered entry (insertion order). */
	all(): T[];
	/**
	 * Subscribe to mutations. Listener is called with no arguments
	 * (poll {@link all} from inside) and any throw is logged + swallowed
	 * so one bad listener can't strand the rest. Returns an
	 * unsubscribe function.
	 */
	subscribe( listener: () => void ): () => void;
	/**
	 * Drop every entry and every subscriber. Mainly for tests.
	 */
	reset(): void;
}

/** Internal slot shape held in the cross-bundle shared store. */
interface RegistryState< T > {
	/** Insertion-ordered list of entries; replaced in-place on register. */
	entries: T[];
}

export interface CreateReactiveRegistryOptions< T > {
	/** Stable id used as the shared-store key. Namespace it (`'desktop-mode/<thing>'`). */
	key: string;
	/** Pure function extracting the entry id used for replace + lookup. */
	idOf: ( entry: T ) => string;
	/** Optional pre-register validator — return an array of error strings to abort. */
	validate?: ( entry: T ) => string[] | undefined;
	/** Optional label used in console errors. Defaults to the key. */
	label?: string;
}

/**
 * Create a reactive registry.
 *
 * @param opts See {@link CreateReactiveRegistryOptions}.
 * @return Registry handle.
 */
export function createReactiveRegistry< T >(
	opts: CreateReactiveRegistryOptions< T >,
): ReactiveRegistry< T > {
	const { key, idOf, validate, label = key } = opts;
	const store = createSharedStore< RegistryState< T > >( key, () => ( {
		entries: [],
	} ) );

	const listeners = new Set<() => void >();

	function notify(): void {
		// Snapshot — listeners may unsubscribe themselves or each other.
		for ( const cb of Array.from( listeners ) ) {
			try {
				cb();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[desktop-mode/registry:${ label }] listener threw:`,
						err,
					);
				}
			}
		}
	}

	function register( entry: T ): void {
		if ( validate ) {
			const errors = validate( entry );
			if ( errors && errors.length > 0 ) {
				throw new Error(
					`[desktop-mode/registry:${ label }] invalid entry: ${ errors.join(
						'; ',
					) }`,
				);
			}
		}
		const id = idOf( entry );
		const list = store.state.entries;
		const idx = list.findIndex( ( e ) => idOf( e ) === id );
		if ( idx >= 0 ) {
			list[ idx ] = entry;
		} else {
			list.push( entry );
		}
		store.notify();
		notify();
	}

	function unregister( id: string ): void {
		const list = store.state.entries;
		const idx = list.findIndex( ( e ) => idOf( e ) === id );
		if ( idx < 0 ) {
			return;
		}
		list.splice( idx, 1 );
		store.notify();
		notify();
	}

	function get( id: string ): T | undefined {
		return store.state.entries.find( ( e ) => idOf( e ) === id );
	}

	function all(): T[] {
		return store.state.entries.slice();
	}

	function subscribe( listener: () => void ): () => void {
		listeners.add( listener );
		return () => {
			listeners.delete( listener );
		};
	}

	function reset(): void {
		store.state.entries.length = 0;
		listeners.clear();
		store.notify();
	}

	return { register, unregister, get, all, subscribe, reset };
}
