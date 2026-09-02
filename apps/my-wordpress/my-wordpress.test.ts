/**
 * My WordPress — the client half: selection math, page accumulation,
 * preview-action scoping, and one render of the view into jsdom.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import { uiOf } from './parts/types';
import app, {
	buildMenuOptions,
	resolveActions,
	withSendToHeading,
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
		footprint: 0,
		fpName: '',
		query: '',
		page: 1,
		sort: '',
		selected: [],
		view: 'icons',
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
		agentsEnabled: false,
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
		hiddenColumns: {},
		...over,
	};
}

// Page accumulation and selection math live in the framework now —
// tests/vitest/app-runtime-paged-list.test.ts pins them.

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
	it( 'matches the WP Explorer menu, in its order, plus the id-minded clipboard verbs', () => {
		const labels = buildMenuOptions(
			section(),
			item( { status: 'draft', shortlink: 'https://example.test/?p=1' } ),
			[ { id: 'send-pdf', label: 'Export PDF' } ],
		).map( ( o ) => o.label );
		expect( labels ).toEqual( [
			'Open in editor',
			'Navigate into',
			'Edit…',
			'Publish',
			'Copy link',
			'Copy shortlink',
			'Copy ID',
			'Move to Trash',
			'Export PDF',
		] );
		// No shortlink (a non-public type, a Woo order): no entry for it.
		expect( buildMenuOptions( section(), item( {} ), [] ).map( ( o ) => o.id ) ).not.toContain( 'copy-shortlink' );
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
		expect( ids ).toEqual( [ 'edit', 'open', 'copy-link', 'copy-id' ] );
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
		app.render( mockViewContext( { state: s, data: d, root, dispatch } ) );
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
		// The stat tiles are <os-stat> — value/label/caption live on the
		// element, not in light-DOM text.
		const statText = Array.from( root.querySelectorAll( 'os-stat' ) )
			.map( ( s ) => `${ s.getAttribute( 'value' ) } ${ s.getAttribute( 'label' ) } ${ s.getAttribute( 'caption' ) ?? '' }` )
			.join( ' ' );
		expect( statText ).toContain( '10' );
		expect( statText ).toContain( '5 published' );
		expect( statText ).toContain( 'Authors' );
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

	it( 'listens to WP Explorer\'s plugin seams: list-bands, list-tile, preview-extras', () => {
		const fired: Array< { hook: string; payload: Record< string, unknown > } > = [];
		const hooks = {
			applyFilters: ( hook: string, value: unknown, ...args: unknown[] ) => {
				if ( hook === 'os.my-wordpress.list-bands' ) {
					const entity = args[ 0 ] as SectionDef;
					if ( entity.id !== 'posts' ) {
						return value;
					}
					return {
						bands: [
							{ id: 'doing', label: 'Doing', order: 1, tone: 'warn' },
							{ id: 'done', label: 'Done', order: 2 },
						],
						assign: ( row: ListItem ) =>
							( row.meta as Record< string, string > | undefined )?._lane ?? null,
					};
				}
				return value;
			},
			doAction: ( hook: string, payload: Record< string, unknown > ) => {
				fired.push( { hook, payload } );
				// Do what the AllTerrain Work handler does: append DOM
				// into the slot the moment it fires.
				if ( hook === 'os.my-wordpress.preview-extras' && payload.slot === 'meta' ) {
					const block = document.createElement( 'div' );
					block.className = 'atwork-preview';
					block.textContent = 'State: Active';
					( payload.container as HTMLElement ).appendChild( block );
				}
			},
		};
		( window as { wp?: unknown } ).wp = { os: { hooks } };
		try {
			const root = document.createElement( 'div' );
			document.body.appendChild( root );
			const rows = [
				item( { id: 1, title: 'Ship it', meta: { _lane: 'doing' } } ),
				item( { id: 2, title: 'Shipped', meta: { _lane: 'done' } } ),
				item( { id: 3, title: 'Loose end' } ),
			];
			app.render( mockViewContext( {
				state: state( { section: 'posts', item: 1 } ),
				data: data( {
					list: page( rows ),
					detail: {
						kind: 'post',
						id: 1,
						title: 'Ship it',
						facts: [],
						canEdit: true,
						canDelete: true,
						content: '<p>Body</p>',
					},
				} ),
				root,
			} ) );
			// Bands: declared order, tone class, count chips, and the
			// unassigned row in an unlabelled grid at the end.
			const heads = Array.from( root.querySelectorAll( '.os-mywp__band-head' ) );
			expect( heads.map( ( h ) => h.textContent?.trim().replace( /\s+/g, ' ' ) ) ).toEqual( [
				'Doing 1',
				'Done 1',
			] );
			expect( heads[ 0 ].classList.contains( 'os-mywp__band-head--warn' ) ).toBe( true );
			const grids = root.querySelectorAll( '.os-mywp__band-grid' );
			expect( grids ).toHaveLength( 3 );
			// list-tile fired once per rendered tile, item attached.
			const tiles = fired.filter( ( f ) => f.hook === 'os.my-wordpress.list-tile' );
			expect( tiles ).toHaveLength( 3 );
			expect( tiles.map( ( f ) => ( f.payload.item as ListItem ).id ).sort() ).toEqual( [ 1, 2, 3 ] );
			expect( tiles[ 0 ].payload.entityId ).toBe( 'posts' );
			// preview-extras fired once per slot, with the list row's
			// REST-visible fields merged under the dossier's.
			const extras = fired.filter( ( f ) => f.hook === 'os.my-wordpress.preview-extras' );
			expect( extras.map( ( f ) => f.payload.slot ).sort() ).toEqual( [ 'footer', 'header', 'meta' ] );
			const metaSlot = extras.find( ( f ) => f.payload.slot === 'meta' );
			expect( ( metaSlot?.payload.item as Record< string, unknown > ).id ).toBe( 1 );
			expect(
				( ( metaSlot?.payload.item as Record< string, unknown > ).meta as Record< string, string > )._lane,
			).toBe( 'doing' );
			expect( ( metaSlot?.payload.container as HTMLElement ).hasAttribute( 'os-preserve' ) ).toBe( true );
			// One firing per item: a repaint with the same selection
			// does not re-run the subscribers.
			fired.length = 0;
			app.render( mockViewContext( {
				state: state( { section: 'posts', item: 1 } ),
				data: data( {
					list: page( rows ),
					detail: {
						kind: 'post',
						id: 1,
						title: 'Ship it',
						facts: [],
						canEdit: true,
						canDelete: true,
						content: '<p>Body</p>',
					},
				} ),
				root,
			} ) );
			expect( fired.filter( ( f ) => f.hook === 'os.my-wordpress.preview-extras' ) ).toHaveLength( 0 );
			// …and what the subscriber painted SURVIVES the repaint.
			expect( root.querySelector( '.atwork-preview' )?.textContent ).toBe( 'State: Active' );
		} finally {
			delete ( window as { wp?: unknown } ).wp;
		}
	} );

	it( 'hovering a tile summons WP Explorer\'s card: title, excerpt, lock banner', () => {
		const root = document.createElement( 'div' );
		document.body.appendChild( root );
		const ctx = mockViewContext( {
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
		} );
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
		const ctx = mockViewContext( {
			state: state( { section: 'posts', selected: [ 1 ] } ),
			data: data( {
				list: page( [ item( {} ) ] ),
				authors: [ { id: 3, name: 'Ada' } ],
				categories: [ { id: 1, name: 'Uncategorized', parent: 0 } ],
				tags: [ { id: 9, name: 'field-notes' } ],
			} ),
			root,
		} );
		uiOf( ctx ).quickEdit = {
			ids: [ 1 ],
			status: '',
			comments: '',
			author: '',
			sticky: '',
			categories: [],
			tags: [],
		};
		app.render( ctx );
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
		// The stat tiles are <os-stat> now; the accent chain lives in the
		// component's own stylesheet and its test.
		expect( ruleOf( '.os-mywp__activity-bar' ) ).toContain( '--wp-admin-theme-color' );
		expect( ruleOf( '.os-mywp__ghost-visual' ) ).toContain( '--os-skeleton-high' );
	} );

	it( 'the shared explorer sheet routes every admin-blue through the theme token', () => {
		// The footprint hero's wash, the avatar well, the role chips
		// and the calendar intensity ramp all used to hard-code
		// rgba(34, 113, 177, …) — the pre-brand admin blue with no
		// token in the chain, so no theme or accent pick could repaint
		// the header. They resolve through
		// `color-mix(…, var(--wp-admin-theme-color, #2271b1), …)` now;
		// a raw occurrence is a regression.
		const shared = readFileSync(
			join(
				dirname( fileURLToPath( import.meta.url ) ),
				'..',
				'..',
				'assets',
				'css',
				'my-wordpress.css',
			),
			'utf8',
		);
		expect( shared ).not.toMatch( /rgba\(\s*34,\s*113,\s*177/ );
	} );
} );
