/**
 * My WordPress — the client half: selection math, page accumulation,
 * preview-action scoping, and one render of the view into jsdom.
 */
import { describe, expect, it } from 'vitest';
import app, {
	accumulate,
	applySelection,
	buildMenuOptions,
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
	return { items, total: items.length, pages: 1, page: 1, perPage: 24, ...over };
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
	return {
		group: '',
		section: '',
		item: 0,
		into: 0,
		relation: '',
		query: '',
		page: 1,
		sort: '',
		selected: [],
		...over,
	};
}

function data( over: Partial< AppData > = {} ): AppData {
	return {
		siteName: 'Test Site',
		sections: [ section() ],
		groups: [],
		sortOptions: { default: 'Newest first', oldest: 'Oldest first' },
		list: null,
		detail: null,
		folder: null,
		sub: null,
		subDetail: null,
		authors: [],
		categories: [],
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

describe( 'buildMenuOptions', () => {
	it( 'matches the WP Explorer menu, in its order', () => {
		const labels = buildMenuOptions(
			section(),
			item( { status: 'draft' } ),
			[ { id: 'send-pdf', label: 'Export PDF' } ],
		).map( ( o ) => o.label );
		expect( labels ).toEqual( [
			'Open in editor',
			'Navigate into',
			'Edit…',
			'Publish',
			'Copy link',
			'Move to Trash',
			'Export PDF',
		] );
	} );

	it( 'drops Publish for published items and gates Trash on the meta capability', () => {
		const published = buildMenuOptions( section(), item( { status: 'publish', canDelete: false } ), [] );
		expect( published.map( ( o ) => o.id ) ).not.toContain( 'publish' );
		const trash = published.find( ( o ) => o.id === 'trash' );
		expect( trash?.danger ).toBe( true );
		expect( trash?.disabled ).toBe( true );
	} );

	it( 'offers users only their own verbs', () => {
		const ids = buildMenuOptions(
			section( { id: 'users', kind: 'user', post_type: '' } ),
			item( { canDelete: false } ),
			[],
		).map( ( o ) => o.id );
		expect( ids ).toEqual( [ 'edit', 'open', 'copy-link' ] );
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

	it( 'paints the list as a tile grid with ribbons, locks, selection and the bulk bar', () => {
		const root = mount(
			state( { section: 'posts', selected: [ 2 ] } ),
			data( {
				list: page( [
					item( { id: 1, title: 'Alpha', status: 'draft' } ),
					item( { id: 2, title: 'Beta', lockedBy: 'Ada' } ),
				] ),
			} ),
		);
		const first = root.querySelector( '[data-item-id="1"] os-tile' );
		expect( first?.getAttribute( 'label' ) ).toBe( 'Alpha' );
		expect( first?.getAttribute( 'status' ) ).toBe( 'draft' );
		expect( first?.getAttribute( 'icon' ) ).toBe( 'dashicons-admin-post' );
		expect( root.querySelector( '[data-item-id="2"] os-tile' )?.hasAttribute( 'selected' ) ).toBe( true );
		expect( root.querySelector( '[data-item-id="2"] .os-mywp__lock' )?.getAttribute( 'title' ) ).toContain( 'Ada' );
		expect( root.textContent ).toContain( '1 selected' );
		expect( root.textContent ).toContain( '2 of 2 items' );
		expect( root.textContent ).toContain( 'Page 1 of 1' );
		// No invented chrome: selection never opens a toolbar — actions
		// live in the context menu, like WP Explorer.
		expect( root.querySelector( '.os-mywp__bulk' ) ).toBeNull();
	} );

	it( 'keeps the preview pane present, empty until an entry is selected', () => {
		const empty = mount(
			state( { section: 'posts' } ),
			data( { list: page( [ item( { id: 1 } ) ] ) } ),
		);
		expect( empty.querySelector( '.os-mywp__detail-pane' ) ).not.toBeNull();
		expect( empty.textContent ).toContain( 'Select an entry to preview it here.' );

		const open = mount(
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
		expect( open.querySelector( '.os-mywp__tiles' ) ).not.toBeNull();
		expect( open.textContent ).toContain( 'Status' );
		expect( open.querySelector( '[os-action="trash"]' ) ).not.toBeNull();
		expect( open.querySelector( '[data-mywp-content]' ) ).not.toBeNull();
	} );

	it( 'navigate-into paints the relation folders beside the article', () => {
		const root = mount(
			state( { section: 'posts', into: 1 } ),
			data( {
				folder: {
					id: 1,
					title: 'Alpha strategy',
					status: 'draft',
					content: '<p>Body</p>',
					folders: [
						{ relation: 'author', label: 'Author', icon: 'dashicons-admin-users', count: 1 },
						{ relation: 'comments', label: 'Comments', icon: 'dashicons-admin-comments', count: 3 },
						{ relation: 'revisions', label: 'Revisions', icon: 'dashicons-backup', count: 5 },
					],
				},
			} ),
		);
		const labels = Array.from( root.querySelectorAll( 'os-tile' ), ( el ) => el.getAttribute( 'label' ) );
		expect( labels ).toEqual( [ 'Author · 1', 'Comments · 3', 'Revisions · 5' ] );
		expect( root.querySelector( '[data-mywp-content="folder"]' ) ).not.toBeNull();
		expect( root.textContent ).toContain( '3 folders' );
		// The trail: Site › Posts are links, the post is current.
		const links = Array.from( root.querySelectorAll( '.os-mywp__crumb-link' ), ( el ) => el.textContent );
		expect( links ).toEqual( [ 'Test Site', 'Posts' ] );
		expect( root.querySelector( '.os-mywp__crumb-current' )?.textContent ).toBe( 'Alpha strategy' );
	} );

	it( 'a relation sub-list paints its rows and deepens the trail', () => {
		const root = mount(
			state( { section: 'posts', into: 1, relation: 'revisions' } ),
			data( {
				folder: { id: 1, title: 'Alpha strategy', status: 'draft', content: '', folders: [] },
				sub: {
					label: 'Revisions',
					rows: [
						{ id: 9, title: 'Yesterday at 10:03', subtitle: 'Ada', icon: 'dashicons-backup', editUrl: 'x' },
						{ id: 8, title: 'Monday at 09:00', subtitle: 'Grace', icon: 'dashicons-backup', editUrl: '' },
					],
				},
			} ),
		);
		const labels = Array.from( root.querySelectorAll( 'os-tile' ), ( el ) => el.getAttribute( 'label' ) );
		expect( labels ).toEqual( [ 'Yesterday at 10:03', 'Monday at 09:00' ] );
		expect( root.querySelector( '.os-mywp__crumb-current' )?.textContent ).toBe( 'Revisions' );
		expect( root.textContent ).toContain( '2 items' );
	} );

	it( 'a selected term row paints the WP Explorer stats pane', () => {
		const root = mount(
			state( { section: 'posts', into: 1, relation: 'categories', item: 5 } ),
			data( {
				folder: { id: 1, title: 'Alpha strategy', status: 'publish', content: '', folders: [] },
				sub: {
					label: 'Categories',
					rows: [ { id: 5, title: 'Notes', subtitle: '10 entries', icon: 'dashicons-category', editUrl: 'x' } ],
				},
				subDetail: {
					kind: 'term',
					stats: {
						profile: { name: 'Notes', taxonomyLabel: 'Category', link: 'https://example.test/category/notes' },
						counts: { posts: { total: 10, publish: 5 }, commentsReceived: 0, distinctAuthors: 1 },
						recent: [ { id: 9, title: 'Field recording: the 4am train', date: '2026-08-19T14:23:00', status: 'publish' } ],
						activity: [ { ym: '2026-08', count: 10 } ],
						milestones: { firstPosted: '2026-08-01T00:00:00', lastPosted: '2026-08-19T00:00:00' },
					},
				},
			} ),
		);
		expect( root.querySelector( 'os-tile[selected]' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'View archive' );
		expect( root.textContent ).toContain( '10' );
		expect( root.textContent ).toContain( '5 published' );
		expect( root.textContent ).toContain( 'Authors' );
		expect( root.textContent ).toContain( 'Activity (last 12 months)' );
		expect( root.textContent ).toContain( 'First post' );
		expect( root.textContent ).toContain( 'August 2026' );
		expect( root.textContent ).toContain( 'Field recording: the 4am train' );
		expect( root.querySelectorAll( '.os-mywp__activity-col' ) ).toHaveLength( 12 );
	} );

	it( 'masks image icons to the current colour instead of painting the brand bitmap', () => {
		const root = mount(
			state(),
			data( {
				sections: [ section( { id: 'cpt-product', label: 'Woo', icon: 'data:image/svg+xml;base64,abc', count: 4 } ) ],
			} ),
		);
		const mask = root.querySelector< HTMLElement >( '.os-mywp__icon-mask' );
		expect( mask ).not.toBeNull();
		expect( mask?.getAttribute( 'style' ) ).toContain( '--mywp-icon:url' );
		expect( root.querySelector( 'img.os-mywp__icon-img' ) ).toBeNull();
	} );

	it( 'renders the breadcrumb trail as links behind the current segment', () => {
		const root = mount(
			state( { section: 'posts' } ),
			data( { list: page( [] ) } ),
		);
		const links = Array.from( root.querySelectorAll( '.os-mywp__crumb-link' ), ( el ) => el.textContent );
		expect( links ).toEqual( [ 'Test Site' ] );
		expect( root.querySelector( '.os-mywp__crumb-current' )?.textContent ).toBe( 'Posts' );
		expect( root.querySelector( '.os-mywp__back' ) ).not.toBeNull();
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
