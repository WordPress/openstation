/**
 * Regression: the dock-peek `getInstances` callback used to gate
 * "return all baseId-matching windows" on `item.multi`. Synthesized
 * dock tiles produced by `applyDockPlacement` for a wallpaper icon
 * promoted to the dock never carry `multi: true`, so even after the
 * Ghost Card spawned a real second native-window instance the next
 * hover only showed one thumbnail card. The fix routes both menu
 * tiles and system tiles through `getAllByBaseId(baseId)`.
 *
 * @group dock
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as DockPeek from '../../src/dock-peek';
import { Dock, type DockItem } from '../../src/dock';
import type { WindowManager } from '../../src/window-manager';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

function makeWindowStub( id: string, baseId: string ) {
	return {
		id,
		config: { title: 'My WordPress', icon: 'dashicons-wordpress', baseId },
	};
}

describe( 'Dock — dock-peek instance fan-out for synthesized icon tile', () => {
	beforeEach( () => installHooksStub() );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	} );

	test( 'getInstances returns every window sharing the resolved baseId even when multi is false', () => {
		// Two open windows: the original and a duplicate spawned via
		// the Ghost Card. The duplicate's id is `<baseId>-2` and its
		// config.baseId matches the original.
		const windows = [
			makeWindowStub( 'desktop-mode-my-wordpress', 'desktop-mode-my-wordpress' ),
			makeWindowStub(
				'os-my-wordpress-2',
				'desktop-mode-my-wordpress',
			),
		];

		const manager = {
			getFocused: () => null,
			getById: ( id: string ) =>
				windows.find( ( w ) => w.id === id ),
			getAllByBaseId: ( baseId: string ) =>
				windows.filter( ( w ) => w.config.baseId === baseId ),
			getAllByBaseIdOnActiveDesktop: ( baseId: string ) =>
				windows.filter( ( w ) => w.config.baseId === baseId ),
			getActiveDesktopId: () => 'default-1',
		} as unknown as WindowManager;

		const peekDeps: Parameters< typeof DockPeek.attachDockPeek >[ 0 ][] = [];
		const spy = vi
			.spyOn( DockPeek, 'attachDockPeek' )
			.mockImplementation( ( deps ) => {
				peekDeps.push( deps );
				return () => undefined;
			} );

		// Synthesized tile: same shape `applyDockPlacement` produces
		// for a wallpaper icon promoted to the dock that targets a
		// native window. `multi` is intentionally falsy — the bug
		// repro depends on it.
		const item: DockItem = {
			id: 'desktop:desktop-mode-my-wordpress',
			title: 'My WordPress',
			icon: 'dashicons-wordpress',
			url: '',
			windowId: 'desktop-mode-my-wordpress',
			badge: 0,
			submenu: [],
			multi: false,
			isCore: false,
		};

		const container = document.createElement( 'nav' );
		document.body.appendChild( container );
		new Dock( container, manager, [ item ], 'http://localhost/wp-admin/', 'left' );

		expect( spy ).toHaveBeenCalled();
		// `peekDeps[ 0 ]` is the menu-tile peek registration for our
		// synthesized item.
		const instances = peekDeps[ 0 ].getInstances();
		expect( instances.map( ( w ) => w.id ) ).toEqual( [
			'desktop-mode-my-wordpress',
			'os-my-wordpress-2',
		] );
	} );
} );
