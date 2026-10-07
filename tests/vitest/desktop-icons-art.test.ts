import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	_resetIconArtForTests,
	getIconArt,
	renderDesktopIcons,
	setIconArt,
} from '../../src/desktop-icons';
import { activity } from '../../src/activity';
import type { DesktopIconServerEntry } from '../../src/types';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';

const FULL = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
const OTHER = 'data:image/svg+xml;base64,PHN2ZyBpZD0iYiI+PC9zdmc+';

function makeIcon(
	overrides: Partial< DesktopIconServerEntry > = {},
): DesktopIconServerEntry {
	return {
		id: 'os-bin',
		title: 'Trash',
		icon: 'dashicons-trash',
		window: 'os-bin',
		url: '',
		position: 10,
		...overrides,
	};
}

function mountGrid( icons: DesktopIconServerEntry[] ): HTMLElement {
	const host = document.createElement( 'section' );
	document.body.appendChild( host );
	const stubManager = {} as ConstructorParameters<
		typeof renderDesktopIcons
	>[ 2 ][ 'manager' ];
	renderDesktopIcons( host, icons, {
		openWindow: () => true,
		manager: stubManager,
	} );
	return host;
}

function mountFileTile( ref: string ): HTMLElement {
	const tile = document.createElement( 'os-tile' );
	tile.setAttribute( 'data-file-ref', ref );
	tile.setAttribute( 'icon', 'dashicons-trash' );
	document.body.appendChild( tile );
	return tile;
}

function imageNode( host: HTMLElement, iconId: string ): HTMLElement | null {
	return host.querySelector< HTMLElement >(
		`[data-icon-id="${ iconId }"] .os-icon__image`,
	);
}

describe( 'wp.os.icons.setArt', () => {
	beforeEach( () => {
		installHooksStub();
		_resetIconArtForTests();
	} );
	afterEach( () => {
		clearHooksStub();
		_resetIconArtForTests();
		document.body.innerHTML = '';
	} );

	test( 'repaints the tile in the Classic grid', () => {
		const host = mountGrid( [ makeIcon() ] );
		const before = imageNode( host, 'os-bin' );
		expect( before?.classList.contains( 'dashicons-trash' ) ).toBe( true );

		setIconArt( 'os-bin', FULL );

		const after = imageNode( host, 'os-bin' );
		expect( after ).not.toBeNull();
		expect( after?.classList.contains( 'dashicons-trash' ) ).toBe( false );
	} );

	test( 'repaints the Spatial placement for the same id', () => {
		const tile = mountFileTile( 'os-bin' );
		setIconArt( 'os-bin', FULL );
		expect( tile.getAttribute( 'icon' ) ).toBe( FULL );
	} );

	test( 'paints both layouts from one call', () => {
		const host = mountGrid( [ makeIcon() ] );
		const tile = mountFileTile( 'os-bin' );

		setIconArt( 'os-bin', FULL );

		expect( tile.getAttribute( 'icon' ) ).toBe( FULL );
		expect(
			imageNode( host, 'os-bin' )?.classList.contains( 'dashicons-trash' ),
		).toBe( false );
	} );

	test( 'is idempotent — same art does not emit twice', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		setIconArt( 'os-bin', FULL );
		setIconArt( 'os-bin', FULL );
		expect( cb ).toHaveBeenCalledTimes( 1 );
		off();
	} );

	test( 'publishes os/art-changed with rail: icon', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		setIconArt( 'os-bin', FULL );
		expect( cb ).toHaveBeenCalledWith(
			expect.objectContaining( {
				itemId: 'os-bin',
				icon: FULL,
				rail: 'icon',
			} ),
		);
		off();
	} );

	test( 'getArt reads the override back, and "" clears it', () => {
		mountGrid( [ makeIcon() ] );
		expect( getIconArt( 'os-bin' ) ).toBe( '' );
		setIconArt( 'os-bin', FULL );
		expect( getIconArt( 'os-bin' ) ).toBe( FULL );
		setIconArt( 'os-bin', '' );
		expect( getIconArt( 'os-bin' ) ).toBe( '' );
	} );

	test( 'an unknown id is a silent no-op, not a throw', () => {
		mountGrid( [ makeIcon() ] );
		const cb = vi.fn();
		const off = activity.subscribe( 'os/art-changed', cb );
		expect( () => setIconArt( 'not-on-this-rail', FULL ) ).not.toThrow();

		expect( getIconArt( 'not-on-this-rail' ) ).toBe( FULL );
		off();
	} );

	test( 'survives a full grid rebuild', () => {
		const host = mountGrid( [ makeIcon() ] );
		setIconArt( 'os-bin', FULL );

		host.innerHTML = '';
		mountGrid( [ makeIcon( { title: 'Trash rebuilt' } ) ] );

		expect( getIconArt( 'os-bin' ) ).toBe( FULL );
	} );

	test( 'art set before the icon renders is applied when it appears', () => {
		setIconArt( 'os-bin', OTHER );
		const host = mountGrid( [ makeIcon() ] );
		expect(
			imageNode( host, 'os-bin' )?.classList.contains( 'dashicons-trash' ),
		).toBe( false );
	} );
} );
