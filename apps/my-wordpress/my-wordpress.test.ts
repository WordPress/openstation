/**
 * My WordPress — the client half: selection math, page accumulation,
 * preview-action scoping, and one render of the view into jsdom.
 */
import { describe, expect, it } from 'vitest';
import app, {
	accumulate,
	applySelection,
	listKey,
	resolveActions,
	type AppData,
	type AppState,
	type ListItem,
	type ListPage,
	type PreviewAction,
	type SectionDef,
} from './my-wordpress.os';

function item( over: Partial< ListItem > ): ListItem {
	return {
		id: 1,
		title: 'Alpha',
		subtitle: 'Admin — today',
		status: 'publish',
		thumb: '',
		link: 'https://example.test/alpha',
		mime: '',
		lockedBy: '',
		canEdit: true,
		canDelete: true,
		...over,
	};
}

function page( items: ListItem[], over: Partial< ListPage > = {} ): ListPage {
	return { items, total: items.length, pages: 1, page: 1, ...over };
}

function section( over: Partial< SectionDef > = {} ): SectionDef {
	return {
		id: 'posts',
		label: 'Posts',
		icon: 'dashicons-admin-post',
		kind: 'post',
		post_type: 'post',
		thumbnails: true,
		count: 3,
		...over,
	};
}

function state( over: Partial< AppState > = {} ): AppState {
	return { group: '', section: '', item: 0, query: '', page: 1, sort: '', selected: [], ...over };
}

function data( over: Partial< AppData > = {} ): AppData {
	return {
		siteName: 'Test Site',
		sections: [ section() ],
		groups: [],
		sortOptions: { default: 'Newest first', oldest: 'Oldest first' },
		list: null,
		detail: null,
		previewActions: [],
		...over,
	};
}

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

describe( 'accumulate', () => {
	function ui() {
		return { cacheKey: '', pages: new Map< number, ListItem[] >(), total: 0, pageCount: 1 };
	}

	it( 'appends pages in order and dedupes by id', () => {
		const cache = ui();
		const key = listKey( state( { section: 'posts' } ) );
		accumulate( cache, key, page( [ item( { id: 1 } ), item( { id: 2 } ) ], { pages: 2, page: 1, total: 3 } ) );
		const all = accumulate( cache, key, page( [ item( { id: 2 } ), item( { id: 3 } ) ], { pages: 2, page: 2, total: 3 } ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 1, 2, 3 ] );
		expect( cache.total ).toBe( 3 );
	} );

	it( 'starts clean when the section, query or sort changes', () => {
		const cache = ui();
		accumulate( cache, 'posts||', page( [ item( { id: 1 } ) ] ) );
		const all = accumulate( cache, 'posts|alpha|', page( [ item( { id: 9 } ) ] ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 9 ] );
	} );

	it( 'replaces exactly the re-fetched page on a watch refresh', () => {
		const cache = ui();
		const key = 'posts||';
		accumulate( cache, key, page( [ item( { id: 1 } ) ], { pages: 2, page: 1 } ) );
		accumulate( cache, key, page( [ item( { id: 2 } ) ], { pages: 2, page: 2 } ) );
		const all = accumulate( cache, key, page( [ item( { id: 7 } ) ], { pages: 2, page: 1 } ) );
		expect( all.map( ( i ) => i.id ) ).toEqual( [ 7, 2 ] );
	} );
} );

describe( 'resolveActions', () => {
	const ctx = {
		entityId: 'cpt-atf-forms',
		kind: 'post',
		postType: 'atf-forms',
		mime: undefined,
		item: {},
		itemId: 7,
		surface: 'pane' as const,
	};

	it( 'scopes by section id, post type slug, and the wildcard', () => {
		const actions: PreviewAction[] = [
			{ id: 'a', label: 'A', sections: [ 'cpt-atf-forms' ] },
			{ id: 'b', label: 'B', sections: [ 'atf-forms' ] },
			{ id: 'c', label: 'C', sections: [ '*' ] },
			{ id: 'd', label: 'D', sections: [ 'media' ] },
			{ id: 'e', label: 'E' },
		];
		expect( resolveActions( actions, ctx ).map( ( a ) => a.id ) ).toEqual( [ 'a', 'b', 'c', 'e' ] );
	} );

	it( 'fails MIME-scoped actions closed outside a media context', () => {
		const actions: PreviewAction[] = [ { id: 'img', label: 'I', mime: '^image/' } ];
		expect( resolveActions( actions, ctx ) ).toEqual( [] );
		expect( resolveActions( actions, { ...ctx, mime: 'image/png' } ) ).toHaveLength( 1 );
	} );

	it( 'runs the shared WP Explorer JS filter over the scoped set', () => {
		const hooks = {
			applyFilters: ( _hook: string, value: unknown ) => [
				...( value as PreviewAction[] ),
				{ id: 'injected', label: 'From a plugin' },
			],
		};
		const out = resolveActions( [], ctx, hooks );
		expect( out.map( ( a ) => a.id ) ).toEqual( [ 'injected' ] );
	} );
} );

describe( 'view', () => {
	function mount( s: AppState, d: AppData ): HTMLElement {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		app.render( {
			state: s,
			data: d,
			root,
			dispatch: async () => true,
			local: () => undefined,
		} );
		return root;
	}

	it( 'paints the root grid with counted tiles and group folders', () => {
		const root = mount(
			state(),
			data( {
				sections: [
					section(),
					section( { id: 'cpt-product', label: 'Products', post_type: 'product', count: 4, group: 'woo' } ),
				],
				groups: [ { id: 'woo', label: 'Woo', icon: 'dashicons-cart', order: 5 } ],
			} ),
		);
		expect( root.textContent ).toContain( 'Posts · 3' );
		expect( root.textContent ).toContain( 'Woo · 4' );
		expect( root.textContent ).not.toContain( 'Products · 4' );
		expect( root.textContent ).toContain( '2 folders' );
	} );

	it( 'paints the list with lock badges, selection and the bulk bar', () => {
		const root = mount(
			state( { section: 'posts', selected: [ 2 ] } ),
			data( {
				list: page( [
					item( { id: 1, title: 'Alpha' } ),
					item( { id: 2, title: 'Beta', lockedBy: 'Ada' } ),
				] ),
			} ),
		);
		expect( root.textContent ).toContain( 'Alpha' );
		expect( root.textContent ).toContain( '🔒 Ada' );
		expect( root.querySelector( '[data-item-id="2"]' )?.className ).toContain( 'is-selected' );
		expect( root.textContent ).toContain( '1 selected' );
		expect( root.querySelector( '[os-action="bulk-trash"]' ) ).not.toBeNull();
	} );

	it( 'paints the detail pane beside the list with facts and actions', () => {
		const root = mount(
			state( { section: 'posts', item: 1 } ),
			data( {
				list: page( [ item( { id: 1 } ) ] ),
				detail: {
					kind: 'post',
					id: 1,
					title: 'Alpha',
					facts: [ [ 'Status', 'Publish' ], [ 'Author', 'Admin' ] ],
					canEdit: true,
					canDelete: true,
					content: '<p>Body</p>',
				},
			} ),
		);
		expect( root.querySelector( '.os-mywp__detail-pane' ) ).not.toBeNull();
		expect( root.querySelector( '.os-mywp__list' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Status' );
		expect( root.querySelector( '[os-action="trash"]' ) ).not.toBeNull();
		expect( root.querySelector( '[data-mywp-content]' ) ).not.toBeNull();
	} );

	it( 'local selection actions reduce without a request', () => {
		expect( app.hasLocal( 'select' ) ).toBe( true );
		expect( app.hasLocal( 'trash' ) ).toBe( false );
		const next = app.runLocal(
			'select',
			state( { selected: [ 1 ] } ),
			{ item: 3, ctrl: true, order: [ 1, 2, 3 ] },
			data(),
		);
		expect( next.selected ).toEqual( [ 1, 3 ] );
	} );
} );
