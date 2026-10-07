const NODE_KEY_PROP = '__openstationKeyedListKey';
const NODE_DATA_PROP = '__openstationKeyedListData';

export interface KeyedListOptions< T > {

	keyOf( item: T ): string | number;

	buildItem( item: T ): HTMLElement;

	updateItem?( el: HTMLElement, item: T, prevItem: T | null ): void;
}

interface IndexedNode {
	el: HTMLElement;
	data: unknown;
}

interface HostState {
	byKey: Map< string, IndexedNode >;
}

function getHostState( host: HTMLElement ): HostState {
	const cached = ( host as unknown as { __openstationKeyedList?: HostState } )
		.__openstationKeyedList;
	if ( cached ) {
		return cached;
	}
	const fresh: HostState = { byKey: new Map() };
	( host as unknown as { __openstationKeyedList?: HostState } ).__openstationKeyedList =
		fresh;
	return fresh;
}

export function renderKeyedList< T >(
	host: HTMLElement,
	items: readonly T[],
	opts: KeyedListOptions< T >,
): void {
	const state = getHostState( host );
	const prev = state.byKey;
	const next = new Map< string, IndexedNode >();

	const ordered: HTMLElement[] = [];
	const seenKeys = new Set< string >();
	for ( const item of items ) {
		const key = String( opts.keyOf( item ) );
		if ( seenKeys.has( key ) ) {
			console.warn(
				'[desktop-mode/keyed-list] duplicate key — only the last item with this key will render:',
				key,
			);
		}
		seenKeys.add( key );

		const reused = prev.get( key );
		if ( reused ) {
			const prevData = reused.data as T;
			opts.updateItem?.( reused.el, item, prevData );
			reused.data = item;
			next.set( key, reused );
			ordered.push( reused.el );
			continue;
		}
		const el = opts.buildItem( item );

		( el as unknown as Record< string, unknown > )[ NODE_KEY_PROP ] = key;
		( el as unknown as Record< string, unknown > )[ NODE_DATA_PROP ] = item;
		next.set( key, { el, data: item } );
		ordered.push( el );
	}

	for ( const [ key, entry ] of prev ) {
		if ( ! next.has( key ) ) {
			entry.el.remove();
		}
	}

	for ( let i = 0; i < ordered.length; i++ ) {
		const desired = ordered[ i ];
		const live = host.children[ i ] as HTMLElement | undefined;
		if ( live === desired ) {
			continue;
		}

		host.insertBefore( desired, live ?? null );
	}

	state.byKey = next;
}

export function clearKeyedList( host: HTMLElement ): void {
	const cached = ( host as unknown as { __openstationKeyedList?: HostState } )
		.__openstationKeyedList;
	if ( ! cached ) {
		return;
	}
	for ( const entry of cached.byKey.values() ) {
		entry.el.remove();
	}
	cached.byKey.clear();
	delete ( host as unknown as { __openstationKeyedList?: HostState } )
		.__openstationKeyedList;
}
