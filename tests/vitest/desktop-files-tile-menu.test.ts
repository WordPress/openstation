/**
 * Tests for the file-tile context menu (right-click on a tile).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

async function load() {
	vi.resetModules();
	return await import( '../../src/desktop-files/tile-menu' );
}

const placement = ( type: 'post' | 'folder' ) => ( {
	id: 99,
	parentId: 0,
	x: 0,
	y: 0,
	sortOrder: 0,
	updatedAtMs: 1,
	meta: null,
	file: {
		type,
		ref: type === 'folder' ? '7' : '13',
		title: 'X',
		icon: 'dashicons-warning',
		previewUrl: '',
		exists: true,
	},
} );

describe( 'tile context menu', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
		document.body.innerHTML = '';
	} );

	test( 'open mounts a menu with the items provided', async () => {
		const mod = await load();
		const onClick = vi.fn();
		mod.openTileMenu(
			{ x: 50, y: 60 },
			{
				placement: placement( 'post' ),
				items: [
					{ id: 'open', label: 'Open', sort: 10, onClick },
					{ id: 'remove', label: 'Remove', sort: 90, danger: true, onClick: vi.fn() },
				],
			},
		);
		const menu = document.querySelector< HTMLElement >( 'os-context-menu' );
		expect( menu ).not.toBeNull();
		expect( menu?.dataset.placementId ).toBe( '99' );
		const opts = menu!.querySelectorAll( 'os-context-menu-option' );
		expect( opts.length ).toBe( 2 );
		( opts[ 0 ] as HTMLElement ).click();
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'danger items get the danger class', async () => {
		const mod = await load();
		mod.openTileMenu(
			{ x: 0, y: 0 },
			{
				placement: placement( 'post' ),
				items: [
					{ id: 'remove', label: 'Remove', danger: true, onClick: vi.fn() },
				],
			},
		);
		const btn = document.querySelector( '[data-menu-item-id="remove"]' );
		expect( btn?.hasAttribute( 'danger' ) ).toBe( true );
	} );

	test( 'os.files.tile-menu filter can mutate items', async () => {
		const mod = await load();
		const stub = ( window.wp as { hooks: { addFilter: ( ...a: unknown[] ) => void } } ).hooks;
		stub.addFilter(
			'os.files.tile-menu',
			'test/extra',
			( items ) => [
				...( items as Array< Record< string, unknown > > ),
				{ id: 'extra', label: 'Extra', sort: 50, onClick: vi.fn() },
			],
		);
		mod.openTileMenu(
			{ x: 0, y: 0 },
			{
				placement: placement( 'post' ),
				items: [ { id: 'open', label: 'Open', onClick: vi.fn() } ],
			},
		);
		expect( document.querySelector( '[data-menu-item-id="extra"]' ) ).not.toBeNull();
	} );

	test( 'Escape closes', async () => {
		const mod = await load();
		mod.openTileMenu(
			{ x: 0, y: 0 },
			{
				placement: placement( 'folder' ),
				items: [ { id: 'open', label: 'Open', onClick: vi.fn() } ],
			},
		);
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		expect( document.querySelector( 'os-context-menu' ) ).toBeNull();
	} );
} );
