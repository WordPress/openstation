/**
 * Pages app — the Posts list body composed for pages: every string
 * picks the page noun, the hierarchical columns paint, and there are
 * no taxonomy tabs.
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

function mount( items: PostListItem[] ) {
	const root = document.createElement( 'div' );
	document.body.appendChild( root );
	const ctx = mockViewContext< ListState, ListData >( {
		state: { page: 1, perPage: 20, search: '', status: '', orderby: 'menu_order', order: 'asc', author: [], tag: [] },
		data: { list: { items, total: items.length, pages: items.length ? 1 : 0, page: 1, perPage: 20, error: '' } },
		root,
		extra: { mode: 'pages', newPostUrl: 'http://x.test/wp-admin/post-new.php?post_type=page', frontPageId: 1, pageTemplates: { '': 'Default template' } },
		host: { fetch: ( i, init ) => globalThis.fetch( i, init ), openUrl: vi.fn(), confirm: vi.fn( async () => true ) },
	} );
	ctx.repaint = () => app.render( ctx );
	app.render( ctx );
	return { root, ctx };
}

beforeEach( () => {
	( window as unknown as { wp?: unknown } ).wp = {
		os: { getOsSettings: () => ( { nativePostsHiddenColumns: [] } ) },
		hooks: { applyFilters: ( _n: string, v: unknown ) => v, doAction: () => undefined },
	};
} );

afterEach( () => {
	document.body.replaceChildren();
	delete ( window as unknown as { wp?: unknown } ).wp;
} );

describe( 'the pages view', () => {
	it( 'has no taxonomy tabs and reads as pages everywhere', () => {
		const { root, ctx } = mount( [ row( 1 ), row( 2 ) ] );
		expect( root.querySelector( 'os-tabs' ) ).toBeNull();
		expect( root.querySelector( '[data-os-posts-root]' )!.classList.contains( 'desktop-mode-pages' ) ).toBe( true );
		expect( root.querySelector( '[data-os-posts-search]' )!.getAttribute( 'placeholder' ) ).toBe( 'Search pages…' );
		expect( root.querySelector( '.os-app-list__pager-meta' )!.textContent!.trim() ).toBe( 'Page 1 of 1 · 2 pages' );
		expect( root.querySelector( '.os-app-list__empty p' )!.textContent ).toBe( 'No pages found.' );
		( root.querySelector( '[data-os-posts-new]' ) as HTMLElement ).click();
		expect( ctx.host.openUrl ).toHaveBeenCalledWith( 'http://x.test/wp-admin/post-new.php?post_type=page', 'Add New Page', 'dashicons-admin-page' );
	} );

	it( 'paints the hierarchical columns, sorted by menu order', () => {
		const { root } = mount( [ row( 1 ), row( 2, { parent: 1 } ) ] );
		const table = root.querySelector( '[data-os-posts-table]' ) as HTMLElement & {
			columns?: Array< { key: string } >;
			sort?: { key: string; direction: string };
		};
		expect( ( table.columns ?? [] ).map( ( c ) => c.key ) ).toEqual( [ 'title', 'author', 'parent', 'template', 'slug', 'comments', 'date' ] );
		// `menu_order` is no column, so no header wears a sort arrow —
		// the table refuses a sort it cannot show.
		expect( table.sort ).toBeNull();
	} );

	it( 'says "No pages" when empty', () => {
		const { root } = mount( [] );
		expect( root.querySelector( '.os-app-list__pager-meta' )!.textContent!.trim() ).toBe( 'No pages' );
	} );
} );
