import { afterEach, expect, test, vi } from 'vitest';
import { openItemVisibilityMenu } from '../../src/item-visibility-menu';

vi.mock( '../../src/shell-overlays/loader', () => ( {
	openWithShellOverlays: ( current: () => boolean, open: () => void ) => { if ( current() ) { open(); } },
} ) );

afterEach( () => { document.body.innerHTML = ''; vi.unstubAllGlobals(); } );

test( 'the dock menu restores a hidden wallpaper mascot without toggling the API', () => {
	let shown = false;
	const updateOsSettings = vi.fn( ( patch: { mioShowOnWallpaper: boolean } ) => { shown = patch.mioShowOnWallpaper; } );
	vi.stubGlobal( 'wp', { os: {
		getOsSettings: () => ( { mioEnabled: true, mioShowOnWallpaper: shown } ),
		getNavItems: () => [ { id: 'os-mio-toggle', kind: 'control', title: 'Mio' } ],
		updateOsSettings,
	} } );
	const open = () => openItemVisibilityMenu( { x: 80, y: 90, id: 'os-mio-toggle', title: 'Mio', surface: 'dock' } );
	open();
	let option = document.querySelector( '[data-menu-item-id="mio-wallpaper"]' )!;
	expect( option.textContent ).toBe( 'Show MIO on wallpaper' );
	option.parentElement!.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id: 'mio-wallpaper' } } ) );
	expect( updateOsSettings ).toHaveBeenLastCalledWith( { mioShowOnWallpaper: true } );
	open();
	option = document.querySelector( '[data-menu-item-id="mio-wallpaper"]' )!;
	expect( option.textContent ).toBe( 'Hide MIO on wallpaper' );
	option.parentElement!.dispatchEvent( new CustomEvent( 'os-context-menu-pick', { detail: { id: 'mio-wallpaper' } } ) );
	expect( updateOsSettings ).toHaveBeenLastCalledWith( { mioShowOnWallpaper: false } );
} );
