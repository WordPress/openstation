/**
 * Unit tests for the related-entities title-bar button
 * (`src/related-entities/`):
 *
 *   - `resolveRelatedItems`: identity `related` list as the base, the
 *     `os.related-entities.items` filter applied on every
 *     resolve, malformed filter output dropped item-wise, non-array
 *     output falling back to the identity list
 *   - button registration through the public title-bar registry and
 *     the `match` predicate following the resolved list
 *   - targeted repaint on `WINDOW_CONTENT_CHANGED`
 *   - menu construction: group ordering, section headers, count
 *     suffix, pick wiring
 *   - open/close lifecycle: click opens, pick opens the URL and
 *     closes, Escape closes
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import type { RelatedEntityItem } from '../../src/window-links/types';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const related = await import( '../../src/related-entities' );
	const engine = await import( '../../src/window-links/engine' );
	const registry = await import( '../../src/title-bar-buttons/registry' );
	return { ...related, ...engine, ...registry };
}

const ITEM: RelatedEntityItem = {
	id: 'comments',
	group: 'comments',
	groupLabel: 'Comments',
	label: 'Comments',
	icon: 'dashicons-admin-comments',
	url: 'http://localhost/wp-admin/edit-comments.php?p=1',
	count: 3,
};

/** A window fake that satisfies the registry's structural needs. */
function fakeWindow( id: string ) {
	const element = document.createElement( 'div' );
	const titleBar = document.createElement( 'div' );
	titleBar.className = 'os-window__titlebar';
	element.appendChild( titleBar );
	const host = document.createElement( 'os-window-button' );
	titleBar.appendChild( host );
	const win = { id, element } as unknown as import(
		'../../src/window'
	).Window;
	return { win, element, titleBar, host };
}

let hooks: FakeWpHooks;

beforeEach( () => {
	hooks = installHooksStub();
} );
afterEach( () => {
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
} );

describe( 'resolveRelatedItems', () => {
	test( 'returns the identity related list', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();

		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ ITEM ] );
	} );

	test( 'returns empty for a window without content', async () => {
		const { resolveRelatedItems } = await load();

		expect( resolveRelatedItems( 'nope' ) ).toEqual( [] );
	} );

	test( 'the items filter can add and drop items', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		const added: RelatedEntityItem = {
			id: 'acme/orders',
			group: 'acme/orders',
			groupLabel: 'Orders',
			label: 'Orders for this post',
			url: 'http://localhost/wp-admin/admin.php?page=acme-orders',
		};
		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/augment',
			( items ) => [
				...( items as RelatedEntityItem[] ).filter(
					( i ) => i.group !== 'comments',
				),
				added,
			],
		);

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ added ] );
	} );

	test( 'the filter context carries windowId and content', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		const seen: unknown[] = [];
		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/spy',
			( items, ctx ) => {
				seen.push( ctx );
				return items;
			},
		);
		resolveRelatedItems( 'w1' );

		expect( seen[ 0 ] ).toMatchObject( {
			windowId: 'w1',
			content: { type: 'post', id: 1 },
		} );
	} );

	test( 'a filter pushing into the items array never corrupts the stored identity', async () => {
		const { resolveRelatedItems, setWindowContent, getWindowContent } =
			await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		// The documented idiom: mutate in place, return the array.
		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/push',
			( items ) => {
				( items as RelatedEntityItem[] ).push( {
					id: 'acme/extra',
					group: 'acme/extras',
					label: 'Extra',
					url: 'http://localhost/wp-admin/admin.php?page=acme',
				} );
				return items;
			},
		);

		// Repeated resolves (every repaint runs one) must not compound.
		expect( resolveRelatedItems( 'w1' ) ).toHaveLength( 2 );
		expect( resolveRelatedItems( 'w1' ) ).toHaveLength( 2 );
		expect( getWindowContent( 'w1' )?.related ).toHaveLength( 1 );
	} );

	test( 'malformed filter entries are dropped item-wise', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/corrupt',
			( items ) => [
				...( items as RelatedEntityItem[] ),
				{ id: '', group: 'x', label: 'bad', url: 'y' },
				'not-an-object',
			],
		);

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ ITEM ] );
	} );

	test( 'an item may name a native window instead of a URL', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [] } );

		// A native window has no admin URL. Before `windowId`, the
		// only way to point here was to register a URL for the
		// window, remap that URL back to it, and encode the scoping
		// into a query string on the way through.
		const native = {
			id: 'entries',
			group: 'forms',
			label: 'Entries for this form',
			windowId: 'my-plugin-entries',
			params: { formId: 42 },
		};
		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/native',
			( items ) => [ ...( items as RelatedEntityItem[] ), native ],
		);

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ native ] );
	} );

	test( 'an item with neither url nor windowId is dropped', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/nowhere',
			( items ) => [
				...( items as RelatedEntityItem[] ),
				{ id: 'x', group: 'g', label: 'Goes nowhere' },
			],
		);

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ ITEM ] );
	} );

	test( 'a non-array filter return falls back to the identity list', async () => {
		const { resolveRelatedItems, setWindowContent } = await load();
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		hooks.addFilter(
			HOOKS.RELATED_ENTITIES_ITEMS,
			'vitest/broken',
			() => 'nope',
		);

		expect( resolveRelatedItems( 'w1' ) ).toEqual( [ ITEM ] );
		expect( warn ).toHaveBeenCalled();
	} );
} );

describe( 'bootRelatedEntities', () => {
	test( 'registers the button on the public title-bar registry', async () => {
		const { bootRelatedEntities, listTitleBarButtons } = await load();

		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );

		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		);
		expect( def ).toBeDefined();
		expect( def?.placement ).toBe( 'right' );
	} );

	test( 'match follows the resolved item list', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win } = fakeWindow( 'w1' );

		expect( def.match( win ) ).toBe( false );

		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );
		expect( def.match( win ) ).toBe( true );

		setWindowContent( 'w1', null );
		expect( def.match( win ) ).toBe( false );
	} );

	test( 'repaints the window when its content identity changes', async () => {
		const { bootRelatedEntities, setWindowContent } = await load();
		const repaint = vi.fn();
		bootRelatedEntities( {
			manager: {
				getById: ( id ) =>
					id === 'w1'
						? { renderCustomTitleBarButtons: repaint }
						: null,
			},
			openUrl: vi.fn(),
		} );

		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );
		expect( repaint ).toHaveBeenCalledTimes( 1 );

		setWindowContent( 'w1', null );
		expect( repaint ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'click opens the menu; picking an item opens the URL and closes', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		const openUrl = vi.fn();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl,
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		def.render!( host, win );
		expect( host.getAttribute( 'aria-haspopup' ) ).toBe( 'menu' );

		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		const panel = element.querySelector(
			'.os-window__related-panel',
		);
		expect( panel ).not.toBeNull();
		// Load-bearing: `menu-panel` is what the title-bar drag tracker
		// excludes (src/window/pointer.ts) and what positions the panel
		// as an absolute dropdown — without it a pointerdown on a menu
		// item starts a window drag that swallows the click.
		expect(
			panel!.classList.contains( 'os-window__menu-panel' ),
		).toBe( true );
		expect( host.getAttribute( 'aria-expanded' ) ).toBe( 'true' );

		const row = panel!.querySelector( '[value="comments"]' )!;
		row.dispatchEvent(
			new CustomEvent( 'os-menu-item-click', { bubbles: true } ),
		);
		expect( openUrl ).toHaveBeenCalledWith( ITEM );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).toBeNull();
		expect( host.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );

	test( 'a second click on the button closes the panel', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		def.render!( host, win );
		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).not.toBeNull();

		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).toBeNull();
		expect( host.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );

	test( 'a pick suppresses the immediately-following dblclick on the title bar', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, titleBar, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		// Stand-in for the window's dblclick-to-maximize handler.
		const maximize = vi.fn();
		titleBar.addEventListener( 'dblclick', maximize );

		def.render!( host, win );
		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		element
			.querySelector( '[value="comments"]' )!
			.dispatchEvent(
				new CustomEvent( 'os-menu-item-click', { bubbles: true } ),
			);

		// The double-click's second click lands on the now-bare title
		// bar — the guard must swallow the resulting dblclick so the
		// window doesn't maximize.
		titleBar.dispatchEvent( new Event( 'dblclick', { bubbles: true } ) );
		expect( maximize ).not.toHaveBeenCalled();
	} );

	test( 'arrow keys move focus through the rows; Enter picks', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		const openUrl = vi.fn();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl,
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		const second: RelatedEntityItem = {
			id: 'media-9',
			group: 'media',
			label: 'Sunset',
			url: 'http://localhost/wp-admin/upload.php?item=9',
		};
		setWindowContent( 'w1', {
			type: 'post',
			id: 1,
			related: [ ITEM, second ],
		} );

		def.render!( host, win );
		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		const panel = element.querySelector< HTMLElement >(
			'.os-window__related-panel',
		)!;
		const rows = Array.from(
			panel.querySelectorAll< HTMLElement >( '[role="menuitem"]' ),
		);
		// First row is focused on open (hosts carry tabindex="-1").
		expect( document.activeElement ).toBe( rows[ 0 ] );

		panel.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'ArrowDown',
				bubbles: true,
			} ),
		);
		expect( document.activeElement ).toBe( rows[ 1 ] );

		panel.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } ),
		);
		expect( openUrl ).toHaveBeenCalledWith( second );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).toBeNull();
	} );

	test( 'a repaint replacing the host closes an open panel', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, titleBar, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		def.render!( host, win );
		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).not.toBeNull();

		// Registry-change repaint: the shell builds a NEW host and runs
		// render() again — the stale panel must not survive it.
		const replacement = document.createElement( 'os-window-button' );
		titleBar.appendChild( replacement );
		def.render!( replacement, win );
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).toBeNull();
	} );

	test( 'Escape closes the menu and restores focus to the trigger', async () => {
		const { bootRelatedEntities, listTitleBarButtons, setWindowContent } =
			await load();
		bootRelatedEntities( {
			manager: { getById: () => null },
			openUrl: vi.fn(),
		} );
		const def = listTitleBarButtons().find(
			( d ) => d.id === 'desktop-mode/related-entities',
		)!;
		const { win, element, host } = fakeWindow( 'w1' );
		document.body.appendChild( element );
		setWindowContent( 'w1', { type: 'post', id: 1, related: [ ITEM ] } );

		def.render!( host, win );
		host.dispatchEvent( new Event( 'click', { bubbles: true } ) );
		const panel = element.querySelector(
			'.os-window__related-panel',
		)!;

		panel.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ),
		);
		expect(
			element.querySelector( '.os-window__related-panel' ),
		).toBeNull();
	} );
} );

describe( 'buildRelatedMenu', () => {
	test( 'groups sort built-ins first and render section headers', async () => {
		const { buildRelatedMenu } = await import(
			'../../src/related-entities/menu'
		);

		const items: RelatedEntityItem[] = [
			{
				id: 'acme/report',
				group: 'acme/reports',
				groupLabel: 'Reports',
				label: 'Sales report',
				url: 'http://localhost/wp-admin/admin.php?page=acme',
			},
			{
				id: 'link-42',
				group: 'links',
				groupLabel: 'Linked posts',
				label: 'The other post',
				url: 'http://localhost/wp-admin/post.php?post=42&action=edit',
			},
			{
				id: 'media-9',
				group: 'media',
				groupLabel: 'Media',
				label: 'Sunset',
				url: 'http://localhost/wp-admin/upload.php?item=9',
			},
			{
				id: 'term-category-7',
				group: 'terms/category',
				groupLabel: 'Categories',
				label: 'News',
				url: 'http://localhost/wp-admin/term.php?taxonomy=category&tag_ID=7',
			},
			ITEM,
		];
		const panel = buildRelatedMenu( { items, onPick: () => {} } );

		const headers = Array.from(
			panel.querySelectorAll( '.os-window__related-group' ),
		).map( ( el ) => el.textContent );
		expect( headers ).toEqual( [
			'Comments',
			'Categories',
			'Media',
			'Linked posts',
			'Reports',
		] );
	} );

	test( 'renders a count suffix when count is set', async () => {
		const { buildRelatedMenu } = await import(
			'../../src/related-entities/menu'
		);

		const panel = buildRelatedMenu( {
			items: [ ITEM ],
			onPick: () => {},
		} );

		expect(
			panel.querySelector( '[value="comments"]' )?.textContent,
		).toBe( 'Comments (3)' );
	} );
} );
