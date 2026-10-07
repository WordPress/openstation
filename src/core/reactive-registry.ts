import { createSharedStore } from '../shared-store';

export interface ReactiveRegistry< T > {

	register( entry: T ): void;

	unregister( id: string ): void;

	get( id: string ): T | undefined;

	all(): T[];

	subscribe( listener: () => void ): () => void;

	reset(): void;
}

interface RegistryState< T > {

	entries: T[];
}

export interface CreateReactiveRegistryOptions< T > {

	key: string;

	idOf: ( entry: T ) => string;

	validate?: ( entry: T ) => string[] | undefined;

	label?: string;
}

export function createReactiveRegistry< T >(
	opts: CreateReactiveRegistryOptions< T >,
): ReactiveRegistry< T > {
	const { key, idOf, validate, label = key } = opts;
	const store = createSharedStore< RegistryState< T > >( key, () => ( {
		entries: [],
	} ) );

	const listeners = new Set<() => void >();

	function notify(): void {
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
