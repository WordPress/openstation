/**
 * Pages app — the Posts list body composed for pages: every string
 * picks the page noun, the hierarchical columns paint, the declared
 * sort is the fallback, and there are no taxonomy tabs or cells.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewContext } from '../../src/app-runtime/testing';
import type { ListData, ListState, PostListItem } from '../posts/parts/types';
import app from './pages.os';

function row( id: number, over: Partial< PostListItem > = {} ): PostListItem {
	return {
		id,
		title: { rendered: `Page ${ id }` },
		status: 'publish',
		date: '2026-01-01T00:00:00',
		date_gmt: '2026-01-01T00:00:00',
		modified: '2026-01-01T00:00:00',
		modified_gmt: '2026-01-01T00:00:00',
		author: 1,
		categories: [],
		tags: [],
		comment_status: 'open',
		parent: 0,
		template: '',
		slug: `page-${ id }`,
		...over,
	};
}

function mount( items: PostListItem[], extra: Record< string, unknown > = {}, over: Partial< ListState > = {} ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const dispatch = vi.fn( async () => true );
	const ctx = mockViewContext< ListState, ListData >( {
		state: { tab: 'posts', page: 1, perPage: 20, search: '', status: '', orderby: 'menu_order', order: 'asc', author: [], tag: [], ...over },
		data: { list: { items, total: items.length, pages: items.length ? 1 : 0, page: 1, perPage: 20, error: '', code: '' } },
		root,
		extra: {
			mode: 'pages',
			menuTabs: [
				{ id: 'posts', label: 'All pages' },
				{ id: 'new', label: 'Add Page' },
				{ id: 'atlas', label: 'Page atlas' },
			],
			newPostUrl: 'http://x.test/wp-admin/post-new.php?post_type=page',
			defaultOrderby: 'menu_order',
			defaultOrder: 'asc',
			frontPageId: 1,
			pageTemplates: { '': 'Default template' },
			...extra,
		},
		dispatch,
		host: { fetch: ( i, init ) => globalThis.fetch( i, init ), openUrl: vi.fn(), confirm: vi.fn( async () => true ) },
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx, dispatch };
}

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = {
		os: {
			getOsSettings: () => ( { nativePostsHiddenColumns: [], nativePagesHiddenColumns: [] } ),
			updateOsSettings: vi.fn(),
			subscribeOsSettings: () => () => undefined,
		},
		hooks: { applyFilters: ( _n: string, v: unknown ) => v, doAction: () => undefined },
	};
} );

afterEach( () => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the pages view', () => {
	it( 'has the pages and atlas tabs, no taxonomy tabs, and reads as pages everywhere', () => {
		const { root } = mount( [ row( 1 ), row( 2 ) ] );
		expect( Array.from( root.querySelectorAll( 'os-tab' ) ).map( ( tab ) => tab.textContent ) ).toEqual( [ 'All pages', 'Add Page', 'Page atlas' ] );
		expect( root.querySelector( '[data-os-pages-atlas]' )?.childElementCount ).toBe( 0 );
		expect( root.querySelector( '[data-os-posts-root]' )!.classList.contains( 'desktop-mode-pages' ) ).toBe( true );
		expect( root.querySelector( '[data-os-posts-search]' )!.getAttribute( 'placeholder' ) ).toBe( 'Search pages…' );
		expect( root.querySelector( '.os-app-list__pager' ) ).toBeNull();
		expect( root.querySelector( '[data-content-feed-end]' )?.textContent ).toContain( 'caught up' );
		expect( root.querySelector( '.os-app-list__empty p' )!.textContent ).toBe( 'No pages found.' );
		// The hero button goes where the Add Page tab goes.
		( root.querySelector( '[data-os-posts-new]' ) as HTMLElement ).click();
		expect( ( root.querySelector( 'os-tabs' ) as HTMLElement & { value: string } ).value ).toBe( 'new' );
	} );

	// The Pages window has no stylesheet of its own, so the Add Page
	// embed has to be sized by the view's inline styles. As a plain
	// block it shrinks to the iframe's 150px default and squeezes the
	// editor and its "Choose a pattern" modal into that strip.
	it( 'sizes the Add Page editor host to fill its tab panel', () => {
		const { root } = mount( [] );
		const host = root.querySelector< HTMLElement >( '[data-os-posts-editor]' )!;
		const style = getComputedStyle( host );
		expect( style.display ).toBe( 'flex' );
		expect( style.flexGrow ).toBe( '1' );
	} );

	it( 'paints the hierarchical columns, sorted by menu order, and falls back to it when a sort is cleared', () => {
		const { root, dispatch } = mount( [ row( 1 ), row( 2, { parent: 1 } ) ] );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & {
			columns?: Array< { key: string } >;
			sort?: { key: string; direction: string } | null;
		};
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'parent', 'template', 'slug', 'comments', 'date' ] );
		// `menu_order` is no column, so no header wears a sort arrow —
		// the table refuses a sort it cannot show.
		expect( table.sort ).toBeNull();
		table.dispatchEvent( new CustomEvent( 'os-table-sort-change', { detail: { sort: null } } ) );
		expect( dispatch ).toHaveBeenCalledWith( 'sort', { orderby: 'menu_order', order: 'asc' } );
	} );

	it( 'presents page locations honestly across paginated results', () => {
		const { root } = mount( [ row( 1 ), row( 2, { parent: 1 } ), row( 3, { parent: 90 } ) ] );
		expect( root.querySelector( '[data-story-id="1"] .os-posts-desk__role' )?.textContent ).toBe( 'Front page' );
		expect( root.querySelector( '[data-story-id="2"] .os-posts-desk__kicker' )?.textContent ).toBe( 'Page 1' );
		expect( root.querySelector( '[data-story-id="3"] .os-posts-desk__kicker' )?.textContent ).toBe( 'Parent page #90' );
		( root.querySelector( '[data-inspect-id="2"]' ) as HTMLElement ).click();
		expect( root.querySelector( '[data-detail-field="parent"]' )?.textContent ).toContain( 'Page 1' );
		expect( root.querySelector( '[data-story-id="1"] .os-posts-desk__excerpt' )?.textContent ).toBe( '/page-1' );
		expect( root.querySelector( '.os-posts-desk__workspace' )?.hasAttribute( 'hidden' ) ).toBe( false );
	} );

	it( 'offers public links only for published pages', () => {
		const { root } = mount( [ row( 1, { link: 'https://example.test/home/' } ), row( 2, { status: 'draft', link: 'https://example.test/draft/' } ) ] );
		( root.querySelector( '[data-inspect-id="1"]' ) as HTMLElement ).click();
		expect( root.querySelector( '.os-posts-desk__inspector-actions a' )?.getAttribute( 'href' ) ).toBe( 'https://example.test/home/' );
		( root.querySelector( '[data-inspect-id="2"]' ) as HTMLElement ).click();
		expect( root.querySelector( '.os-posts-desk__inspector-actions a' ) ).toBeNull();
	} );

	it( 'offers each row the actions its status allows and the links plugins add, never one its surface already shows', async () => {
		const fetch = vi.fn( async ( _url: unknown, _init?: RequestInit ) => new Response( JSON.stringify( {
			success: true,
			data: { 1: [
				{ key: 'clone', label: 'Clone', url: 'http://x.test/wp-admin/admin.php?action=duplicate_post_clone&post=1', admin: true },
				{ key: 'bricks', label: 'Edit with Bricks', url: 'https://x.test/home/?bricks=run', admin: false },
			] },
		} ) ) );
		vi.stubGlobal( 'fetch', fetch );
		const rows = [ row( 1, { link: 'https://x.test/home/' } ), row( 2, { status: 'draft' } ), row( 3, { status: 'trash' } ) ];
		const { root } = mount( rows, { ajaxUrl: 'http://x.test/wp-admin/admin-ajax.php', rowActionsNonce: 'nonce' } );
		const labels = ( menu: Element | null | undefined ): Array< string | null > =>
			Array.from( menu?.querySelectorAll( 'os-context-menu-option' ) ?? [] ).map( ( o ) => o.textContent );
		// The card has its own Edit button; Quick edit lives in its menu.
		const card = ( id: number ): Array< string | null > => labels( root.querySelector( `[data-story-id="${ id }"] [data-os-posts-row-actions]` ) );
		expect( card( 1 ) ).toEqual( [ 'Quick edit', 'View ↗', 'Move to trash' ] );
		await vi.waitFor( () => expect( card( 1 ) ).toEqual( [ 'Quick edit', 'View ↗', 'Clone', 'Edit with Bricks ↗', 'Move to trash' ] ) );
		expect( card( 2 ) ).toEqual( [ 'Quick edit', 'Move to trash' ] );
		expect( card( 3 ) ).toEqual( [ 'Restore' ] );
		expect( String( fetch.mock.calls[ 0 ][ 1 ]?.body ) ).toContain( 'ids=1%2C2%2C3' );
		// The details pane has Open editor and View on site.
		( root.querySelector( '[data-inspect-id="1"]' ) as HTMLElement ).click();
		expect( labels( root.querySelector( '.os-posts-desk__inspector-actions [data-os-posts-row-actions]' ) ) ).toEqual( [ 'Quick edit', 'Clone', 'Edit with Bricks ↗', 'Move to trash' ] );
		// The table's title cell: the title link edits, View and Quick edit sit beside it.
		const title = ( root.querySelector( '[data-os-posts-table]' ) as HTMLElement & { columns: Array< { key: string; render: ( v: unknown, r: unknown, i: number ) => Element } > } )
			.columns.find( ( col ) => col.key === 'title' )!;
		const cell = ( item: PostListItem ): Array< string | null > => labels( title.render( item.title, item, 0 ).querySelector( '[data-os-posts-row-actions]' ) );
		expect( cell( rows[ 0 ] ) ).toEqual( [ 'Clone', 'Edit with Bricks ↗', 'Move to trash' ] );
		expect( cell( rows[ 1 ] ) ).toEqual( [ 'Move to trash' ] );
	} );

	it( 'takes a row trashed from its own menu out of the bulk selection', async () => {
		const { root, dispatch } = mount( [ row( 1 ), row( 2 ) ] );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & { selection: ReadonlySet< number >; setSelected: ( ids: number[], on: boolean ) => void };
		table.setSelected( [ 1, 2 ], true );
		( root.querySelector( '[data-story-id="2"] os-context-menu-option[value="trash"]' ) as HTMLElement ).click();
		await vi.waitFor( () => expect( dispatch ).toHaveBeenCalledWith( 'trash', { ids: [ 2 ] } ) );
		await vi.waitFor( () => expect( Array.from( table.selection ) ).toEqual( [ 1 ] ) );
	} );

	it( 'keeps a menu on every card when the list changes under it', () => {
		const { root, ctx } = mount( [ row( 1 ), row( 2 ), row( 3 ) ] );
		( ctx as { data: ListData } ).data = { list: { items: [ row( 2 ), row( 3 ) ], total: 2, pages: 1, page: 1, perPage: 20, error: '', code: '' } };
		app.render( ctx );
		app.render( ctx );
		expect( Array.from( root.querySelectorAll( '[data-story-id]' ) ).map( ( card ) => [ card.getAttribute( 'data-story-id' ), !! card.querySelector( 'os-action-menu' ) ] ) )
			.toEqual( [ [ '2', true ], [ '3', true ] ] );
	} );

	it( 'Shift+click on a card checkbox selects every loaded card from the last one toggled', async () => {
		const { root } = mount( [ 1, 2, 3, 4, 5, 6 ].map( ( id ) => row( id ) ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		const click = ( id: number, shiftKey = false ): void => {
			root.querySelector( `[data-story-id="${ id }"] os-checkbox` )!.shadowRoot!.querySelector( 'input' )!
				.dispatchEvent( new MouseEvent( 'click', { bubbles: true, composed: true, shiftKey } ) );
		};
		click( 2 );
		click( 5, true );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & { selection: ReadonlySet< number > };
		expect( Array.from( table.selection ).sort() ).toEqual( [ 2, 3, 4, 5 ] );
		expect( root.querySelector( '[data-os-posts-count]' )?.textContent ).toBe( '4 selected' );
	} );

	it( 'offers "Switch to draft" before "Move to trash", confirms, and dispatches it over the selection', async () => {
		const select = ( root: HTMLElement, ids: number[] ): void => {
			const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & { selection: number[] };
			table.selection = ids;
			table.dispatchEvent( new CustomEvent( 'os-table-selection-change' ) );
		};
		const { root, ctx, dispatch } = mount( [ row( 1 ), row( 2 ) ] );
		select( root, [ 1, 2 ] );
		const buttons = Array.from( root.querySelectorAll( '[data-os-posts-bulk-action]' ) ).map( ( b ) => b.getAttribute( 'data-os-posts-bulk-action' ) );
		expect( buttons ).toEqual( [ 'draft', 'trash' ] );
		( root.querySelector( '[data-os-posts-bulk-action="draft"]' ) as HTMLElement ).click();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( ctx.host.confirm ).toHaveBeenCalledWith( {
			message: 'Switch 2 pages to draft? Published pages will no longer be visible on the site.',
			danger: true,
		} );
		expect( dispatch ).toHaveBeenCalledWith( 'draft', { ids: [ 1, 2 ] } );
		// Nothing to switch in the Trash and Drafts views.
		for ( const [ status, shown ] of [ [ 'trash', 'restore' ], [ 'draft', 'trash' ] ] ) {
			document.body.replaceChildren();
			const view = mount( [ row( 1, { status } ) ], {}, { status } ).root;
			select( view, [ 1 ] );
			expect( Array.from( view.querySelectorAll( '[data-os-posts-bulk-action]' ) ).map( ( b ) => b.getAttribute( 'data-os-posts-bulk-action' ) ) ).toEqual( [ shown ] );
		}
	} );

	it( 'says "No pages" when empty', () => {
		const { root } = mount( [] );
		expect( root.querySelector( '.os-posts-desk__empty h3' )?.textContent ).toBe( 'No pages found.' );
	} );

	it( 'the ⋯ menu lists togglable page columns and toggling writes nativePagesHiddenColumns', () => {
		const update = vi.fn();
		( window as unknown as { wp: { os: { getOsSettings: unknown; updateOsSettings: unknown; subscribeOsSettings: unknown } } } ).wp.os = {
			getOsSettings: () => ( { nativePagesHiddenColumns: [] } ),
			updateOsSettings: update,
			subscribeOsSettings: () => () => undefined,
		};
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const panel = document.createElement( 'div' );
		panel.className = 'os-window__menu-panel';
		win.appendChild( panel );
		document.body.appendChild( win );
		const { ctx, root } = mount( [ row( 1 ) ] );
		win.appendChild( root );
		app.mounted?.( ctx );
		const items = Array.from( panel.querySelectorAll( 'os-menu-item' ) ).map( ( el ) => el.getAttribute( 'value' ) );
		expect( items ).toEqual( [
			'desktop-mode-pages:author',
			'desktop-mode-pages:parent',
			'desktop-mode-pages:template',
			'desktop-mode-pages:slug',
			'desktop-mode-pages:comments',
			'desktop-mode-pages:date',
		] );
		panel.dispatchEvent( new CustomEvent( 'os-menu-item-click', { detail: { value: 'desktop-mode-pages:author' } } ) );
		expect( update ).toHaveBeenCalledWith( { nativePagesHiddenColumns: [ 'author' ] }, { windowId: 'test-window' } );
	} );

	it( 'paints the author column in Pages when only Posts hid it', () => {
		( window as unknown as { wp: { os: { getOsSettings: unknown } } } ).wp.os.getOsSettings = () => ( {
			nativePostsHiddenColumns: [ 'author' ],
			nativePagesHiddenColumns: [],
		} );
		const { root } = mount( [ row( 1 ) ] );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & {
			columns?: Array< { key: string } >;
		};
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toContain( 'author' );
	} );

	it( 'the Pages column menu shows Author checked when only Posts hid it', () => {
		( window as unknown as { wp: { os: { getOsSettings: unknown } } } ).wp.os.getOsSettings = () => ( {
			nativePostsHiddenColumns: [ 'author' ],
			nativePagesHiddenColumns: [],
		} );
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const panel = document.createElement( 'div' );
		panel.className = 'os-window__menu-panel';
		win.appendChild( panel );
		document.body.appendChild( win );
		const { ctx, root } = mount( [ row( 1 ) ] );
		win.appendChild( root );
		app.mounted?.( ctx );
		const authorItem = panel.querySelector( 'os-menu-item[value="desktop-mode-pages:author"]' );
		expect( authorItem?.hasAttribute( 'checked' ) ).toBe( true );
	} );

	it( 'toggling a Pages column writes only that column, not the Posts set', () => {
		const update = vi.fn();
		( window as unknown as { wp: { os: { getOsSettings: unknown; updateOsSettings: unknown; subscribeOsSettings: unknown } } } ).wp.os = {
			getOsSettings: () => ( {
				nativePostsHiddenColumns: [ 'author' ],
				nativePagesHiddenColumns: [],
			} ),
			updateOsSettings: update,
			subscribeOsSettings: () => () => undefined,
		};
		const win = document.createElement( 'div' );
		win.className = 'os-window';
		const panel = document.createElement( 'div' );
		panel.className = 'os-window__menu-panel';
		win.appendChild( panel );
		document.body.appendChild( win );
		const { ctx, root } = mount( [ row( 1 ) ] );
		win.appendChild( root );
		app.mounted?.( ctx );
		panel.dispatchEvent( new CustomEvent( 'os-menu-item-click', { detail: { value: 'desktop-mode-pages:parent' } } ) );
		expect( update ).toHaveBeenCalledWith( { nativePagesHiddenColumns: [ 'parent' ] }, { windowId: 'test-window' } );
	} );

	describe( 'quick edit', () => {
		const flush = () => new Promise( ( r ) => setTimeout( r, 0 ) );
		const json = ( body: unknown, status = 200, headers: Record< string, string > = {} ) =>
			new Response( JSON.stringify( body ), { status, headers: { 'Content-Type': 'application/json', ...headers } } );

		/** Core's answers to the two reads, and `save` for the write. */
		function stubRest( save: () => Response ) {
			return vi.spyOn( globalThis, 'fetch' ).mockImplementation( async ( input, init ) => {
				if ( init?.method === 'POST' ) {
					return save();
				}
				if ( String( input ).startsWith( 'wp/v2/pages/5?' ) ) {
					return json( {
						id: 5, title: { raw: 'Scratch' }, slug: 'scratch', status: 'publish', parent: 0,
						menu_order: 0, template: '', comment_status: 'open', _links: { 'wp:action-publish': [ { href: 'x' } ] },
					} );
				}
				return json( [ { id: 5, title: { rendered: 'Scratch' }, parent: 0, menu_order: 0 } ], 200, { 'X-WP-TotalPages': '1' } );
			} );
		}

		async function openOn( root: HTMLElement ): Promise< HTMLElement > {
			( root.querySelector( '[data-story-id="5"] [data-os-pages-quick-edit]' ) as HTMLElement ).click();
			await flush();
			await flush();
			return root.querySelector( 'os-modal.os-posts-quick-edit' ) as HTMLElement;
		}

		afterEach( () => vi.restoreAllMocks() );

		it( 'is offered on a published row, and not on a trashed or a locked one', async () => {
			const lock = { userId: 2, userName: 'Bo', userAvatarUrl: '', time: '2026-01-01T00:00:00Z' };
			const { root } = mount( [ row( 1 ), row( 2, { status: 'trash' } ), row( 3, { openstation_lock: lock } ) ] );
			await flush();
			expect( root.querySelector( '[data-story-id="1"] [data-os-pages-quick-edit="1"]' ) ).not.toBeNull();
			expect( root.querySelector( '[data-story-id="2"] [data-os-pages-quick-edit]' ) ).toBeNull();
			expect( root.querySelector( '[data-story-id="3"] [data-os-pages-quick-edit]' ) ).toBeNull();
			const cells = ( root.querySelector( '[data-os-posts-table]' ) as HTMLElement ).shadowRoot!;
			expect( Array.from( cells.querySelectorAll( '[data-os-pages-quick-edit]' ) ).map( ( el ) => el.getAttribute( 'data-os-pages-quick-edit' ) ) ).toEqual( [ '1' ] );
		} );

		it( 'saves only the changed fields to the page, then refreshes the list', async () => {
			const fetch = stubRest( () => json( { id: 5 } ) );
			const { root, ctx, dispatch } = mount( [ row( 5 ) ] );
			ctx.host.announce = vi.fn();
			const modal = await openOn( root );
			expect( modal.getAttribute( 'title' ) ).toBe( 'Quick edit' );
			modal.querySelector( '[data-field="title"]' )!.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 'Scratch v2' } } ) );
			modal.querySelector( '[data-field="menu_order"]' )!.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 3 } } ) );
			( modal.querySelector( '[data-os-pages-quick-edit-save]' ) as HTMLElement ).click();
			await flush();
			const post = fetch.mock.calls.filter( ( [ , init ] ) => init?.method === 'POST' );
			expect( post ).toHaveLength( 1 );
			expect( post[ 0 ][ 0 ] ).toBe( 'wp/v2/pages/5' );
			expect( JSON.parse( String( post[ 0 ][ 1 ]!.body ) ) ).toEqual( { title: 'Scratch v2', menu_order: 3 } );
			expect( ctx.host.announce ).toHaveBeenCalledWith( 'page', 'updated', [ 5 ] );
			expect( dispatch ).toHaveBeenCalledWith( 'refresh' );
			expect( root.querySelector( 'os-modal.os-posts-quick-edit' ) ).toBeNull();
		} );

		it( 'keeps the dialog and what was typed when the save is refused, and says why', async () => {
			stubRest( () => json( { code: 'rest_post_invalid_id', message: 'Invalid post ID.' }, 404 ) );
			const { root, dispatch } = mount( [ row( 5 ) ] );
			const modal = await openOn( root );
			modal.querySelector( '[data-field="title"]' )!.dispatchEvent( new CustomEvent( 'os-input-change', { detail: { value: 'Scratch v2' } } ) );
			( modal.querySelector( '[data-os-pages-quick-edit-save]' ) as HTMLElement ).click();
			await flush();
			expect( root.querySelector( 'os-modal.os-posts-quick-edit' ) ).toBe( modal );
			expect( modal.querySelector( '[data-field="title"]' )!.getAttribute( 'value' ) ).toBe( 'Scratch v2' );
			expect( modal.querySelector( 'os-notice[tone="danger"]' )?.textContent ).toBe( 'Invalid post ID.' );
			const save = modal.querySelector( '[data-os-pages-quick-edit-save]' )!;
			expect( save.hasAttribute( 'busy' ) || save.hasAttribute( 'disabled' ) ).toBe( false );
			expect( dispatch ).not.toHaveBeenCalledWith( 'refresh' );
		} );
	} );

	it( 'rebuilds page columns when nativePagesHiddenColumns changes elsewhere', () => {
		let settingsListener: ( () => void ) | null = null;
		( window as unknown as { wp: { os: { getOsSettings: unknown; subscribeOsSettings: unknown } } } ).wp.os = {
			getOsSettings: () => ( { nativePagesHiddenColumns: [] } ),
			subscribeOsSettings: ( cb: () => void ) => {
				settingsListener = cb;
				return () => undefined;
			},
		};
		const { ctx, root } = mount( [ row( 1 ) ] );
		app.mounted?.( ctx );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & {
			columns?: Array< { key: string } >;
		};
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toContain( 'author' );
		( window as unknown as { wp: { os: { getOsSettings: unknown } } } ).wp.os.getOsSettings = () => ( { nativePagesHiddenColumns: [ 'author' ] } );
		settingsListener!();
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).not.toContain( 'author' );
	} );
} );
