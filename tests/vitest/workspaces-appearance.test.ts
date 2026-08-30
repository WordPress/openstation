/**
 * A workspace's look is a VIEW over the user's settings.
 *
 * This file exists for one guarantee: **switching to a workspace and
 * back leaves the user's settings byte-identical.** Everything about
 * the feature is reversible only because of it — a desk they delete
 * must cost them nothing, and a wallpaper they never chose must not
 * quietly become theirs.
 *
 * The awkward case is the one at the bottom: a user opens Preferences
 * ON an overridden desk and changes something. That edit is theirs and
 * has to be saved; every key they did NOT touch has to go back to
 * what it was.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

/** The state `saveState` was last called with. */
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

/** A settings instance with only the pieces these tests touch. */
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
	// `apply()` paints the real shell; these tests are about state, so
	// it is stubbed to keep them from depending on the wallpaper layer.
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
			/* jsdom */
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
		// The second desk only names a wallpaper. Its accent must come
		// from the USER, not from the desk they just left.
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

		// The whole guarantee: a workspace's wallpaper must not quietly
		// become the user's own just because a save happened while
		// they were standing on that desk.
		expect( saved?.wallpaper ).toBe( 'galaxy' );
		expect( saved?.accent ).toBe( 'pulse' );
		// …and the desk still looks the way the workspace asked.
		expect( settings.state.wallpaper ).toBe( 'mono' );
	} );

	test( 'an edit made on an overridden desk is the user’s and is saved', () => {
		settings.state.wallpaper = 'galaxy';
		settings.state.accent = 'pulse';
		settings.setWorkspaceAppearance( {
			wallpaper: 'mono',
			accent: 'rose',
		} );

		// The user opens Preferences here and picks a new accent.
		settings.state.accent = 'teal';
		settings.save();

		// Their edit is theirs. The wallpaper they never touched goes
		// back to what it was.
		expect( saved?.accent ).toBe( 'teal' );
		expect( saved?.wallpaper ).toBe( 'galaxy' );
	} );

	test( 'with no override active, save writes the state as-is', () => {
		settings.state.wallpaper = 'sunset';
		settings.save();
		expect( saved?.wallpaper ).toBe( 'sunset' );
	} );
} );
