/**
 * The Exit OpenStation tile's contract with the stylesheet.
 *
 * `dock.css` gives this one tile a treatment none of its neighbours
 * get: last in the rail, its own gap, a ring instead of a plate, and a
 * hover that leans toward the edge it leads to. Every one of those
 * rules is keyed on `[data-system-id="os-exit"]`, so the id and the
 * attribute that carries it are load-bearing UI, not internal detail.
 *
 * Nothing else would fail if either drifted: the tile would keep
 * working, keep opening the right flow, and quietly go back to looking
 * exactly like Preferences — which is the confusion the treatment
 * exists to answer. Hence a test for a data attribute.
 */

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
		// Frozen by the same reasoning as every other persisted id: the
		// value is reachable from CSS, from a theme's icon slot, and
		// from the Apps & Icons visibility map.
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
		// The rules reach the button through the tile, so the pair has
		// to survive together.
		expect(
			tile!.querySelector( '.os-dock__item-primary' ),
		).not.toBeNull();

		dock.destroy();
	} );

	test( 'sits in the same pinned group as the other system tiles', () => {
		// `order: 1` is what puts it last, and order only applies among
		// flex siblings — a tile in a different wrapper would be
		// unaffected by it however the rail was built.
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
