export interface PageEnvelope< T > {
	items: T[];
	total: number;
	pages: number;
	page: number;
	perPage: number;
}

export interface PagedList< T > {

	accumulate( key: string, list: PageEnvelope< T > | null ): T[];

	items(): T[];

	readonly total: number;

	readonly pageCount: number;

	readonly loadingPage: number;

	hasMore(): boolean;

	ghosts( perPage: number ): number;

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
