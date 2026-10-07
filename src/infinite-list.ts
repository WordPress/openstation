export interface InfiniteListPage< TItem > {

	items: readonly TItem[];

	nextCursor?: string | null;
}

export interface InfiniteListOptions< TItem > {

	root: HTMLElement;

	fetchPage: (
		cursor: string | null,
		signal: AbortSignal,
	) => Promise< InfiniteListPage< TItem > >;

	getId: ( item: TItem ) => string | number;

	renderItem: ( item: TItem, index: number ) => HTMLElement;

	sentinel?: HTMLElement;

	rootMargin?: string;

	initialCursor?: string | null;

	onLoadingChange?: ( loading: boolean ) => void;

	onError?: ( err: unknown ) => void;
}

export interface InfiniteList {

	reset(): void;

	loadMore(): Promise< void >;

	hasMore(): boolean;

	isLoading(): boolean;

	destroy(): void;
}

export function createInfiniteList< TItem >(
	options: InfiniteListOptions< TItem >,
): InfiniteList {
	const {
		root,
		fetchPage,
		getId,
		renderItem,
		rootMargin = '200px',
		initialCursor = null,
		onLoadingChange = () => undefined,
		onError = ( err: unknown ) => {
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] createInfiniteList:', err );
			}
		},
	} = options;

	let sentinel = options.sentinel ?? null;
	if ( ! sentinel ) {
		sentinel = document.createElement( 'div' );
		sentinel.dataset.osInfiniteListSentinel = '';

		sentinel.style.height = '1px';
		root.appendChild( sentinel );
	}

	const seen = new Set< string >();
	let cursor: string | null = initialCursor;
	let hasMoreInternal = true;
	let loading = false;
	let controller: AbortController | null = null;
	let renderedCount = 0;
	let destroyed = false;
	let observer: IntersectionObserver | null = null;

	const setLoading = ( next: boolean ): void => {
		if ( loading === next ) {
			return;
		}
		loading = next;
		try {
			onLoadingChange( next );
		} catch ( err ) {
			onError( err );
		}
	};

	const detachObserver = (): void => {
		if ( observer ) {
			observer.disconnect();
			observer = null;
		}
	};

	const ensureObserver = (): void => {
		if ( observer || ! sentinel || destroyed ) {
			return;
		}
		observer = new IntersectionObserver(
			( entries ) => {
				for ( const entry of entries ) {
					if ( entry.isIntersecting ) {
						void loadMore();
					}
				}
			},
			{ rootMargin },
		);
		observer.observe( sentinel );
	};

	const loadMore = async (): Promise< void > => {
		if ( destroyed || loading || ! hasMoreInternal ) {
			return;
		}
		setLoading( true );
		controller = new AbortController();
		const localController = controller;
		try {
			const page = await fetchPage( cursor, localController.signal );
			if ( destroyed || localController !== controller ) {
				return;
			}
			let appended = 0;
			const frag = document.createDocumentFragment();
			for ( const item of page.items ?? [] ) {
				const key = String( getId( item ) );
				if ( seen.has( key ) ) {
					continue;
				}
				seen.add( key );
				const el = renderItem( item, renderedCount + appended );
				frag.appendChild( el );
				appended++;
			}
			if ( appended > 0 ) {
				if ( sentinel && sentinel.parentNode === root ) {
					root.insertBefore( frag, sentinel );
				} else {
					root.appendChild( frag );
				}
				renderedCount += appended;
			}
			cursor = page.nextCursor ?? null;
			if ( ! cursor ) {
				hasMoreInternal = false;
				detachObserver();
			}
		} catch ( err ) {
			if ( ( err as DOMException )?.name === 'AbortError' ) {
				return;
			}
			onError( err );
		} finally {
			if ( localController === controller ) {
				setLoading( false );
				controller = null;
			}
		}
	};

	const reset = (): void => {
		if ( destroyed ) {
			return;
		}

		controller?.abort();
		controller = null;
		seen.clear();
		cursor = initialCursor;
		hasMoreInternal = true;
		renderedCount = 0;

		const sentinelInRoot = sentinel && sentinel.parentNode === root;
		while ( root.firstChild ) {
			root.removeChild( root.firstChild );
		}
		if ( sentinelInRoot && sentinel ) {
			root.appendChild( sentinel );
		}
		setLoading( false );

		ensureObserver();
		void loadMore();
	};

	const destroy = (): void => {
		if ( destroyed ) {
			return;
		}
		destroyed = true;
		detachObserver();
		controller?.abort();
		controller = null;

		if ( ! options.sentinel && sentinel && sentinel.parentNode === root ) {
			root.removeChild( sentinel );
		}
		sentinel = null;
		setLoading( false );
	};

	ensureObserver();
	void loadMore();

	return {
		reset,
		loadMore,
		hasMore: () => hasMoreInternal,
		isLoading: () => loading,
		destroy,
	};
}
