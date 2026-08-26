/**
 * Unit tests for `src/reveals/engine.ts`.
 *
 * The engine's whole job is to answer "which reveal is active right
 * now?" for a shell bundle that is not the bundle where the user
 * picked it. That crossing is the part worth testing: the selection is
 * made in the lazy OS-Settings-panel bundle and read in the main shell
 * bundle, which is why the id lives in a shared store rather than in
 * module state (see AGENTS.md → "Cross-bundle state").
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import type { OsSettings } from '../../src/settings';
import type { OsSettingsSnapshot } from '../../src/settings/registry';

type Engine = typeof import( '../../src/reveals/engine' );

async function loadEngine(): Promise< Engine > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	// The registry has to be evaluated so the built-ins are seeded —
	// the engine resolves ids through it.
	await import( '../../src/reveals/registry' );
	return import( '../../src/reveals/engine' );
}

/** Minimal OsSettings stand-in: a snapshot plus a subscriber list. */
function makeOsSettings( initial: string ): {
	osSettings: OsSettings;
	emit: ( windowReveal: string ) => void;
} {
	let current = initial;
	const listeners: ( ( s: OsSettingsSnapshot ) => void )[] = [];
	const osSettings = {
		getOsSettingsSnapshot: () =>
			( { windowReveal: current } as OsSettingsSnapshot ),
		subscribeOsSettings: ( cb: ( s: OsSettingsSnapshot ) => void ) => {
			listeners.push( cb );
			return () => undefined;
		},
	} as unknown as OsSettings;
	return {
		osSettings,
		emit: ( windowReveal ) => {
			current = windowReveal;
			listeners.forEach( ( cb ) =>
				cb( { windowReveal } as OsSettingsSnapshot ),
			);
		},
	};
}

beforeEach( () => {
	installHooksStub();
} );
afterEach( () => {
	clearHooksStub();
} );

describe( 'reveals/engine.ts', () => {
	test( 'defaults to `none` before anything wires it up', async () => {
		const { getActiveWindowRevealId, getActiveWindowReveal } =
			await loadEngine();
		expect( getActiveWindowRevealId() ).toBe( 'none' );
		expect( getActiveWindowReveal() ).toBeNull();
	} );

	test( 'seeds from the OS Settings snapshot at boot', async () => {
		const { startWindowRevealEngine, getActiveWindowReveal } =
			await loadEngine();
		const { osSettings } = makeOsSettings( 'curtain' );
		startWindowRevealEngine( { osSettings } );
		expect( getActiveWindowReveal()?.id ).toBe( 'curtain' );
	} );

	test( 'follows later OS Settings changes', async () => {
		const { startWindowRevealEngine, getActiveWindowReveal } =
			await loadEngine();
		const { osSettings, emit } = makeOsSettings( 'sweep' );
		startWindowRevealEngine( { osSettings } );
		emit( 'blinds' );
		expect( getActiveWindowReveal()?.id ).toBe( 'blinds' );
	} );

	test( 'resolves an unknown id to null rather than to a built-in', async () => {
		const { setActiveWindowRevealId, getActiveWindowRevealId, getActiveWindowReveal } =
			await loadEngine();
		setActiveWindowRevealId( 'ghost/not-registered' );
		// The id is KEPT — a plugin that registers later starts working
		// without the user having to re-pick it.
		expect( getActiveWindowRevealId() ).toBe( 'ghost/not-registered' );
		expect( getActiveWindowReveal() ).toBeNull();
	} );

	test( 'a reveal registered after selection starts resolving', async () => {
		const { setActiveWindowRevealId, getActiveWindowReveal } =
			await loadEngine();
		const { registerWindowReveal } = await import(
			'../../src/reveals/registry'
		);
		setActiveWindowRevealId( 'acme/late' );
		expect( getActiveWindowReveal() ).toBeNull();
		registerWindowReveal( {
			id: 'acme/late',
			label: 'Late',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
		} );
		expect( getActiveWindowReveal()?.label ).toBe( 'Late' );
	} );

	test( 'an empty id normalizes to `none`', async () => {
		const { setActiveWindowRevealId, getActiveWindowRevealId } =
			await loadEngine();
		setActiveWindowRevealId( '' );
		expect( getActiveWindowRevealId() ).toBe( 'none' );
	} );
} );
