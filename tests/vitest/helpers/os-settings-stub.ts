import { vi } from 'vitest';
import { cloneState, structuredDefaults } from '../../../src/settings/state';
import type { OsSettingsState } from '../../../src/settings/types';

export interface OsSettingsStub {

	state: OsSettingsState;
	updateOsSettings: ReturnType< typeof vi.fn >;
	resetOsSettings: ReturnType< typeof vi.fn >;
}

export function installOsSettingsStub( initial: Partial< OsSettingsState > = {} ): OsSettingsStub {
	const state: OsSettingsState = { ...structuredDefaults(), ...initial };
	const listeners = new Set< ( snapshot: OsSettingsState ) => void >();
	const notify = (): void => {
		for ( const cb of Array.from( listeners ) ) {
			cb( cloneState( state ) );
		}
	};
	const updateOsSettings = vi.fn( ( patch: Partial< OsSettingsState > ) => {
		Object.assign( state, patch );
		notify();
	} );
	const resetOsSettings = vi.fn( () => {
		Object.assign( state, structuredDefaults(), { customImage: state.customImage } );
		notify();
	} );
	const w = window as unknown as { wp?: { os?: Record< string, unknown > } };
	w.wp = {
		...( w.wp ?? {} ),
		os: {
			...( w.wp?.os ?? {} ),
			getOsSettings: () => cloneState( state ),
			updateOsSettings,
			resetOsSettings,
			subscribeOsSettings: ( cb: ( snapshot: OsSettingsState ) => void ) => {
				listeners.add( cb );
				return () => {
					listeners.delete( cb );
				};
			},
		},
	};
	return { state, updateOsSettings, resetOsSettings };
}
