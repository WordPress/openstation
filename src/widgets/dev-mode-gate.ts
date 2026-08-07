/**
 * OpenStation — Starter Widget developer-mode gate.
 *
 * The Starter Widget (`desktop-mode/starter`) is a heavily-commented
 * skeleton for plugin authors, not a feature end users need in their
 * add-widget picker. This module hides it behind the "Enable
 * developer mode" toggle in OS Settings → Features:
 *
 *   - A `os.widgets` filter drops the starter def from
 *     every {@link registry.all} read (and therefore from `get()`,
 *     the picker, `hydrate()`, `add()`, and `ensureMounted()`) while
 *     developer mode is off. The def stays in the registry seed —
 *     server-sync keeps registering it — so turning developer mode
 *     back on is instant, no reload.
 *   - A live `subscribeOsSettings` listener unmounts/remounts any
 *     already-placed instance the moment the toggle flips, using the
 *     same `layer.unmount` / `layer.mountIfEnabled` path the
 *     plugin-deactivation sync uses — the user's "enabled" choice is
 *     preserved, only the on-screen presence changes.
 */

import { addFilter, HOOKS } from '../hooks';
import { refreshWidgetPicker } from './picker';
import type { WidgetDef } from './types';
import type { OsSettings } from '../settings';
import type { WidgetLayer } from './layer';

const STARTER_WIDGET_ID = 'desktop-mode/starter';
const FILTER_NAMESPACE = 'desktop-mode/dev-mode-gate';

let _started = false;

export interface DevModeWidgetGateDeps {
	osSettings: OsSettings;
	layer: WidgetLayer;
}

/**
 * Wire the Starter Widget developer-mode gate. Idempotent per shell
 * boot — call once, before {@link WidgetLayer#hydrate} so a
 * previously-placed Starter instance simply doesn't mount when
 * developer mode is off.
 */
export function setupDevModeWidgetGate( { osSettings, layer }: DevModeWidgetGateDeps ): void {
	if ( _started ) {
		return;
	}
	_started = true;

	addFilter<WidgetDef[]>(
		HOOKS.WIDGETS,
		FILTER_NAMESPACE,
		( defs ) => {
			if ( osSettings.getOsSettingsSnapshot().developerModeEnabled ) {
				return defs;
			}
			return defs.filter( ( def ) => def.id !== STARTER_WIDGET_ID );
		},
	);

	let developerModeEnabled = osSettings.getOsSettingsSnapshot().developerModeEnabled;

	osSettings.subscribeOsSettings( ( snapshot ) => {
		if ( snapshot.developerModeEnabled === developerModeEnabled ) {
			return;
		}
		developerModeEnabled = snapshot.developerModeEnabled;

		if ( developerModeEnabled ) {
			layer.mountIfEnabled( STARTER_WIDGET_ID );
		} else {
			layer.unmount( STARTER_WIDGET_ID );
		}
		refreshWidgetPicker();
	} );
}
