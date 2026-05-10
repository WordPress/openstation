/**
 * `createInfiniteList` — feed-reader scaffolding.
 *
 * Every infinite-scroll surface in the wild reaches for the same
 * five primitives: an `IntersectionObserver` on a sentinel below
 * the last row, an `AbortController` to cancel in-flight pages
 * when the filter changes, dedup-by-id so a refetch doesn't
 * duplicate visible rows, cursor pagination, and a "loading more"
 * indicator that doesn't fight the window-level loading spinner.
 *
 * This helper bundles all five so plugin authors stop reinventing
 * the same ~80 LOC of bookkeeping. The renderer is a callback —
 * intentionally not a Web Component — so plugin code keeps full
 * control over per-row markup, click handlers, animation, and
 * styling.
 *
 * Idiomatic shape:
 *
 * ```ts
 * const list = createInfiniteList< Post >( {
 *     root: document.querySelector( '#feed-root' )!,
 *     fetchPage: async ( cursor, signal ) => {
 *         const url =
 *             '/wp-json/myplugin/v1/feed?cursor=' +
 *             encodeURIComponent( cursor ?? '' );
 *         const res  = await wp.desktop.fetch( url, { signal } );
 *         const json = await res.json();
 *         return { items: json.items, nextCursor: json.next };
 *     },
 *     getId:      ( post ) => post.id,
 *     renderItem: ( post ) => {
 *         const li = document.createElement( 'li' );
 *         li.textContent = post.title;
 *         return li;
 *     },
 * } );
 *
 * // Re-fetch from scratch (e.g. filter changed).
 * list.reset();
 *
 * // Tear down — observer disconnects, in-flight aborts.
 * list.destroy();
 * ```
 *
 * @since 0.8.2
 */

export interface InfiniteListPage< TItem > {
	/** Items to append after dedup. */
	items: readonly TItem[];
	/**
	 * Cursor for the next page. `null` / `undefined` / `''` ends
	 * the list — the observer disconnects and `hasMore()` returns
	 * `false`.
	 */
	nextCursor?: string | null;
}

export interface InfiniteListOptions< TItem > {
	/**
	 * Element to append rendered items into. The helper appends
	 * children directly — wrap your own `<ul>` / `<ol>` / `<div>`
	 * if you want a list-semantics container.
	 */
	root: HTMLElement;
	/**
	 * Fetch one page. The `signal` aborts on `reset()` /
	 * `destroy()` — pass it through to `wp.desktop.fetch( url, {
	 * signal } )`. Throwing `AbortError` is fine; it's swallowed.
	 */
	fetchPage: (
		cursor: string | null,
		signal: AbortSignal,
	) => Promise< InfiniteListPage< TItem > >;
	/**
	 * Stable identity for an item. Used for dedup so a refetch
	 * that overlaps the visible window doesn't render the same
	 * row twice.
	 */
	getId: ( item: TItem ) => string | number;
	/**
	 * Build the DOM element for a single item. The element is
	 * appended verbatim; the helper does not own its lifecycle —
	 * register listeners and class names here. To re-render an
	 * item, drop and rebuild it (or hold a per-item reference and
	 * mutate yourself).
	 */
	renderItem: ( item: TItem, index: number ) => HTMLElement;
	/**
	 * Element observed for visibility. When it scrolls into view
	 * the helper requests the next page. Default: a hidden
	 * `<div>` appended after the rendered items, marked
	 * `data-wpd-infinite-list-sentinel`. Override when you need
	 * a different scroll geometry (custom load-more bar, in-row
	 * sentinel for grids).
	 */
	sentinel?: HTMLElement;
	/**
	 * Pixel margin around the scrollport for triggering early
	 * loads. Forwarded to the IntersectionObserver `rootMargin`.
	 * Default: `'200px'`.
	 */
	rootMargin?: string;
	/**
	 * Initial cursor — passed to the very first `fetchPage` call.
	 * Default `null`.
	 */
	initialCursor?: string | null;
	/**
	 * Called every time the loading-state changes. The helper
	 * fires it with `true` before each `fetchPage` call and
	 * `false` after it settles (success or error). Plugins use
	 * this to render their own "loading more" indicator that's
	 * separate from the window-level spinner. Default: no-op.
	 */
	onLoadingChange?: ( loading: boolean ) => void;
	/**
	 * Called when a fetch rejects with anything other than an
	 * abort. Plugins surface a toast / inline retry button from
	 * here. Default: `console.error`.
	 */
	onError?: ( err: unknown ) => void;
}

export interface InfiniteList {
	/** Re-fetch from `initialCursor`. Cancels any in-flight page. */
	reset(): void;
	/** Manually request the next page (rarely needed — the sentinel does it). */
	loadMore(): Promise< void >;
	/** `false` after a page returns a falsy `nextCursor`. */
	hasMore(): boolean;
	/** `true` while a `fetchPage` is in flight. */
	isLoading(): boolean;
	/** Disconnect observer, abort in-flight, clear rendered items. */
	destroy(): void;
}

/**
 * Build an infinite-scroll renderer. See {@link InfiniteListOptions}
 * for the full option shape and the module docstring for the
 * idiomatic recipe.
 *
 * @since 0.8.2
 */
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
				console.error( '[desktop-mode] createInfiniteList:', err );
			}
		},
	} = options;

	let sentinel = options.sentinel ?? null;
	if ( ! sentinel ) {
		sentinel = document.createElement( 'div' );
		sentinel.dataset.wpdInfiniteListSentinel = '';
		// Default visual: a 1px tall sentinel placed after the items.
		// Plugins that want a "Loading more…" affordance pass their
		// own element via `options.sentinel`.
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
				// Insert before the sentinel so it stays at the tail.
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
		// Abort any in-flight page so a slow response from the old
		// cursor doesn't append after the new content lands.
		controller?.abort();
		controller = null;
		seen.clear();
		cursor = initialCursor;
		hasMoreInternal = true;
		renderedCount = 0;
		// Clear rendered items but keep the sentinel where it was.
		const sentinelInRoot = sentinel && sentinel.parentNode === root;
		while ( root.firstChild ) {
			root.removeChild( root.firstChild );
		}
		if ( sentinelInRoot && sentinel ) {
			root.appendChild( sentinel );
		}
		setLoading( false );
		// Re-attach observer in case it disconnected at end-of-list.
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
		// Drop the sentinel we created. If the caller passed their
		// own sentinel, we leave it for them to manage.
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
