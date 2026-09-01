/**
 * App Framework — the infinitely scrolled, server-paginated list.
 *
 * Every list-shaped window does the same dance: accumulate the
 * server's pages (`Os::page()` envelopes), watch a sentinel with an
 * IntersectionObserver, load ONE page per scroll gesture, show
 * skeletons sized to the incoming page, and never deadlock a list too
 * short to scroll. The first app implemented all of it by hand —
 * ~120 lines the second list would have copied. `createPagedList()`
 * owns the dance; the app owns only what "load the next page" means.
 *
 * Usage, in a client view:
 *
 *   // in the ui bag:            list: createPagedList< Row >(),
 *   // in the view:              const rows = ui.list.accumulate( key, data.list );
 *   // in updated(), each paint: ui.list.sync( {
 *   //     sentinel: ctx.root.querySelector( '[data-my-sentinel]' ),
 *   //     canvas, // the scrolling element
 *   //     load: () => ctx.dispatch( 'more' ),
 *   //     repaint: () => ctx.repaint(),
 *   // } );
 *   // in mounted()'s teardown:  ui.list.dispose();
 *
 * The one-page-per-gesture protocol: the sentinel may only fire while
 * armed, firing disarms it, and a scroll on the canvas re-arms —
 * so a window parked at the bottom does NOT chain-load every
 * remaining page. A list shorter than its viewport can never scroll,
 * so while the canvas has no scrollbar the sentinel stays armed and
 * the list fills until it overflows; then gestures take over.
 *
 * @public
 */

/** The server's page envelope — what `Os::page()` builds. */
export interface PageEnvelope< T > {
	items: T[];
	total: number;
	pages: number;
	page: number;
	perPage: number;
}

export interface PagedList< T > {
	/**
	 * Fold the latest server page into the accumulated set and return
	 * every row, page order, deduped by id. Pages are kept per-number,
	 * so a refresh that re-fetches page N replaces exactly page N; a
	 * new key (section, query, sort — the list's identity) starts
	 * clean; `null` resets.
	 */
	accumulate( key: string, list: PageEnvelope< T > | null ): T[];
	/** Every accumulated row, without folding anything new in. */
	items(): T[];
	/** Total rows the server reports across all pages. */
	readonly total: number;
	/** Pages the server reports. */
	readonly pageCount: number;
	/** The page a load is fetching, 0 when none. */
	readonly loadingPage: number;
	/** Whether pages remain beyond the ones loaded. */
	hasMore(): boolean;
	/**
	 * How many skeleton placeholders to render for the incoming page —
	 * keyed on the page rather than an in-flight flag, so the paint
	 * that delivers the page never flashes a ghost block for the next.
	 */
	ghosts( perPage: number ): number;
	/**
	 * Re-wire the live DOM after a paint: aim the observer at the
	 * freshly rendered sentinel (the render may have replaced it),
	 * keep a scroll listener on the current canvas (scroll does not
	 * bubble, so delegation cannot hear it), and apply the short-list
	 * deadlock guard.
	 */
	sync( opts: {
		sentinel: Element | null;
		canvas: HTMLElement | null;
		load: () => Promise< unknown >;
		repaint: () => void;
	} ): void;
	dispose(): void;
}

export function createPagedList< T extends { id: number } >(): PagedList< T > {
	let cacheKey = '';
	const pages = new Map< number, T[] >();
	let total = 0;
	let pageCount = 1;
	let loadingPage = 0;
	let loading = false;
	let armed = true;
	let scrollEl: HTMLElement | null = null;
	let observer: IntersectionObserver | undefined;
	let load: () => Promise< unknown > = async () => undefined;
	let repaint: () => void = () => undefined;

	const items = (): T[] => {
		const out: T[] = [];
		const seen = new Set< number >();
		for ( const page of Array.from( pages.keys() ).sort( ( a, b ) => a - b ) ) {
			for ( const item of pages.get( page ) ?? [] ) {
				if ( ! seen.has( item.id ) ) {
					seen.add( item.id );
					out.push( item );
				}
			}
		}
		return out;
	};

	const hasMore = (): boolean => pageCount > Math.max( ...Array.from( pages.keys() ), 1 );

	const onIntersect = ( entries: IntersectionObserverEntry[] ): void => {
		if ( ! entries.some( ( entry ) => entry.isIntersecting ) || loading || ! armed ) {
			return;
		}
		armed = false;
		loading = true;
		loadingPage = Math.max( 1, ...Array.from( pages.keys() ) ) + 1;
		// Repaint now so the skeletons appear while the page loads.
		repaint();
		void load().finally( () => {
			loading = false;
			loadingPage = 0;
			repaint();
		} );
	};

	return {
		accumulate( key, list ) {
			if ( ! list ) {
				cacheKey = '';
				pages.clear();
				total = 0;
				pageCount = 1;
				return [];
			}
			if ( cacheKey !== key ) {
				cacheKey = key;
				pages.clear();
			}
			pages.set( list.page, list.items );
			total = list.total;
			pageCount = list.pages;
			return items();
		},
		items,
		get total() {
			return total;
		},
		get pageCount() {
			return pageCount;
		},
		get loadingPage() {
			return loadingPage;
		},
		hasMore,
		ghosts( perPage ) {
			if ( loadingPage === 0 || pages.has( loadingPage ) || ! hasMore() ) {
				return 0;
			}
			return Math.max( 1, Math.min( perPage, total - items().length ) );
		},
		sync( opts ) {
			load = opts.load;
			repaint = opts.repaint;
			if ( ! observer && typeof IntersectionObserver !== 'undefined' ) {
				observer = new IntersectionObserver( onIntersect );
			}
			observer?.disconnect();
			if ( opts.sentinel ) {
				observer?.observe( opts.sentinel );
			}
			if ( opts.canvas !== scrollEl ) {
				scrollEl = opts.canvas;
				scrollEl?.addEventListener(
					'scroll',
					() => {
						armed = true;
					},
					{ passive: true },
				);
			}
			// The deadlock guard: while the canvas has no scrollbar the
			// scroll-gesture re-arm can never fire, so stay armed.
			if ( scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight + 4 ) {
				armed = true;
			}
		},
		dispose() {
			observer?.disconnect();
			observer = undefined;
		},
	};
}
