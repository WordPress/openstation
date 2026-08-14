/**
 * Where a system tile lands on the rail.
 *
 * Tiles used to append in registration order, which looks deliberate
 * and is not: native-window tiles (Trash, and every plugin's) register
 * when their lazy script resolves, so a tile registered last in
 * `desktop.ts` could still be overtaken by one that arrived late.
 * `order` decides, and ties keep registration order.
 *
 * Load-bearing for the admin-bar relocation: Mio → Overview → System →
 * Trash has to hold whenever each of them happens to arrive.
 */

import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { Dock, type SystemDockItem } from '../../src/dock';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

function makeManagerStub(): WindowManager {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAllByBaseIdOnActiveDesktop: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

function tile(
	id: string,
	extra: Partial< SystemDockItem > = {},
): SystemDockItem {
	return {
		id,
		title: id,
		icon: 'dashicons-admin-generic',
		onOpen: () => {},
		...extra,
	};
}

/** Tile ids in the order they are painted inside one wrapper. */
function idsIn( container: HTMLElement, selector: string ): string[] {
	const host = container.querySelector< HTMLElement >( selector );
	if ( ! host ) {
		return [];
	}
	return Array.from(
		host.querySelectorAll< HTMLElement >( '.os-dock__item' ),
	).map( ( el ) => el.dataset.systemId ?? '' );
}

describe( 'system tile order', () => {
	let container: HTMLElement;
	let dock: Dock;

	beforeEach( () => {
		installHooksStub();
		container = document.createElement( 'nav' );
		container.className = 'os-dock';
		document.body.appendChild( container );
		dock = new Dock( container, makeManagerStub(), [], '/wp-admin/', 'bottom' );
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'a late arrival sorts by order, not by arrival', () => {
		dock.appendSystemItem( tile( 'os-mio', { order: 10 } ) );
		dock.appendSystemItem( tile( 'os-overview', { order: 20 } ) );
		dock.appendSystemItem( tile( 'os-system', { order: 30 } ) );
		// The Trash tile, arriving last because its script just
		// resolved. Unordered, so it belongs ahead of the shell's own
		// cluster rather than in the middle of it.
		dock.appendSystemItem( tile( 'desktop-mode-recycle-bin' ) );

		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'desktop-mode-recycle-bin',
			'os-mio',
			'os-overview',
			'os-system',
		] );
	} );

	test( 'equal orders keep registration order', () => {
		dock.appendSystemItem( tile( 'first' ) );
		dock.appendSystemItem( tile( 'second' ) );
		dock.appendSystemItem( tile( 'third' ) );

		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'first',
			'second',
			'third',
		] );
	} );

} );

describe( 'the constellation handshake', () => {
	let container: HTMLElement;
	let dock: Dock;

	beforeEach( () => {
		installHooksStub();
		container = document.createElement( 'nav' );
		container.className = 'os-dock';
		document.body.appendChild( container );
		dock = new Dock( container, makeManagerStub(), [], '/wp-admin/', 'bottom' );
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	/*
	 * `data-constellation-id` is how a system tile asks for a flyout,
	 * and it is also what `dock-peek` reads to stand down. A tile with
	 * a submenu that did not carry it would get a hover-peek AND no
	 * menu — the exact inversion of what it asked for.
	 */
	test( 'a submenu-bearing tile advertises itself to the flyout', () => {
		dock.appendSystemItem(
			tile( 'os-system', {
				submenu: [ { title: 'Log out', url: '' } ],
			} ),
		);
		const el = container.querySelector< HTMLElement >(
			'[data-system-id="os-system"]',
		);
		expect( el?.dataset.constellationId ).toBe( 'os-system' );
	} );

	test( 'a plain tile does not', () => {
		dock.appendSystemItem( tile( 'os-mio' ) );
		const el = container.querySelector< HTMLElement >(
			'[data-system-id="os-mio"]',
		);
		expect( el?.dataset.constellationId ).toBeUndefined();
	} );

	test( 'an empty submenu does not count as one', () => {
		dock.appendSystemItem( tile( 'os-empty', { submenu: [] } ) );
		const el = container.querySelector< HTMLElement >(
			'[data-system-id="os-empty"]',
		);
		expect( el?.dataset.constellationId ).toBeUndefined();
	} );
} );
