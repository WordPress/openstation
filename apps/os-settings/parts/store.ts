/**
 * OpenStation Preferences — the bridge to the shell's store.
 *
 * The settings live in the always-on shell bundle (`src/settings/`),
 * where they are applied before the first paint and outlive any
 * window. This app is their EDITOR, and it edits them the way any
 * third-party settings tab would: `wp.os.getOsSettings()` to read,
 * `wp.os.updateOsSettings()` to write, `wp.os.subscribeOsSettings()`
 * to repaint when anything — this window, the right-click menu, a
 * rollback after a failed save — changes them. Nothing here reaches
 * into the store's internals, which is what makes the public API the
 * one the shell itself trusts.
 */

import { OS_SETTINGS_WINDOW_ID } from '../../../src/settings/constants';
import type { OsSettingsState } from '../../../src/settings/types';
import type { OsSettingsSnapshot } from '../../../src/settings/registry';

/** The window id — the app id, and a frozen identifier (AGENTS.md). */
export const APP_ID = OS_SETTINGS_WINDOW_ID;

/** The slice of `wp.os` this app talks to. */
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

/** The current settings — a fresh copy on every call. */
export function settings(): OsSettingsState {
	return api()!.getOsSettings();
}

/**
 * Write a patch. The store sanitizes, persists (debounced, with the
 * activity dot on THIS window), applies presentation keys, and
 * notifies — which is what repaints the app.
 */
export function update( patch: Partial< OsSettingsState > ): void {
	api()?.updateOsSettings( patch, { windowId: APP_ID } );
}

/** Put every preference back to its default. The uploaded image survives. */
export function reset(): void {
	api()?.resetOsSettings( { windowId: APP_ID } );
}

/** Repaint on every settings change, whoever made it. */
export function subscribe( cb: ( snapshot: OsSettingsSnapshot ) => void ): () => void {
	return api()?.subscribeOsSettings( cb ) ?? ( () => undefined );
}

/** Re-apply a theme's recommended arrangement — the deliberate re-seed. */
export function applyThemeRecommendations( themeId: string ): boolean {
	const applied = api()?.desktopThemes?.applyRecommendedOsSettings( themeId ) ?? {};
	return Object.keys( applied ).length > 0;
}

/**
 * One menu-payload refresh, after a save that gated a SERVER-side
 * registration has persisted. Best-effort by design: the refresh is
 * absent before the shell has booted, and a failed one costs the F5
 * this exists to remove — never the save that just succeeded.
 */
export function spendMenuRefresh(): void {
	try {
		void api()?.refreshMenu?.();
	} catch {
		// See above.
	}
}

/**
 * Open an admin URL in an iframe window, the way every rail does —
 * the same id the default renderer would derive, so a later click on
 * the same page focuses this window instead of opening a twin.
 */
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

/** The shell's page config — the boot facts other bundles also read. */
export interface ShellConfig {
	/** Responsive-mode inputs; `tabBar` is the server's default phone pins. */
	mode?: { tabBar?: string[] } | null;
	commentsAi?: { enabled: boolean; providerConfigured: boolean } | null;
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
