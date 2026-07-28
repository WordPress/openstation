/**
 * `createInfiniteList` tests — pin the contract that drives the
 * feed-reader scaffolding: cursor pagination, dedup-by-id, abort
 * on reset / destroy, end-of-list detachment, the loading
 * lifecycle indicator, and renderItem invocation order.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createInfiniteList, type InfiniteListPage } from '../../src/infinite-list';

interface Item {
	id: number;
	title: string;
}

/**
 * jsdom doesn't ship a real IntersectionObserver — install a
 * minimal stub that records observations + lets the tests trigger
 * intersection events programmatically.
 */
class FakeObserver {
	public elements = new Set< Element >();
	public callback: IntersectionObserverCallback;
	public options: IntersectionObserverInit | undefined;
	constructor( cb: IntersectionObserverCallback, opts?: IntersectionObserverInit ) {
		this.callback = cb;
		this.options = opts;
		FakeObserver.instances.push( this );
	}
	observe( el: Element ): void {
		this.elements.add( el );
	}
	unobserve( el: Element ): void {
		this.elements.delete( el );
	}
	disconnect(): void {
		this.elements.clear();
	}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
	root: Element | Document | null = null;
	rootMargin = '0px';
	thresholds: ReadonlyArray<number> = [];

	static instances: FakeObserver[] = [];
	static last(): FakeObserver {
		return this.instances[ this.instances.length - 1 ];
	}
	static reset(): void {
		this.instances = [];
	}
	static intersect( target: Element ): void {
		// Walk every active observer that's watching this target and
		// fire its callback synchronously with a single intersecting
		// entry.
		for ( const inst of this.instances ) {
			if ( inst.elements.has( target ) ) {
				const entry: IntersectionObserverEntry = {
					target,
					isIntersecting: true,
					intersectionRatio: 1,
					boundingClientRect: target.getBoundingClientRect(),
					intersectionRect: target.getBoundingClientRect(),
					rootBounds: null,
					time: performance.now(),
				};
				inst.callback( [ entry ], inst as unknown as IntersectionObserver );
			}
		}
	}
}

describe( 'createInfiniteList', () => {
	let root: HTMLElement;

	beforeEach( () => {
		FakeObserver.reset();
		( window as unknown as { IntersectionObserver: typeof FakeObserver } ).IntersectionObserver =
			FakeObserver;
		root = document.createElement( 'ul' );
		document.body.appendChild( root );
	} );

	afterEach( () => {
		root.remove();
	} );

	const buildItem = ( item: Item ): HTMLElement => {
		const li = document.createElement( 'li' );
		li.dataset.id = String( item.id );
		li.textContent = item.title;
		return li;
	};

	test( 'fires the first fetchPage call on mount and renders returned items', async () => {
		const list = createInfiniteList< Item >( {
			root,
			fetchPage: async () => ( {
				items: [ { id: 1, title: 'A' }, { id: 2, title: 'B' } ],
				nextCursor: null,
			} ),
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		// Drain the microtask + promise chain.
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const items = root.querySelectorAll( 'li' );
		expect( items.length ).toBe( 2 );
		expect( items[ 0 ].dataset.id ).toBe( '1' );
		expect( list.hasMore() ).toBe( false );
	} );

	test( 'cursor pagination — second sentinel intersection requests the next page', async () => {
		const fetchCalls: ( string | null )[] = [];
		const pages: Record< string, InfiniteListPage< Item > > = {
			start: { items: [ { id: 1, title: 'A' } ], nextCursor: 'p2' },
			p2:    { items: [ { id: 2, title: 'B' } ], nextCursor: null },
		};
		createInfiniteList< Item >( {
			root,
			fetchPage: async ( cursor ) => {
				fetchCalls.push( cursor );
				return pages[ cursor ?? 'start' ];
			},
			initialCursor: null,
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( fetchCalls ).toEqual( [ null ] );
		expect( root.querySelectorAll( 'li' ).length ).toBe( 1 );

		// Trigger the sentinel.
		const sentinel = root.querySelector< HTMLElement >(
			'[data-wpd-infinite-list-sentinel]',
		);
		expect( sentinel ).not.toBeNull();
		FakeObserver.intersect( sentinel! );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( fetchCalls ).toEqual( [ null, 'p2' ] );
		expect( root.querySelectorAll( 'li' ).length ).toBe( 2 );
	} );

	test( 'dedups by id across overlapping pages', async () => {
		const pages: InfiniteListPage< Item >[] = [
			{ items: [ { id: 1, title: 'A' }, { id: 2, title: 'B' } ], nextCursor: 'p2' },
			// Page 2 includes id=2 again (race / refetch overlap) — must NOT re-render.
			{ items: [ { id: 2, title: 'B' }, { id: 3, title: 'C' } ], nextCursor: null },
		];
		let cursorIdx = 0;
		createInfiniteList< Item >( {
			root,
			fetchPage: async () => pages[ cursorIdx++ ],
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const sentinel = root.querySelector< HTMLElement >(
			'[data-wpd-infinite-list-sentinel]',
		);
		FakeObserver.intersect( sentinel! );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const ids = Array.from( root.querySelectorAll< HTMLElement >( 'li' ) ).map(
			( el ) => el.dataset.id,
		);
		expect( ids ).toEqual( [ '1', '2', '3' ] );
	} );

	test( 'reset() aborts the in-flight page and re-fetches from the start', async () => {
		let resolveSlow: ( ( v: InfiniteListPage< Item > ) => void ) | null = null;
		let signalSeenAborted = false;
		const fetchPage = ( _c: string | null, signal: AbortSignal ): Promise< InfiniteListPage< Item > > => {
			if ( ! signalSeenAborted ) {
				return new Promise< InfiniteListPage< Item > >( ( resolve, reject ) => {
					resolveSlow = resolve;
					signal.addEventListener( 'abort', () => {
						signalSeenAborted = true;
						reject( new DOMException( 'aborted', 'AbortError' ) );
					} );
				} );
			}
			return Promise.resolve( {
				items: [ { id: 99, title: 'fresh' } ],
				nextCursor: null,
			} );
		};
		const list = createInfiniteList< Item >( {
			root,
			fetchPage,
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		// Don't drain — leave the first fetch pending.
		expect( list.isLoading() ).toBe( true );
		list.reset();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( signalSeenAborted ).toBe( true );

		// The caller's ignored slow page must NOT land — even if it
		// resolves later, the controller has changed and the page
		// is dropped.
		resolveSlow?.( {
			items: [ { id: 1, title: 'stale' } ],
			nextCursor: 'never',
		} );

		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const ids = Array.from( root.querySelectorAll< HTMLElement >( 'li' ) ).map(
			( el ) => el.dataset.id,
		);
		expect( ids ).toEqual( [ '99' ] );
	} );

	test( 'destroy() disconnects observer + aborts in-flight + unmounts sentinel', async () => {
		let aborted = false;
		const list = createInfiniteList< Item >( {
			root,
			fetchPage: ( _c, signal ) =>
				new Promise< InfiniteListPage< Item > >( ( _resolve, reject ) => {
					signal.addEventListener( 'abort', () => {
						aborted = true;
						reject( new DOMException( 'aborted', 'AbortError' ) );
					} );
				} ),
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		list.destroy();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( aborted ).toBe( true );
		expect( root.querySelector( '[data-wpd-infinite-list-sentinel]' ) ).toBeNull();
		// hasMore stays true because we never reached end-of-list, but
		// loadMore is a no-op after destroy — exercising it should not
		// throw and not flip the loading state.
		await list.loadMore();
		expect( list.isLoading() ).toBe( false );
	} );

	test( 'fires onLoadingChange around each fetch', async () => {
		const transitions: boolean[] = [];
		createInfiniteList< Item >( {
			root,
			fetchPage: async () => ( {
				items: [ { id: 1, title: 'A' } ],
				nextCursor: null,
			} ),
			getId: ( i ) => i.id,
			renderItem: buildItem,
			onLoadingChange: ( v ) => transitions.push( v ),
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( transitions ).toEqual( [ true, false ] );
	} );

	test( 'reaches end-of-list and stops requesting pages even when sentinel re-intersects', async () => {
		let calls = 0;
		createInfiniteList< Item >( {
			root,
			fetchPage: async () => {
				calls++;
				return { items: [ { id: 1, title: 'A' } ], nextCursor: null };
			},
			getId: ( i ) => i.id,
			renderItem: buildItem,
		} );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( calls ).toBe( 1 );
		// Sentinel was removed from the observer when nextCursor was null —
		// FakeObserver.intersect should be a no-op now.
		const sentinel = root.querySelector< HTMLElement >(
			'[data-wpd-infinite-list-sentinel]',
		);
		if ( sentinel ) FakeObserver.intersect( sentinel );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( calls ).toBe( 1 );
	} );
} );
