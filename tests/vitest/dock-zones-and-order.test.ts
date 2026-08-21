/**
 * Where a system tile lands on the rail.
 *
 * Two questions, and the tile answers both about ITSELF rather than
 * about when it happened to register. `navKind` says which zone —
 * `'control'` for one of OpenStation's own affordances, `'app'` (the
 * default) for a launcher, which sits with the plugin menus and gets
 * no divider between them. `order` says where within the zone, because
 * registration order cannot express it: native-window tiles register
 * when their lazy script resolves, so a tile registered last in
 * `desktop.ts` can still be overtaken by one that arrived late.
 *
 * Load-bearing for the admin-bar relocation: Mio → Overview → System →
 * Trash has to hold whenever each of them happens to arrive.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
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

/** A pointer event jsdom will carry, with the fields the drag reads. */
function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
	target?: HTMLElement,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
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

	const control = ( id: string, order?: number ): SystemDockItem =>
		tile( id, { navKind: 'control', ...( order ? { order } : {} ) } );

	test( 'a late arrival sorts by order, not by arrival', () => {
		dock.appendSystemItem( control( 'os-mio', 10 ) );
		dock.appendSystemItem( control( 'os-overview', 20 ) );
		dock.appendSystemItem( control( 'os-system', 30 ) );
		// The Trash tile, arriving last because its script just
		// resolved. Unordered, so it belongs ahead of the shell's own
		// cluster rather than in the middle of it.
		dock.appendSystemItem( control( 'desktop-mode-recycle-bin' ) );

		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'desktop-mode-recycle-bin',
			'os-mio',
			'os-overview',
			'os-system',
		] );
	} );

	test( 'equal orders keep registration order', () => {
		dock.appendSystemItem( control( 'first' ) );
		dock.appendSystemItem( control( 'second' ) );
		dock.appendSystemItem( control( 'third' ) );

		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'first',
			'second',
			'third',
		] );
	} );

	test( 'a launcher lands with the apps, not with the controls', () => {
		// The default kind. A plugin's native-window tile belongs
		// beside the plugin menus — the divider before the controls is
		// the boundary between the site's things and the station's.
		dock.appendSystemItem( tile( 'my-plugin-window' ) );
		dock.appendSystemItem( control( 'os-system', 30 ) );

		expect( idsIn( container, '.os-dock__scroll' ) ).toEqual( [
			'my-plugin-window',
		] );
		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'os-system',
		] );
	} );

	/*
	 * Exit OpenStation is the one item that cannot be moved. It has no
	 * drag handler of its own, but that only stops it being PICKED UP:
	 * a neighbour's drag still hit-tests against it, and if the guard
	 * lets it match, the gesture reorders across it and writes its id
	 * into the persisted order. From then on every load paints Exit
	 * wherever it was dragged through.
	 */
	test( 'a locked tile is not a drop target for its neighbours', () => {
		const persisted: string[][] = [];
		( window as unknown as { wp: { os: unknown } } ).wp = {
			...( window as unknown as { wp?: object } ).wp,
			os: {
				getOsSettings: () => ( { navOrder: [] } ),
				updateOsSettings: ( patch: { navOrder?: string[] } ) => {
					if ( patch.navOrder ) {
						persisted.push( patch.navOrder );
					}
				},
			},
		};

		dock.appendSystemItem( control( 'os-system', 30 ) );
		dock.appendSystemItem( {
			...control( 'os-exit', 35 ),
			locked: true,
		} );
		dock.appendSystemItem( control( 'os-trash', 40 ) );

		const tileFor = ( id: string ) =>
			container.querySelector< HTMLElement >(
				`[data-system-id="${ id }"]`,
			)!;
		// Every tile reports the same box, so the midpoint test always
		// says "insert before" and the drag walks left one slot at a
		// time.
		for ( const el of container.querySelectorAll( '.os-dock__item' ) ) {
			( el as HTMLElement ).getBoundingClientRect = () =>
				( { left: 100, top: 0, width: 40, height: 40 } as DOMRect );
		}
		const exit = tileFor( 'os-exit' );
		expect( exit.dataset.navLocked ).toBeDefined();

		const trash = tileFor( 'os-trash' );
		// jsdom has no layout, so the hit test has to be supplied.
		( document as unknown as {
			elementFromPoint: ( x: number, y: number ) => Element | null;
		} ).elementFromPoint = () => exit;
		trash.dispatchEvent( pointerEvent( 'pointerdown', 100, 20, trash ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 40, 20 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 40, 20 ) );

		// Exit never moved, and never entered the persisted order.
		expect( idsIn( container, '.os-dock__pinned' ) ).toEqual( [
			'os-system',
			'os-exit',
			'os-trash',
		] );
		for ( const order of persisted ) {
			expect( order ).not.toContain( 'os-exit' );
		}
	} );

	test( 'the controls divider only appears once something precedes it', () => {
		dock.appendSystemItem( control( 'os-system', 30 ) );
		// Controls alone: no divider, or the rail opens with a rule
		// under nothing.
		expect(
			container.querySelector( '.os-dock__separator' ),
		).toBeNull();

		dock.appendSystemItem( tile( 'my-plugin-window' ) );
		expect(
			container.querySelector( '.os-dock__separator' ),
		).not.toBeNull();
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
