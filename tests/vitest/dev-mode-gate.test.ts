/**
 * Unit tests for `src/widgets/dev-mode-gate.ts` — the Starter Widget
 * developer-mode gate. Drives it with a fake `OsSettings` double (same
 * pattern as `unfocus-engine.test.ts`) and a fake `WidgetLayer` double
 * so we can assert the filter + live mount/unmount behaviour without
 * standing up the full shell.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type { OsSettings } from '../../src/settings';
import type { OsSettingsSnapshot } from '../../src/settings/registry';
import type { WidgetLayer } from '../../src/widgets/layer';
import type { WidgetDef } from '../../src/widgets/types';

const STARTER_ID = 'desktop-mode/starter';

function makeOsSettings( developerModeEnabled: boolean ): {
	osSettings: OsSettings;
	setDeveloperMode: ( enabled: boolean ) => void;
} {
	let snapshot = { developerModeEnabled } as unknown as OsSettingsSnapshot;
	let cb: ( ( s: OsSettingsSnapshot ) => void ) | null = null;
	const osSettings = {
		getOsSettingsSnapshot: () => snapshot,
		subscribeOsSettings: ( fn: ( s: OsSettingsSnapshot ) => void ) => {
			cb = fn;
			return () => {
				cb = null;
			};
		},
	} as unknown as OsSettings;
	const setDeveloperMode = ( enabled: boolean ): void => {
		snapshot = { developerModeEnabled: enabled } as unknown as OsSettingsSnapshot;
		cb?.( snapshot );
	};
	return { osSettings, setDeveloperMode };
}

function makeLayer(): { layer: WidgetLayer; mountIfEnabled: ReturnType< typeof vi.fn >; unmount: ReturnType< typeof vi.fn > } {
	const mountIfEnabled = vi.fn();
	const unmount = vi.fn();
	const layer = { mountIfEnabled, unmount } as unknown as WidgetLayer;
	return { layer, mountIfEnabled, unmount };
}

const starterDef: WidgetDef = {
	id: STARTER_ID,
	label: 'Starter',
	description: '',
	icon: 'dashicons-star-filled',
	mount: () => () => undefined,
};

const otherDef: WidgetDef = {
	id: 'clock',
	label: 'Clock',
	description: '',
	icon: 'dashicons-clock',
	mount: () => () => undefined,
};

async function loadModules(): Promise< {
	gate: typeof import( '../../src/widgets/dev-mode-gate' );
	registry: typeof import( '../../src/widgets/registry' );
} > {
	vi.resetModules();
	const gate = await import( '../../src/widgets/dev-mode-gate' );
	const registry = await import( '../../src/widgets/registry' );
	return { gate, registry };
}

describe( 'widgets/dev-mode-gate.ts', () => {
	beforeEach( () => {
		installHooksStub();
	} );
	afterEach( () => {
		clearHooksStub();
	} );

	test( 'hides the Starter Widget from the registry when developer mode is off', async () => {
		const { gate, registry } = await loadModules();
		registry.register( starterDef );
		registry.register( otherDef );
		const { osSettings } = makeOsSettings( false );
		const { layer } = makeLayer();

		gate.setupDevModeWidgetGate( { osSettings, layer } );

		expect( registry.all().map( ( w ) => w.id ) ).toEqual( [ 'clock' ] );
	} );

	test( 'keeps the Starter Widget in the registry when developer mode is on', async () => {
		const { gate, registry } = await loadModules();
		registry.register( starterDef );
		registry.register( otherDef );
		const { osSettings } = makeOsSettings( true );
		const { layer } = makeLayer();

		gate.setupDevModeWidgetGate( { osSettings, layer } );

		expect( registry.all().map( ( w ) => w.id ).sort() ).toEqual(
			[ 'clock', STARTER_ID ].sort(),
		);
	} );

	test( 'turning developer mode on live remounts a previously-enabled Starter Widget', async () => {
		const { gate, registry } = await loadModules();
		registry.register( starterDef );
		const { osSettings, setDeveloperMode } = makeOsSettings( false );
		const { layer, mountIfEnabled, unmount } = makeLayer();

		gate.setupDevModeWidgetGate( { osSettings, layer } );

		setDeveloperMode( true );

		expect( mountIfEnabled ).toHaveBeenCalledWith( STARTER_ID );
		expect( unmount ).not.toHaveBeenCalled();
		expect( registry.all().map( ( w ) => w.id ) ).toEqual( [ STARTER_ID ] );
	} );

	test( 'turning developer mode off live unmounts a placed Starter Widget', async () => {
		const { gate, registry } = await loadModules();
		registry.register( starterDef );
		const { osSettings, setDeveloperMode } = makeOsSettings( true );
		const { layer, mountIfEnabled, unmount } = makeLayer();

		gate.setupDevModeWidgetGate( { osSettings, layer } );

		setDeveloperMode( false );

		expect( unmount ).toHaveBeenCalledWith( STARTER_ID );
		expect( mountIfEnabled ).not.toHaveBeenCalled();
		expect( registry.all().map( ( w ) => w.id ) ).toEqual( [] );
	} );

	test( 'a no-op settings save (developer mode unchanged) does not remount/unmount', async () => {
		const { gate } = await loadModules();
		const { osSettings, setDeveloperMode } = makeOsSettings( false );
		const { layer, mountIfEnabled, unmount } = makeLayer();

		gate.setupDevModeWidgetGate( { osSettings, layer } );
		setDeveloperMode( false );

		expect( mountIfEnabled ).not.toHaveBeenCalled();
		expect( unmount ).not.toHaveBeenCalled();
	} );
} );
