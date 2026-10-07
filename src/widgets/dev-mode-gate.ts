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
