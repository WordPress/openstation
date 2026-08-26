/**
 * Tests for `Dock.setArt` — the counterpart to `setBadge` for a tile
 * whose icon means something different depending on state rather than
 * counting something.
 *
 * The properties worth pinning are the ones that broke while it was
 * being written:
 *
 *   - art recorded BEFORE the tile is resolved, because a caller
 *     setting art during boot beats the rail to the DOM (the Recycle
 *     Bin does exactly this), and the tile builders re-apply from the
 *     map. Getting this backwards drops the call on the floor and the
 *     tile silently keeps its registered icon;
 *   - the override survives `replaceItems()`, which rebuilds from the
 *     server payload and would otherwise revert the swap on the next
 *     plugin activation;
 *   - `''` restores the declared icon immediately, the way
 *     `setBadge( id, 0 )` removes the pill immediately;
 *   - a dashicon class is accepted, not just a data URI. `setArt`
 *     routes through the rail's own resolver for this reason.
 *
 * @group dock
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dock, type DockItem } from '../../src/dock';
import { activity } from '../../src/activity';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const ART = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

function makeManagerStub() {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAllByBaseIdOnActiveDesktop: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as ConstructorParameters< typeof Dock >[ 1 ];
}

function makeItem( overrides: Partial< DockItem > = {} ): DockItem {
	return {
		id: 'plugin-x',
		title: 'Plugin X',
		icon: 'dashicons-admin-plugins',
		url: 'http://localhost/wp-admin/admin.php?page=plugin-x',
		badge: 0,
		submenu: [],
		multi: false,
		...overrides,
	};
}

function mount( items: DockItem[] ) {
	const container = document.createElement( 'nav' );
	document.body.appendChild( container );
	const dock = new Dock(
		container,
		makeManagerStub(),
		items,
		'http://localhost/wp-admin/',
		'left',
	);
	return { container, dock };
}

function iconNode( container: HTMLElement, slug: string ): HTMLElement | null {
	return container.querySelector< HTMLElement >(
		`[data-menu-slug="${ slug }"] .os-dock__item-primary > *`,
	);
}

describe( 'Dock.setArt', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'repaints the tile it owns', () => {
		const { container, dock } = mount( [ makeItem() ] );
		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-admin-plugins',
			),
		).toBe( true );

		dock.setArt( 'plugin-x', ART );

		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-admin-plugins',
			),
		).toBe( false );
	} );

	test( 'accepts a dashicon class, not only a data URI', () => {
		const { container, dock } = mount( [ makeItem() ] );
		dock.setArt( 'plugin-x', 'dashicons-trash' );
		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-trash',
			),
		).toBe( true );
	} );

	test( 'publishes os/art-changed with the rail discriminator', () => {
		const { dock } = mount( [ makeItem() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		dock.setArt( 'plugin-x', ART );
		expect( cb ).toHaveBeenCalledWith(
			expect.objectContaining( { itemId: 'plugin-x', icon: ART } ),
		);
		off();
	} );

	test( 'an id this rail does not own is a silent no-op', () => {
		const { dock } = mount( [ makeItem() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		expect( () => dock.setArt( 'not-mine', ART ) ).not.toThrow();
		expect( cb ).not.toHaveBeenCalled();
		off();
	} );

	test( 'survives replaceItems — the live menu refresh', () => {
		const { container, dock } = mount( [ makeItem() ] );
		dock.setArt( 'plugin-x', ART );

		// The refresh rebuilds from the server payload, which still
		// carries the ORIGINAL icon.
		dock.replaceItems( [ makeItem( { title: 'Plugin X renamed' } ) ] );

		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-admin-plugins',
			),
		).toBe( false );
	} );

	test( 'art set before the tile exists lands when it renders', () => {
		const { container, dock } = mount( [] );
		dock.setArt( 'plugin-x', ART );
		dock.replaceItems( [ makeItem() ] );
		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-admin-plugins',
			),
		).toBe( false );
	} );

	test( '"" restores the declared icon immediately', () => {
		const { container, dock } = mount( [ makeItem() ] );
		dock.setArt( 'plugin-x', ART );
		dock.setArt( 'plugin-x', '' );
		expect(
			iconNode( container, 'plugin-x' )?.classList.contains(
				'dashicons-admin-plugins',
			),
		).toBe( true );
	} );

	test( 'clearing art that was never set does not emit', () => {
		const { dock } = mount( [ makeItem() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		dock.setArt( 'plugin-x', '' );
		expect( cb ).not.toHaveBeenCalled();
		off();
	} );
} );
