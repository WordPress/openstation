/**
 * My WordPress — the client half: selection math, page accumulation,
 * preview-action scoping, and one render of the view into jsdom.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { uiOf } from './parts/types';
import app, {
	accumulate,
	agentDefaultRole,
	agentFaceSrc,
	agentsRosterStamp,
	applySelection,
	buildMenuOptions,
	emptyCast,
	listKey,
	resolveActions,
	withSendToHeading,
	type AgentsPayload,
	type AppAgent,
	type MenuOption,
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
		excerpt: '',
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
		pane: 'define',
		casting: false,
		wstep: 0,
		cast: null,
		agentNotice: '',
		briefError: '',
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
		tags: [],
		previewActions: [],
		agents: null,
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
	function mount(
		s: AppState,
		d: AppData,
		dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean > = async () => true,
	): HTMLElement {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		app.render( {
			state: s,
			data: d,
			root,
			dispatch,
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
		// The pane carries WP Explorer's full verb row: the door into
		// the detail folder sits beside the editor button.
		expect( open.textContent ).toContain( 'Explore details' );
		expect( open.textContent ).toContain( 'Open in editor' );
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
						topAuthors: [ { userId: 3, userName: 'Ada Dahl', userAvatarUrl: '', count: 7 } ],
						coTerms: [ { id: 8, name: 'Tape', count: 4 } ],
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
		expect( root.textContent ).toContain( 'Top contributors' );
		expect( root.textContent ).toContain( 'Ada Dahl' );
		expect( root.textContent ).toContain( '7 posts' );
		expect( root.textContent ).toContain( 'Often paired with' );
		expect( root.textContent ).toContain( 'Tape · 4' );
	} );

	it( 'groups the agents send-to rows behind an inert heading', () => {
		const base: MenuOption[] = [
			{ id: 'edit', label: 'Open in editor' },
			{ id: 'trash', label: 'Move to Trash', danger: true },
		];
		const merged: MenuOption[] = [
			...base,
			{ id: 'plugin-extra', label: 'Export', onSelect: () => undefined },
			{ id: 'agent-send-to-1', label: 'Send to Localizer', onSelect: () => undefined },
			{ id: 'agent-send-to-2', label: 'Send to SEO Medic', onSelect: () => undefined },
		];
		const grouped = withSendToHeading( base, merged );
		expect( grouped.map( ( o ) => o.id ) ).toEqual( [
			'edit', 'trash', 'plugin-extra', 'send-to-heading', 'agent-send-to-1', 'agent-send-to-2',
		] );
		expect( grouped.find( ( o ) => o.id === 'send-to-heading' )?.heading ).toBe( true );

		// No agents, or a filter that reordered: hands the list back verbatim.
		expect( withSendToHeading( base, [ ...base, { id: 'plugin-extra', label: 'Export' } ] ) ).toHaveLength( 3 );
		const reordered = [ merged[ 2 ], ...base ];
		expect( withSendToHeading( base, reordered ) ).toBe( reordered );
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

	it( 'hovering a tile summons WP Explorer\'s card: title, excerpt, lock banner', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const ctx = {
			state: state( { section: 'posts' } ),
			data: data( {
				list: page( [
					item( {
						title: 'This is a test',
						excerpt: 'Test 2 okay',
						lockedBy: 'Ada',
					} ),
				] ),
			} ),
			root,
			dispatch: async () => true,
			local: () => undefined,
		};
		// jsdom has no IntersectionObserver; mounted() wires one for
		// the infinite scroll, which this test never exercises.
		( globalThis as { IntersectionObserver?: unknown } ).IntersectionObserver ??= class {
			observe(): void {}
			disconnect(): void {}
		};
		app.render( ctx );
		const teardown = app.mounted( ctx ) as () => void;
		const cell = root.querySelector< HTMLElement >( '[data-mywp-drag][data-item-id]' );
		expect( cell ).not.toBeNull();
		expect( cell?.hasAttribute( 'title' ) ).toBe( false );
		cell?.dispatchEvent( new MouseEvent( 'mouseover', { bubbles: true } ) );
		const tip = document.body.querySelector( '.os-my-wordpress__tooltip' );
		expect( tip ).not.toBeNull();
		expect( tip?.querySelector( '.os-my-wordpress__tooltip-title' )?.textContent ).toBe(
			'This is a test',
		);
		expect( tip?.querySelector( '.os-my-wordpress__tooltip-excerpt' )?.textContent ).toBe(
			'Test 2 okay',
		);
		expect( tip?.querySelector( '.os-my-wordpress__tooltip-lock' )?.textContent ).toContain(
			'Ada is currently editing',
		);
		// A press means a click, a drag-out or the menu — card gone.
		// (MouseEvent: jsdom has no PointerEvent constructor; listeners
		// key on the event NAME either way.)
		root.dispatchEvent( new MouseEvent( 'pointerdown', { bubbles: true } ) );
		expect( document.body.querySelector( '.os-my-wordpress__tooltip' ) ).toBeNull();
		teardown();
	} );

	it( 'the Edit… modal carries the original controls: notice, category picker, tag tokens', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		uiOf( root ).quickEdit = {
			ids: [ 1 ],
			status: '',
			comments: '',
			author: '',
			sticky: '',
			categories: [],
			tags: [],
		};
		app.render( {
			state: state( { section: 'posts', selected: [ 1 ] } ),
			data: data( {
				list: page( [ item( {} ) ] ),
				authors: [ { id: 3, name: 'Ada' } ],
				categories: [ { id: 1, name: 'Uncategorized', parent: 0 } ],
				tags: [ { id: 9, name: 'field-notes' } ],
			} ),
			root,
			dispatch: async () => true,
			local: () => undefined,
		} );
		// The hint the original's bulk modal leads with.
		expect( root.textContent ).toContain(
			'Only the fields you change are applied. Categories and tags are added to what each entry already has.',
		);
		// Chips and tokens, not raw checkboxes and a comma-separated
		// text input — the same components WP Explorer's modal uses.
		const picker = root.querySelector< HTMLElement & { items: unknown[]; value: number[] } >(
			'os-category-picker',
		);
		expect( picker ).not.toBeNull();
		expect( picker?.items ).toEqual( [ { id: 1, name: 'Uncategorized', parent: 0 } ] );
		const tagInput = root.querySelector< HTMLElement >( 'os-tag-input' );
		expect( tagInput ).not.toBeNull();
		expect( tagInput?.hasAttribute( 'creatable' ) ).toBe( true );
		expect( root.querySelector( '.os-mywp__qe-cats' ) ).toBeNull();
		expect( root.querySelector( 'input.os-mywp__qe-tags' ) ).toBeNull();
	} );

	it( 'the agents root tile is a portrait, never a masked disc', () => {
		// The robot avatar carries its own colours (light circle, dark
		// robot); through the monochrome mask it rendered as a filled
		// circle. It paints as the image it is, like WP Explorer's.
		const root = mount(
			state(),
			data( {
				sections: [
					section(),
					section( {
						id: 'agents',
						label: 'Agents',
						kind: 'agent',
						post_type: '',
						icon: 'https://example.test/agent-avatar.svg',
						count: 7,
					} ),
				],
			} ),
		);
		const img = root.querySelector< HTMLImageElement >( 'img.os-mywp__icon-img' );
		expect( img ).not.toBeNull();
		expect( img?.getAttribute( 'src' ) ).toBe( 'https://example.test/agent-avatar.svg' );
		expect( root.querySelector( '.os-mywp__icon-mask' ) ).toBeNull();
	} );

	it( 'folder tiles are Finder-style: single click selects, double click navigates', () => {
		const calls: string[] = [];
		const root = mount( state(), data(), async ( action ) => {
			calls.push( action );
			return true;
		} );
		const tile = root.querySelector< HTMLElement >( '.os-mywp__tile' );
		// A single click never navigates.
		tile?.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( calls ).toEqual( [] );
		tile?.dispatchEvent( new MouseEvent( 'dblclick', { bubbles: true } ) );
		expect( calls ).toEqual( [ 'go' ] );
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

// ----------------------------------------------------------- agents

function agent( over: Partial< AppAgent > = {} ): AppAgent {
	return {
		id: 7,
		slug: 'indexer',
		name: 'Indexer',
		description: 'Keeps the archive tidy.',
		instructions: 'Index things.',
		role: 'author',
		abilities: [ 'search_posts' ],
		triggers: [ { kind: 'chat', config: {} } ],
		model: '',
		rateLimit: 0,
		vibes: 'quiet, relentless',
		face: { appearance: { hueStart: 44 }, physics: { shapePreset: 'star' } },
		faceSeed: 9,
		avatarUrl: 'https://example.test/face-7.svg',
		profileUrl: 'https://example.test/wp-admin/user-edit.php?user_id=7',
		...over,
	};
}

function agentsPayload( over: Partial< AgentsPayload > = {} ): AgentsPayload {
	return {
		enabled: true,
		canEnable: true,
		canManage: true,
		canInvoke: true,
		aiAvailable: true,
		aiReady: true,
		connectorsUrl: 'https://example.test/wp-admin/options-connectors.php',
		runWindowId: 'desktop-mode-agent-run',
		restRoot: 'https://example.test/wp-json/',
		restNonce: 'nonce',
		list: [ agent() ],
		roleLabels: { author: 'Author', editor: 'Editor' },
		abilities: [
			{
				slug: 'search_posts',
				label: 'Search posts',
				description: 'Find entries by keyword.',
				category: 'Content',
				readonly: true,
			},
			{
				slug: 'update_post',
				label: 'Update a post',
				description: 'Rewrite an entry.',
				category: 'Content',
				readonly: false,
			},
		],
		triggerKinds: [
			{ slug: 'chat', label: 'Chat', description: 'Open a conversation.', icon: '', wired: true },
			{
				slug: 'send-to',
				label: 'Send to (right-click menu)',
				description: 'Right-click intake.',
				icon: '',
				wired: true,
				config_schema: { properties: { entityKinds: {} } },
			},
			{ slug: 'hook', label: 'WordPress hook', description: '', icon: '', wired: false },
		],
		hooks: [],
		roles: [
			{ slug: 'author', label: 'Author' },
			{ slug: 'editor', label: 'Editor' },
		],
		...over,
	};
}

function agentsSection(): SectionDef {
	return section( { id: 'agents', label: 'Agents', icon: 'x.svg', kind: 'agent', post_type: '', count: 1 } );
}

describe( 'agents helpers', () => {
	it( 'emptyCast rolls a face from the seed and keeps chat on', () => {
		const cast = emptyCast( 'author', 42 );
		expect( cast.role ).toBe( 'author' );
		expect( cast.faceSeed ).toBe( 42 );
		expect( cast.stripSeed ).toBe( 42 );
		expect( cast.triggers ).toEqual( [ { kind: 'chat', config: {} } ] );
		expect( Object.keys( cast.face.appearance ).length ).toBeGreaterThan( 0 );
		// Deterministic: the same seed always gives the same face.
		expect( emptyCast( 'author', 42 ).face ).toEqual( cast.face );
	} );

	it( 'agentDefaultRole prefers author and falls back to the first allowed role', () => {
		expect( agentDefaultRole( null ) ).toBe( 'author' );
		expect( agentDefaultRole( [ { slug: 'author', label: 'Author' } ] ) ).toBe( 'author' );
		expect( agentDefaultRole( [ { slug: 'editor', label: 'Editor' } ] ) ).toBe( 'editor' );
	} );

	it( 'agentFaceSrc prefers the written portrait and falls back to the seed roll', () => {
		expect( agentFaceSrc( agent(), 88 ) ).toBe( 'https://example.test/face-7.svg' );
		const rolled = agentFaceSrc( agent( { face: { appearance: {}, physics: {} } } ), 88 );
		expect( rolled.startsWith( 'data:image/svg+xml' ) ).toBe( true );
		// No face, no seed: whatever avatar the server sent (the glyph).
		expect(
			agentFaceSrc( agent( { face: { appearance: {}, physics: {} }, faceSeed: 0 } ), 88 ),
		).toBe( 'https://example.test/face-7.svg' );
	} );

	it( 'agentsRosterStamp captures who exists and which doors they answer', () => {
		const a = agent();
		const stamp = agentsRosterStamp( [ a ] );
		expect( agentsRosterStamp( [ a ] ) ).toBe( stamp );
		expect(
			agentsRosterStamp( [ { ...a, triggers: [ ...a.triggers, { kind: 'send-to', config: {} } ] } ] ),
		).not.toBe( stamp );
		expect( agentsRosterStamp( [ a, agent( { id: 8 } ) ] ) ).not.toBe( stamp );
	} );

	it( 'wizard locals reduce without a request', () => {
		expect( app.hasLocal( 'agent-start' ) ).toBe( true );
		expect( app.hasLocal( 'agent-create' ) ).toBe( false );
		const started = app.runLocal(
			'agent-start',
			state( { section: 'agents' } ),
			{},
			data( { agents: agentsPayload() } ),
		) as AppState;
		expect( started.casting ).toBe( true );
		expect( started.wstep ).toBe( 0 );
		expect( ( started.cast as { role: string } ).role ).toBe( 'author' );

		const copied = app.runLocal(
			'agent-start',
			state( { section: 'agents' } ),
			{ from: agent() },
			data( { agents: agentsPayload() } ),
		) as AppState;
		expect( copied.wstep ).toBe( 1 );
		const cast = copied.cast as { name: string; copiedFrom: string; faceSeed: number };
		expect( cast.name ).toContain( 'Indexer' );
		expect( cast.copiedFrom ).toBe( 'Indexer' );
		// A copy takes the work but not the face.
		expect( cast.faceSeed ).not.toBe( 9 );

		const stepped = app.runLocal( 'agent-step', copied, { step: 3 }, data() ) as AppState;
		expect( stepped.wstep ).toBe( 3 );
		const cancelled = app.runLocal( 'agent-cancel', stepped, {}, data() ) as AppState;
		expect( cancelled.casting ).toBe( false );
		expect( cancelled.cast ).toBeNull();
	} );
} );

describe( 'agents view', () => {
	function mountAgents(
		s: Partial< AppState >,
		payload: AgentsPayload,
		dispatch: ( action: string, args?: Record< string, unknown > ) => Promise< boolean > = async () => true,
	): HTMLElement {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		app.render( {
			state: state( { section: 'agents', ...s } ),
			data: data( { sections: [ section(), agentsSection() ], agents: payload } ),
			root,
			dispatch,
			local: () => undefined,
		} );
		return root;
	}

	it( 'paints the cast grid with faces, vibes, role badges and the door', () => {
		const root = mountAgents( {}, agentsPayload() );
		expect( root.querySelector( '.dm-agents' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Your cast' );
		expect( root.textContent ).toContain( 'Indexer' );
		expect( root.textContent ).toContain( 'quiet, relentless' );
		expect( root.textContent ).toContain( 'Author' );
		expect( root.querySelector( '.dm-agents__cast-card[data-agent-id="7"]' ) ).not.toBeNull();
		expect( root.querySelector( '.dm-agents__cast-new' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Cast a new agent' );
		// The footer counts the cast, and no search band renders.
		expect( root.textContent ).toContain( '1 agent' );
		expect( root.querySelector( '.os-mywp__search' ) ).toBeNull();
	} );

	it( 'the off state draws the preview crew, greyed, above the enable bar', () => {
		const root = mountAgents(
			{},
			agentsPayload( {
				enabled: false,
				list: [],
				abilities: [],
				roles: null,
				preview: [
					{
						name: 'Localizer',
						vibes: 'multilingual',
						description: 'Translates everything.',
						role: 'editor',
						roleLabel: 'Editor',
						face: { appearance: {}, physics: {} },
					},
				],
			} ),
		);
		expect( root.querySelector( '.dm-agents.is-disabled' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Agents are turned off' );
		expect( root.textContent ).toContain( 'The crew you would get' );
		expect( root.textContent ).toContain( 'Localizer' );
		expect( root.querySelector( '.dm-agents__cast--preview' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Turn on Agents' );
		// Inert: preview cards carry no id and no interactivity.
		expect( root.querySelector( '.dm-agents__cast--preview [data-agent-id]' ) ).toBeNull();
	} );

	it( 'the detail view carries the tabs, the verbs and the ability checklist', () => {
		const root = mountAgents( { item: 7, pane: 'tools' }, agentsPayload() );
		expect( root.textContent ).toContain( '@agent-indexer' );
		expect( root.textContent ).toContain( 'Open profile' );
		expect( root.textContent ).toContain( 'Chat' );
		expect( root.querySelector( '[os-action="agent-delete"]' ) ).not.toBeNull();
		// The Tools pane: both abilities, with their access badges.
		expect( root.querySelector( 'os-checkbox-label[label="Search posts"]' ) ).not.toBeNull();
		expect( root.querySelector( 'os-checkbox-label[label="Update a post"]' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'read-only' );
		expect( root.textContent ).toContain( 'can modify' );
	} );

	it( 'the wizard walks Describe with the starters and the AI door', () => {
		const root = mountAgents(
			{ casting: true, wstep: 0, cast: emptyCast( 'author', 5 ) },
			agentsPayload(),
		);
		expect( root.textContent ).toContain( 'New agent' );
		expect( root.querySelectorAll( 'os-step' ) ).toHaveLength( 5 );
		expect( root.textContent ).toContain( 'Start from someone' );
		expect( root.textContent ).toContain( 'Draft it for me' );
		expect( root.textContent ).toContain( 'I will fill it in myself' );
	} );

	it( 'Meet shows the portrait, twelve candidates and the identity chips', () => {
		const root = mountAgents(
			{ casting: true, wstep: 1, cast: emptyCast( 'author', 5 ) },
			agentsPayload(),
		);
		expect( root.querySelector( '.dm-agents__portrait-face' ) ).not.toBeNull();
		expect( root.querySelectorAll( '.dm-agents__face-pick' ) ).toHaveLength( 12 );
		expect( root.querySelector( '.dm-agents__face-pick.is-picked' ) ).not.toBeNull();
		expect( root.textContent ).toContain( 'Surprise me' );
		expect( root.querySelector( 'os-text-field[label="Vibes"]' ) ).not.toBeNull();
		// The silhouette + hue chips are derived from the look.
		expect( root.querySelectorAll( '.dm-agents__portrait-chips os-chip' ) ).toHaveLength( 2 );
	} );

	it( 'Launch summarizes the character and offers Create and chat when AI is ready', () => {
		const cast = emptyCast( 'author', 5 );
		cast.name = 'Casey';
		cast.vibes = 'calm';
		cast.abilities = [ 'search_posts' ];
		const root = mountAgents( { casting: true, wstep: 4, cast }, agentsPayload() );
		expect( root.textContent ).toContain( 'Casey' );
		expect( root.textContent ).toContain( 'Create agent' );
		expect( root.textContent ).toContain( 'Create and chat' );
		expect( root.querySelector( '.dm-agents__chips os-chip[label="Search posts"]' ) ).not.toBeNull();

		const noAi = mountAgents(
			{ casting: true, wstep: 4, cast },
			agentsPayload( { aiReady: false } ),
		);
		expect( noAi.textContent ).not.toContain( 'Create and chat' );
		expect( noAi.textContent ).toContain(
			'No AI provider is configured — agents cannot run until a connector is set up.',
		);
	} );
} );

describe( 'theme tokenization', () => {
	const css = readFileSync(
		join( dirname( fileURLToPath( import.meta.url ) ), 'my-wordpress.css' ),
		'utf8',
	);

	/** The rule body for one selector, or '' when absent. */
	function ruleOf( selector: string ): string {
		const at = css.indexOf( selector );
		if ( at === -1 ) {
			return '';
		}
		return css.slice( at, css.indexOf( '}', at ) );
	}

	it( 'selection wears the canonical shell tokens, not the raw brand accent', () => {
		// The divergence this pins: reading `--os-ui-accent` painted the
		// selection in raw Pulse while WP Explorer's tiles followed the
		// admin scheme through `--os-tile-selected-bg` / `--os-tile-focus-ring`.
		const selected = ruleOf( '.os-mywp__tile.is-selected' );
		expect( selected ).toContain( '--os-tile-selected-bg' );
		expect( selected ).toContain( '--os-tile-focus-ring' );
		expect( selected ).not.toContain( '--os-ui-selection-bg' );

		const openRing = ruleOf( '.os-mywp__cell.is-open .os-file-tile' );
		expect( openRing ).toContain( '--os-tile-focus-ring' );

		const marquee = ruleOf( '.os-mywp__marquee' );
		expect( marquee ).toContain( '--os-selection-marquee-bg' );
		expect( marquee ).toContain( '--os-tile-focus-ring' );
	} );

	it( 'links, hovers and accents read the same chains WP Explorer reads', () => {
		expect( ruleOf( '.os-mywp__crumb-link {' ) ).toContain( '--os-link' );
		expect( ruleOf( '.os-mywp__recent-title' ) ).toContain( '--os-link' );
		expect( ruleOf( '.os-mywp__tile:hover' ) ).toContain( '--os-tile-hover-bg' );
		expect( ruleOf( '.os-mywp__stat-value' ) ).toContain( '--wp-admin-theme-color' );
		expect( ruleOf( '.os-mywp__activity-bar' ) ).toContain( '--wp-admin-theme-color' );
		expect( ruleOf( '.os-mywp__ghost-visual' ) ).toContain( '--os-skeleton-high' );
	} );
} );
