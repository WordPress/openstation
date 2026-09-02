/**
 * The App Framework's infinitely scrolled list and selection math —
 * the machinery the first app hand-rolled and the framework now owns.
 * Accumulation semantics (per-page replacement, key resets, dedupe),
 * the one-page-per-gesture arming protocol with the short-list
 * deadlock guard, skeleton sizing, and modified-click selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applySelection,
	createMarquee,
	createPagedList,
	type PageEnvelope,
} from '@openstation/app';

interface Row {
	id: number;
}

function page( ids: number[], over: Partial< PageEnvelope< Row > > = {} ): PageEnvelope< Row > {
	return {
		items: ids.map( ( id ) => ( { id } ) ),
		total: ids.length,
		pages: 1,
		page: 1,
		perPage: 24,
		...over,
	};
}

describe( 'createPagedList', () => {
	it( 'appends pages in order and dedupes by id', () => {
		const list = createPagedList< Row >();
		list.accumulate( 'posts||', page( [ 1, 2 ], { pages: 2, page: 1, total: 3 } ) );
		const all = list.accumulate( 'posts||', page( [ 2, 3 ], { pages: 2, page: 2, total: 3 } ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 1, 2, 3 ] );
		expect( list.total ).toBe( 3 );
		expect( list.pageCount ).toBe( 2 );
	} );

	it( 'starts clean when the key (section, query, sort) changes', () => {
		const list = createPagedList< Row >();
		list.accumulate( 'posts||', page( [ 1 ] ) );
		const all = list.accumulate( 'posts|alpha|', page( [ 9 ] ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 9 ] );
	} );

	it( 'replaces exactly the re-fetched page on a watch refresh', () => {
		const list = createPagedList< Row >();
		list.accumulate( 'k', page( [ 1 ], { pages: 2, page: 1 } ) );
		list.accumulate( 'k', page( [ 2 ], { pages: 2, page: 2 } ) );
		const all = list.accumulate( 'k', page( [ 7 ], { pages: 2, page: 1 } ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 7, 2 ] );
	} );

	it( 'resets on null and answers hasMore()/ghosts() from the envelope', () => {
		const list = createPagedList< Row >();
		list.accumulate( 'k', page( [ 1, 2 ], { pages: 3, page: 1, total: 50 } ) );
		expect( list.hasMore() ).toBe( true );
		// Not loading: no ghosts.
		expect( list.ghosts( 24 ) ).toBe( 0 );
		expect( list.accumulate( 'k', null ) ).toEqual( [] );
		expect( list.total ).toBe( 0 );
		expect( list.hasMore() ).toBe( false );
	} );

	describe( 'the one-page-per-gesture protocol', () => {
		let intersect: ( entries: Array< { isIntersecting: boolean } > ) => void;
		const observed: Element[] = [];

		beforeEach( () => {
			observed.length = 0;
			vi.stubGlobal(
				'IntersectionObserver',
				class {
					constructor( cb: ( entries: Array< { isIntersecting: boolean } > ) => void ) {
						intersect = cb;
					}
					observe( el: Element ): void {
						observed.push( el );
					}
					disconnect(): void {
						observed.length = 0;
					}
				},
			);
		} );

		afterEach( () => {
			vi.unstubAllGlobals();
		} );

		function harness() {
			const list = createPagedList< Row >();
			list.accumulate( 'k', page( [ 1 ], { pages: 3, page: 1, total: 60 } ) );
			const sentinel = document.createElement( 'div' );
			const canvas = document.createElement( 'div' );
			// A canvas that scrolls (no deadlock guard interference).
			Object.defineProperty( canvas, 'scrollHeight', { value: 500, configurable: true } );
			Object.defineProperty( canvas, 'clientHeight', { value: 100, configurable: true } );
			const loads: number[] = [];
			let resolveLoad: () => void = () => undefined;
			const sync = () =>
				list.sync( {
					sentinel,
					canvas,
					load: () => {
						loads.push( list.loadingPage );
						return new Promise< void >( ( r ) => {
							resolveLoad = r;
						} );
					},
					repaint: () => undefined,
				} );
			sync();
			return { list, sentinel, canvas, loads, sync, done: () => resolveLoad() };
		}

		it( 'loads one page per gesture: firing disarms, a scroll re-arms', async () => {
			const h = harness();
			intersect( [ { isIntersecting: true } ] );
			expect( h.loads ).toEqual( [ 2 ] );
			h.done();
			await new Promise( ( r ) => setTimeout( r, 0 ) );
			// Still intersecting, but disarmed — no chain-load.
			intersect( [ { isIntersecting: true } ] );
			expect( h.loads ).toEqual( [ 2 ] );
			// The user scrolls: re-armed, the next page loads.
			h.canvas.dispatchEvent( new Event( 'scroll' ) );
			intersect( [ { isIntersecting: true } ] );
			expect( h.loads ).toEqual( [ 2, 2 ] );
		} );

		it( 'sizes ghosts to the incoming page while it is absent', () => {
			const h = harness();
			intersect( [ { isIntersecting: true } ] );
			expect( h.list.loadingPage ).toBe( 2 );
			expect( h.list.ghosts( 24 ) ).toBe( 24 );
			// The page landing zeroes the ghosts even before load resolves.
			h.list.accumulate( 'k', page( [ 2 ], { pages: 3, page: 2, total: 60 } ) );
			expect( h.list.ghosts( 24 ) ).toBe( 0 );
		} );

		it( 'keeps a too-short list armed so it fills until it scrolls', async () => {
			const h = harness();
			intersect( [ { isIntersecting: true } ] );
			h.done();
			await new Promise( ( r ) => setTimeout( r, 0 ) );
			// Disarmed — but the canvas has no scrollbar, so a re-sync
			// (the paint after the page landed) re-arms without a gesture.
			Object.defineProperty( h.canvas, 'scrollHeight', { value: 90, configurable: true } );
			h.sync();
			intersect( [ { isIntersecting: true } ] );
			expect( h.loads.length ).toBeGreaterThan( 1 );
		} );

		it( 'dispose() disconnects the observer', () => {
			const h = harness();
			expect( observed ).toContain( h.sentinel );
			h.list.dispose();
			expect( observed ).toHaveLength( 0 );
		} );
	} );
} );

describe( 'applySelection', () => {
	const order = [ 1, 2, 3, 4, 5 ];

	it( 'replaces on plain click, toggles on ctrl, ranges on shift', () => {
		expect( applySelection( [ 2 ], order, 4, {} ) ).toEqual( [ 4 ] );
		expect( applySelection( [ 2 ], order, 4, { ctrl: true } ) ).toEqual( [ 2, 4 ] );
		expect( applySelection( [ 2, 4 ], order, 4, { ctrl: true } ) ).toEqual( [ 2 ] );
		expect( applySelection( [ 2 ], order, 5, { shift: true } ) ).toEqual( [ 2, 3, 4, 5 ] );
		expect( applySelection( [ 4 ], order, 1, { shift: true } ) ).toEqual( [ 4, 1, 2, 3 ] );
	} );

	it( 'falls back to a plain selection when the anchor left the list', () => {
		expect( applySelection( [ 99 ], order, 3, { shift: true } ) ).toEqual( [ 3 ] );
	} );
} );

describe( 'createMarquee', () => {
	function rig() {
		const root = document.createElement( 'div' );
		root.innerHTML = `
			<div class="canvas">
				<div data-item-id="1"></div>
				<div data-item-id="2"></div>
			</div>
		`;
		document.body.appendChild( root );
		// jsdom has no layout: give each row a real box.
		const boxes: Record< string, DOMRect > = {
			'1': { left: 0, right: 50, top: 0, bottom: 50 } as DOMRect,
			'2': { left: 0, right: 50, top: 200, bottom: 250 } as DOMRect,
		};
		for ( const row of Array.from( root.querySelectorAll< HTMLElement >( '[data-item-id]' ) ) ) {
			row.getBoundingClientRect = () => boxes[ row.getAttribute( 'data-item-id' )! ];
		}
		const picks: number[][] = [];
		const teardown = createMarquee( {
			root,
			canvas: '.canvas',
			select: ( ids ) => picks.push( ids ),
		} );
		return { root, picks, teardown };
	}

	afterEach( () => {
		document.body.replaceChildren();
	} );

	it( 'draws from empty canvas, reports intersected ids, and cleans up', () => {
		const { root, picks, teardown } = rig();
		const canvas = root.querySelector( '.canvas' )!;
		// A press on a row never starts a marquee.
		root.querySelector( '[data-item-id="1"]' )!.dispatchEvent(
			new MouseEvent( 'pointerdown', { bubbles: true } ),
		);
		expect( document.body.querySelector( '.os-app__marquee' ) ).toBeNull();
		// A plain press on empty canvas clears, then the drag selects.
		canvas.dispatchEvent(
			new MouseEvent( 'pointerdown', { bubbles: true, clientX: 10, clientY: 60 } ),
		);
		expect( picks ).toEqual( [ [] ] );
		expect( document.body.querySelector( '.os-app__marquee' ) ).not.toBeNull();
		document.dispatchEvent(
			new MouseEvent( 'pointermove', { clientX: 40, clientY: 10 } ),
		);
		// The box spans y 10–60: row 1 (0–50) intersects, row 2 (200–250) does not.
		expect( picks.at( -1 ) ).toEqual( [ 1 ] );
		document.dispatchEvent( new MouseEvent( 'pointerup' ) );
		expect( document.body.querySelector( '.os-app__marquee' ) ).toBeNull();
		teardown();
	} );

	it( 'a modified press keeps the existing selection', () => {
		const { root, picks, teardown } = rig();
		root.querySelector( '.canvas' )!.dispatchEvent(
			new MouseEvent( 'pointerdown', { bubbles: true, ctrlKey: true, clientX: 5, clientY: 5 } ),
		);
		expect( picks ).toEqual( [] );
		teardown();
		expect( document.body.querySelector( '.os-app__marquee' ) ).toBeNull();
	} );
} );
