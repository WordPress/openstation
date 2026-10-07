import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

let saved: Record< string, unknown > | null = null;

vi.mock( '../../src/settings/state', async () => {
	const actual = await vi.importActual< Record< string, unknown > >(
		'../../src/settings/state',
	);
	return {
		...actual,
		saveState: ( state: Record< string, unknown > ) => {
			saved = state;
		},
	};
} );

async function makeSettings() {
	const { OsSettings } = await import( '../../src/settings' );
	const shell = document.createElement( 'div' );
	shell.id = 'os-shell';
	document.body.appendChild( shell );
	const settings = new OsSettings(
		{
			mediaUrl: '',
			restNonce: '',
			canUpload: false,
			isAdmin: false,
			extendedOptions: null,
			extendedOptionsUrl: '',
		},
		{ apply: () => undefined } as never,
	);

	settings.apply = () => undefined;
	return { settings, shell };
}

describe( 'workspace appearance — a view, never a write', () => {
	let shell: HTMLElement;
	let settings: Awaited< ReturnType< typeof makeSettings > >[ 'settings' ];

	beforeEach( async () => {
		installHooksStub();
		saved = null;
		try {
			window.localStorage.clear();
		} catch {

		}
		( { settings, shell } = await makeSettings() );
	} );

	afterEach( () => {
		shell.remove();
		clearHooksStub();
		vi.restoreAllMocks();
	} );

	test( 'an override repaints the state and hands it back on exit', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';

		settings.setWorkspaceAppearance( {
			wallpaper: 'mono',
			accent: 'rose',
		} );
		expect( settings.state.wallpaper ).toBe( 'mono' );
		expect( settings.state.accent ).toBe( 'rose' );

		settings.setWorkspaceAppearance( null );
		expect( settings.state.wallpaper ).toBe( 'galaxy' );
		expect( settings.state.accent ).toBe( 'pulse' );
	} );

	test( 'switching desk to desk patches the user base, not the last desk', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';

		settings.setWorkspaceAppearance( {
			wallpaper: 'mono',
			accent: 'rose',
		} );

		settings.setWorkspaceAppearance( { wallpaper: 'aurora' } );

		expect( settings.state.wallpaper ).toBe( 'aurora' );
		expect( settings.state.accent ).toBe( 'pulse' );
	} );

	test( 'an empty patch on a plain desk changes nothing', () => {
		settings.state.wallpaper = 'galaxy';
		settings.setWorkspaceAppearance( {} );
		expect( settings.state.wallpaper ).toBe( 'galaxy' );
		settings.setWorkspaceAppearance( null );
		expect( settings.state.wallpaper ).toBe( 'galaxy' );
	} );

	test( 'saving on an overridden desk keeps the user’s own values', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';
		settings.setWorkspaceAppearance( {
			wallpaper: 'mono',
			accent: 'rose',
		} );

		settings.save();

		expect( saved?.wallpaper ).toBe( 'galaxy' );
		expect( saved?.accent ).toBe( 'pulse' );

		expect( settings.state.wallpaper ).toBe( 'mono' );
	} );

	test( 'an edit made on an overridden desk is the user’s and is saved', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';
		settings.setWorkspaceAppearance( {
			wallpaper: 'mono',
			accent: 'rose',
		} );

		settings.state.accent = 'teal';
		settings.save();

		expect( saved?.accent ).toBe( 'teal' );
		expect( saved?.wallpaper ).toBe( 'galaxy' );
	} );

	test( 'an edit saved on an overridden desk is still there after leaving it', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';
		settings.setWorkspaceAppearance( { accent: 'rose' } );

		settings.update( { wallpaper: 'aurora' } );
		expect( saved?.wallpaper ).toBe( 'aurora' );

		settings.setWorkspaceAppearance( null );
		expect( settings.state.wallpaper ).toBe( 'aurora' );
		expect( settings.state.accent ).toBe( 'pulse' );
	} );

	test( 'an edit made IN PLACE on an overridden object key is still the user’s', () => {

		settings.state.wallpaperSettings = { 'living-tree': { density: 1 } };
		settings.setWorkspaceAppearance( {
			wallpaperSettings: { 'living-tree': { density: 3 } },
		} );

		settings.state.wallpaperSettings[ 'living-tree' ] = {
			...settings.state.wallpaperSettings[ 'living-tree' ],
			density: 5,
		};
		settings.save();

		expect( saved?.wallpaperSettings ).toEqual( { 'living-tree': { density: 5 } } );
	} );

	test( 'an untouched overridden object key still goes back to the user’s', () => {
		settings.state.wallpaperSettings = { 'living-tree': { density: 1 } };
		settings.setWorkspaceAppearance( {
			wallpaperSettings: { 'living-tree': { density: 3 } },
		} );
		settings.save();
		expect( saved?.wallpaperSettings ).toEqual( { 'living-tree': { density: 1 } } );

		expect( settings.state.wallpaperSettings ).toEqual( { 'living-tree': { density: 3 } } );
	} );

	test( 'with no override active, save writes the state as-is', () => {
		settings.state.wallpaper = 'sunset';
		settings.save();
		expect( saved?.wallpaper ).toBe( 'sunset' );
	} );
} );
