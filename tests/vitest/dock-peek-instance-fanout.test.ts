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
			getAll: () => windows,
			getActiveDesktopId: () => 'default-1',
		} as unknown as WindowManager;

		const peekDeps: Parameters< typeof DockPeek.attachDockPeek >[ 0 ][] = [];
		const spy = vi
			.spyOn( DockPeek, 'attachDockPeek' )
			.mockImplementation( ( deps ) => {
				peekDeps.push( deps );
				return () => undefined;
			} );

		const item: DockItem = {
			id: 'desktop-mode-my-wordpress',
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

		const instances = peekDeps[ 0 ].getInstances();
		expect( instances.map( ( w ) => w.id ) ).toEqual( [
			'desktop-mode-my-wordpress',
			'os-my-wordpress-2',
		] );
	} );
} );
