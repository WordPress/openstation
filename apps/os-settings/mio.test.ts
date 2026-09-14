import type { MioCallContext } from '../../src/mio/assistant/types';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { preferencesMioAbilities } from './parts/mio-actions';
import { preferencesMioDocuments } from './parts/mio';
import { MioSession } from '../../src/mio/assistant/session';
import { linkedMioHelp } from '../../src/mio/assistant/help';
import {
	installOsSettingsStub,
	type OsSettingsStub,
} from '../../tests/vitest/helpers/os-settings-stub';
import { appData, appExtra } from '../../tests/vitest/helpers/os-settings-app';
import { installHooksStub, clearHooksStub } from '../../tests/vitest/helpers/hooks-stub';
import { mockViewContext } from '../../src/app-runtime/testing';
import { uiOf, type Ctx } from './parts/types';
import type { MioTransport } from '../../src/mio/assistant/types';

const callContext = { turnId: 'test', callId: 'test:1', idempotencyKey: 'test:1', effect: 'write', limits: { rounds: 8, calls: 16, validationFailures: 3, repeatedReads: 4 }, validationFailures: 0, validationRemaining: 3, signal: new AbortController().signal } as MioCallContext;

let stub: OsSettingsStub;
let ctx: Ctx;
beforeEach( () => {
	installHooksStub();
	stub = installOsSettingsStub();
	ctx = mockViewContext( { root: document.createElement( 'div' ),
		state: { tab: 'appearance' }, data: appData(), extra: appExtra() } );
	stub.updateOsSettings.mockImplementation( ( patch ) => {
		Object.assign( stub.state, patch );
		document.dispatchEvent(
			new CustomEvent( 'os-settings-save-lifecycle', { detail: { phase: 'saved', savedSettings: { ...stub.state } } } ),
		);
	} );
} );
afterEach( () => {
	clearHooksStub();
	vi.restoreAllMocks();
} );

describe( 'Preferences private MIO integration', () => {
	test( 'executes the requested three-action chain against the real Preferences adapter', async () => {
		const transport = vi
			.fn<MioTransport>()
			.mockResolvedValueOnce( {
				message: '',
				calls: [
					{ name: 'set_window_radius', arguments: '{"value":"round"}' },
					{ name: 'set_desktop_layout', arguments: '{"value":"unified"}' },
					{ name: 'set_dock_behavior', arguments: '{"value":"dynamic"}' },
				],
			} )
			.mockResolvedValueOnce( { message: 'Rounded corners and one dynamic dock.', calls: [] } );
		const session = new MioSession(
			{
				host: ctx.root,
				title: 'Preferences',
				documents: preferencesMioDocuments,
				prompt: () => JSON.stringify( stub.state ),
				abilities: () => preferencesMioAbilities( ctx ),
			},
			transport,
			() => true,
		);
		await session.ask( 'Round the corners, unify the docks and make them dynamic.' );
		expect( stub.state.windowRadius ).toBe( 'round' );
		expect( stub.state.desktopLayout ).toBe( 'unified' );
		expect( stub.state.dockBehavior ).toBe( 'dynamic' );
		expect( stub.updateOsSettings ).toHaveBeenCalledTimes( 3 );
	} );
	test( 'reports wallpaper before/after honestly, including a real no-op', async () => {
		stub.state.wallpaper = 'galaxy';
		const action = preferencesMioAbilities( ctx ).find( ( ability ) => ability.name === 'set_wallpaper' )!;
		const signal = new AbortController().signal;
		expect( await action.run( { value: 'dark' }, signal, callContext ) ).toMatchObject( {
			saved: true, changed: true, changes: [ { setting: 'wallpaper', before: 'galaxy', after: 'dark' } ],
		} );
		expect( await action.run( { value: 'dark' }, signal, callContext ) ).toMatchObject( { saved: true, changed: false, changes: [] } );
	} );
	test( 'does not mistake an earlier concurrent save for confirmation of its own change', async () => {
		const before = { ...stub.state };
		stub.updateOsSettings.mockImplementation( ( patch ) => {
			Object.assign( stub.state, patch );
		} );
		const action = preferencesMioAbilities( ctx ).find( ( a ) => a.name === 'set_window_radius' )!;
		let resolved = false;
		const pending = action.run( { value: 'round' }, new AbortController().signal, callContext ) as Promise<unknown>;
		void pending.then( () => {
			resolved = true;
		} );
		document.dispatchEvent( new CustomEvent( 'os-settings-save-lifecycle', { detail: { phase: 'saved', savedSettings: { ...before, windowRadius: 'sharp' } } } ) );
		await Promise.resolve();
		expect( resolved ).toBe( false );
		document.dispatchEvent( new CustomEvent( 'os-settings-save-lifecycle', { detail: { phase: 'saved', savedSettings: { ...stub.state } } } ) );
		await pending;
		expect( resolved ).toBe( true );
	} );
	test( 'stops on a failed save without claiming success or running the next step', async () => {
		stub.updateOsSettings.mockImplementation( () =>
			document.dispatchEvent(
				new CustomEvent( 'os-settings-save-lifecycle', {
					detail: { phase: 'failed', error: 'Save failed' },
				} ),
			),
		);
		const action = preferencesMioAbilities( ctx ).find(
			( ability ) => ability.name === 'set_window_radius',
		)!;
		await expect( action.run( { value: 'round' }, new AbortController().signal, callContext ) ).rejects.toThrow(
			'Save failed',
		);
	} );
	test( 'offers every builtin control and rejects destructive dispatch and malformed settings', () => {
		const abilities = preferencesMioAbilities( ctx );
		const names = abilities.map( ( ability ) => ability.name );
		expect( new Set( names ).size ).toBe( names.length );
		expect( names.length ).toBeGreaterThanOrEqual( 60 );
		for ( const name of [
			'reset',
			'purge_shares',
			'delete_theme',
			'dispatch',
			'set_applied_theme_recommendations',
			'set_admin_asset_cache_enabled',
		] ) {
			expect( names ).not.toContain( name );
		}
		const corner = abilities.find( ( ability ) => ability.name === 'set_window_radius' )!;
		expect( corner.validate( { value: 'round' } ) ).toBe( true );
		expect( corner.validate( { value: 'rounded' } ) ).toBe( false );
		expect( corner.validate( { value: 'round', extra: true } ) ).toBe( false );
		expect(
			abilities
				.find( ( ability ) => ability.name === 'set_desktop_theme' )!
				.validate( { value: 'invented' } ),
		).toBe( false );
	} );
	test( 'clears only the wallpaper selection and initializes search on first use', async () => {
		vi.spyOn( ctx, 'fetch' );
		stub.state.wallpaper = 'custom-image';
		stub.state.customImage = { id: 19, url: 'https://example.test/photo.jpg' };
		const actions = preferencesMioAbilities( ctx );
		await actions.find( ( a ) => a.name === 'clear_wallpaper_image' )!.run( {}, new AbortController().signal, callContext );
		expect( stub.state.customImage ).toBeNull();
		expect( stub.state.wallpaper ).not.toBe( 'custom-image' );
		expect( ctx.fetch ).not.toHaveBeenCalled();
		ctx.root.innerHTML = '<os-tabpanel for="windows">Rounded corners</os-tabpanel>';
		await actions.find( ( a ) => a.name === 'search_settings' )!.run( { query: 'corners' }, new AbortController().signal, callContext );
		expect( uiOf( ctx ).search.index?.get( 'windows' ) ).toContain( 'corners' );
	} );
	test( 'administrator-only abilities disappear when capability is lost', () => {
		const ability = preferencesMioAbilities( ctx ).find(
			( entry ) => entry.name === 'set_extended_games',
		)!;
		expect( ability.allowed!() ).toBe( true );
		ctx.data.isAdmin = false;
		expect( ability.allowed!() ).toBe( false );
	} );
	test( 'ships a connected help collection and documents every offered action', () => {
		const text = preferencesMioDocuments.map( ( doc ) => doc.markdown ).join( '\n' );
		for ( const ability of preferencesMioAbilities( ctx ) ) {
			expect( text, ability.name ).toContain( ability.name );
		}
		const index = linkedMioHelp( preferencesMioDocuments, 'index.md' );
		expect( index.links ).toHaveLength( preferencesMioDocuments.length - 1 );
		for ( const doc of preferencesMioDocuments ) {
			expect( doc.markdown.length ).toBeGreaterThan( 1000 );
			expect( linkedMioHelp( preferencesMioDocuments, doc.id ).links.length ).toBeGreaterThan( 0 );
		}
	} );
} );
