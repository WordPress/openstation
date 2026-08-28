/**
 * Content Graph — board notice contract.
 *
 * `deriveBoardNotice` decides what a sparse board says; the renderer
 * paints exactly one notice at a time and reuses the house
 * `<os-empty-state>` for the empty cases. Copy is asserted by shape
 * (heading present, mentions threads) rather than verbatim so a
 * wording pass doesn't have to touch the tests.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
	BOARD_EMPTY_CLASS,
	BOARD_HINT_CLASS,
	deriveBoardNotice,
	renderBoardNotice,
} from '../../src/content-graph/board-notice';

const TYPES = [
	{ slug: 'post', count: 2 },
	{ slug: 'page', count: 0 },
	{ slug: 'product', count: 5 },
];

describe( 'deriveBoardNotice', () => {
	test( 'a threaded board needs no notice', () => {
		expect(
			deriveBoardNotice( {
				nodes: 3,
				edges: 1,
				types: TYPES,
				activeTypes: [ 'post', 'page', 'product' ],
			} ),
		).toEqual( { kind: 'none' } );
	} );

	test( 'nodes without a single thread get the explainer', () => {
		expect(
			deriveBoardNotice( {
				nodes: 2,
				edges: 0,
				types: TYPES,
				activeTypes: [ 'post' ],
			} ),
		).toEqual( { kind: 'no-threads' } );
		// One lone node counts too — there is nothing for it to link to.
		expect(
			deriveBoardNotice( {
				nodes: 1,
				edges: 0,
				types: TYPES,
				activeTypes: [ 'post' ],
			} ),
		).toEqual( { kind: 'no-threads' } );
	} );

	test( 'an empty board on an empty site says so', () => {
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: [
					{ slug: 'post', count: 0 },
					{ slug: 'page', count: 0 },
				],
				activeTypes: [ 'post', 'page' ],
			} ),
		).toEqual( { kind: 'no-content' } );
	} );

	test( 'an empty board with content hidden by the chips blames the chips', () => {
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: TYPES,
				activeTypes: [ 'page' ],
			} ),
		).toEqual( { kind: 'filtered-out' } );
	} );

	test( 'every chip off is its own message', () => {
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: TYPES,
				activeTypes: [],
			} ),
		).toEqual( { kind: 'all-off' } );
	} );

	test( 'unknown counts (the config list) assume a hidden type has content', () => {
		// `/post-types` failed: no descriptor carries a count. A
		// switched-off type is then assumed to hold content, so the
		// board blames the chips rather than claiming the site is empty.
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: [ { slug: 'post' }, { slug: 'page' } ],
				activeTypes: [ 'post' ],
			} ),
		).toEqual( { kind: 'filtered-out' } );
		// …but with every type on, an empty board is an empty site.
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: [ { slug: 'post' }, { slug: 'page' } ],
				activeTypes: [ 'post', 'page' ],
			} ),
		).toEqual( { kind: 'no-content' } );
	} );

	test( 'known zero counts on hidden types still read as an empty site', () => {
		expect(
			deriveBoardNotice( {
				nodes: 0,
				edges: 0,
				types: [
					{ slug: 'post', count: 0 },
					{ slug: 'page', count: 0 },
				],
				activeTypes: [ 'post' ],
			} ),
		).toEqual( { kind: 'no-content' } );
	} );
} );

describe( 'renderBoardNotice', () => {
	let host: HTMLElement;

	afterEach( () => {
		host?.remove();
	} );

	function mount() {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
		return renderBoardNotice( host );
	}

	test( 'registers <os-empty-state> for this bundle', () => {
		expect( customElements.get( 'os-empty-state' ) ).toBeDefined();
	} );

	test( 'paints nothing for kind none', () => {
		const handle = mount();
		handle.set( { kind: 'none' } );
		expect( host.children ).toHaveLength( 0 );
	} );

	test( 'the empty cases use <os-empty-state> with a heading and copy', () => {
		const handle = mount();
		handle.set( { kind: 'no-content' } );
		const el = host.querySelector( `.${ BOARD_EMPTY_CLASS }` );
		expect( el?.tagName.toLowerCase() ).toBe( 'os-empty-state' );
		expect( el?.getAttribute( 'heading' ) ).toBeTruthy();
		expect( el?.getAttribute( 'description' ) ).toMatch( /thread/i );
		expect( el?.getAttribute( 'icon' ) ).toBeTruthy();

		handle.set( { kind: 'filtered-out' } );
		const filtered = host.querySelectorAll( `.${ BOARD_EMPTY_CLASS }` );
		expect( filtered ).toHaveLength( 1 );
		expect( filtered[ 0 ].getAttribute( 'description' ) ).toMatch( /toolbar/i );

		handle.set( { kind: 'all-off' } );
		const off = host.querySelectorAll( `.${ BOARD_EMPTY_CLASS }` );
		expect( off ).toHaveLength( 1 );
		expect( off[ 0 ].getAttribute( 'heading' ) ).toMatch( /switched off/i );
	} );

	test( 'the no-threads note says what a thread is and where the rest lives', () => {
		const handle = mount();
		handle.set( { kind: 'no-threads' } );
		const el = host.querySelector< HTMLElement >( `.${ BOARD_HINT_CLASS }` );
		expect( el ).not.toBeNull();
		expect( el?.getAttribute( 'role' ) ).toBe( 'note' );
		const text = el?.textContent ?? '';
		expect( text ).toMatch( /thread/i );
		expect( text ).toMatch( /links/i );
		// Names the relationships that appear on focus and the Group by
		// facets as the toolbar labels them.
		expect( text ).toMatch( /author/i );
		expect( text ).toMatch( /categor/i );
		expect( text ).toMatch( /year/i );
		expect( host.querySelector( `.${ BOARD_EMPTY_CLASS }` ) ).toBeNull();
	} );

	test( 'only one notice is ever on the stage', () => {
		const handle = mount();
		handle.set( { kind: 'no-threads' } );
		handle.set( { kind: 'no-content' } );
		handle.set( { kind: 'no-threads' } );
		expect( host.children ).toHaveLength( 1 );
		expect( host.firstElementChild?.className ).toBe( BOARD_HINT_CLASS );
	} );

	test( 'setting the same kind twice leaves the DOM alone', () => {
		const handle = mount();
		handle.set( { kind: 'no-threads' } );
		const first = host.firstElementChild;
		handle.set( { kind: 'no-threads' } );
		expect( host.firstElementChild ).toBe( first );
	} );

	test( 'suppression hides the note but not an empty state, and remembers', () => {
		const handle = mount();
		handle.set( { kind: 'no-threads' } );
		handle.setSuppressed( true );
		expect( host.children ).toHaveLength( 0 );
		// A grouping change while suppressed must not lose the notice.
		handle.set( { kind: 'no-threads' } );
		expect( host.children ).toHaveLength( 0 );
		handle.setSuppressed( false );
		expect( host.querySelector( `.${ BOARD_HINT_CLASS }` ) ).not.toBeNull();
		// Empty-board states stay visible whatever the grouping.
		handle.setSuppressed( true );
		handle.set( { kind: 'no-content' } );
		expect( host.querySelector( `.${ BOARD_EMPTY_CLASS }` ) ).not.toBeNull();
	} );

	test( 'destroy removes whatever is showing', () => {
		const handle = mount();
		handle.set( { kind: 'no-content' } );
		handle.destroy();
		expect( host.children ).toHaveLength( 0 );
	} );
} );
