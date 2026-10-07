import { OS_SETTINGS_WINDOW_ID } from '../../../src/settings/constants';
import type { OsSettingsState } from '../../../src/settings/types';
import type { OsSettingsSnapshot } from '../../../src/settings/registry';

export const APP_ID = OS_SETTINGS_WINDOW_ID;

interface SettingsApi {
	getOsSettings: () => OsSettingsSnapshot;
	updateOsSettings: (
		patch: Partial< OsSettingsState >,
		opts?: { windowId?: string },
	) => void;
	resetOsSettings: ( opts?: { windowId?: string } ) => void;
	subscribeOsSettings: (
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	) => () => void;
	desktopThemes?: {
		applyRecommendedOsSettings: ( themeId?: string ) => Record< string, unknown >;
	};
	refreshMenu?: () => Promise< void >;
	deriveWindowId?: ( url: string ) => string;
	windowManager?: {
		open: ( config: { id: string; url: string; title: string; icon?: string } ) => unknown;
	};
	getNavItems?: () => unknown[];
}

function api(): SettingsApi | undefined {
	return ( window as unknown as { wp?: { os?: SettingsApi } } ).wp?.os;
}

export function settings(): OsSettingsState {
	return api()!.getOsSettings();
}

export function update( patch: Partial< OsSettingsState > ): void {
	api()?.updateOsSettings( patch, { windowId: APP_ID } );
}

export function reset(): void {
	api()?.resetOsSettings( { windowId: APP_ID } );
}

export function subscribe( cb: ( snapshot: OsSettingsSnapshot ) => void ): () => void {
	return api()?.subscribeOsSettings( cb ) ?? ( () => undefined );
}

export function applyThemeRecommendations( themeId: string ): boolean {
	const applied = api()?.desktopThemes?.applyRecommendedOsSettings( themeId ) ?? {};
	return Object.keys( applied ).length > 0;
}

export function spendMenuRefresh(): void {
	try {
		void api()?.refreshMenu?.();
	} catch {

	}
}

export function openAdminUrl( url: string, title: string, icon = 'dashicons-admin-settings' ): void {
	const os = api();
	if ( os?.windowManager?.open ) {
		os.windowManager.open( {
			id: os.deriveWindowId ? os.deriveWindowId( url ) : url,
			url,
			title,
			icon,
		} );
		return;
	}
	window.open( url, '_blank', 'noopener' );
}

export interface ShellConfig {

	mode?: { tabBar?: string[] } | null;
	aiAssistant?: {
		available: boolean;
		providerConfigured: boolean;
		assistantProviderConfigured: boolean;
		enabled: boolean;
		connectorsUrl: string;
	} | null;
}

export function shellConfig(): ShellConfig {
	return (
		( window as unknown as { openStationConfig?: ShellConfig } ).openStationConfig ?? {}
	);
}
