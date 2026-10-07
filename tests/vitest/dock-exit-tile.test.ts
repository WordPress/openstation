import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { Dock } from '../../src/dock';
import { EXIT_OPENSTATION_TILE_ID } from '../../src/exit-openstation';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { WindowManager } from '../../src/window-manager';

function makeManagerStub(): WindowManager {
	return {
		getFocused: () => null,
		getAllByBaseId: () => [],
		getAll: () => [],
		getById: () => undefined,
		getActiveDesktopId: () => 'default-1',
	} as unknown as WindowManager;
}

describe( 'the Exit OpenStation tile', () => {
	let container: HTMLElement;

	beforeEach( () => {
		installHooksStub();
		container = document.createElement( 'nav' );
		container.id = 'os-dock';
		container.className = 'os-dock';
		document.body.appendChild( container );
	} );

	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'keeps the id the stylesheet selects on', () => {

		expect( EXIT_OPENSTATION_TILE_ID ).toBe( 'os-exit' );
	} );

	test( 'carries the id on the tile as data-system-id', () => {
		const dock = new Dock(
			container,
			makeManagerStub(),
			[],
			'/wp-admin/',
			'bottom',
		);
		dock.appendSystemItem( {
			id: EXIT_OPENSTATION_TILE_ID,
			title: 'Exit OpenStation',
			icon: 'dashicons-exit',
			onOpen: () => undefined,
		} );

		const tile = container.querySelector(
			`.os-dock__item[ data-system-id="${ EXIT_OPENSTATION_TILE_ID }" ]`,
		);
		expect( tile ).not.toBeNull();

		expect(
			tile!.querySelector( '.os-dock__item-primary' ),
		).not.toBeNull();

		dock.destroy();
	} );

	test( 'sits in the same pinned group as the other system tiles', () => {

		const dock = new Dock(
			container,
			makeManagerStub(),
			[],
			'/wp-admin/',
			'bottom',
		);
		dock.appendSystemItem( {
			id: 'desktop-mode-os-settings',
			title: 'OpenStation Preferences',
			icon: 'dashicons-admin-generic',
			onOpen: () => undefined,
		} );
		dock.appendSystemItem( {
			id: EXIT_OPENSTATION_TILE_ID,
			title: 'Exit OpenStation',
			icon: 'dashicons-exit',
			onOpen: () => undefined,
		} );

		const exit = container.querySelector(
			`[ data-system-id="${ EXIT_OPENSTATION_TILE_ID }" ]`,
		);
		const settings = container.querySelector(
			'[ data-system-id="desktop-mode-os-settings" ]',
		);
		expect( exit?.parentElement ).toBe( settings?.parentElement );

		dock.destroy();
	} );
} );
