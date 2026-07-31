/**
 * Server-driven OS Settings tab sync.
 *
 * Mirrors `src/commands/server-sync.ts` for the settings-tab registry.
 * Plugins opt in server-side with
 * `desktop_mode_register_settings_tab_script()` (and optionally
 * `desktop_mode_register_settings_tab()`); this module receives the
 * current list of registered script URLs on every live refresh and:
 *
 *   - Injects each new `scriptUrl` into the shell page via
 *     `loadVendorScript`. The plugin's JS runs and calls
 *     `wp.desktop.registerSettingsTab()` as normal; the tab registry's
 *     subscriber repaints any open OS Settings window.
 *
 *   - On deactivation (a previously-seen `handle` is missing from the
 *     incoming payload), unregisters every tab attributable to that
 *     handle. Attribution from two sources, unioned:
 *       1. The `owner` field set by the plugin's JS when calling
 *          `registerSettingsTab({ …, owner: 'my-script-handle' })`.
 *       2. The id↔handle mapping captured from the *previous*
 *          `serverSettingsTabs` payload. Plugins that declare
 *          metadata via `desktop_mode_register_settings_tab()` with a
 *          `script` arg get this for free — no JS change required.
 *
 *     Plugins using neither mechanism keep their tabs until the next
 *     page reload (graceful backwards-compat).
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import {
	listSettingsTabs,
	unregisterSettingsTab,
	unregisterSettingsTabsByOwner,
} from './registry';
import type {
	DesktopSettingsTabScriptServerEntry,
	DesktopSettingsTabServerEntry,
} from './../types';

export function createSettingsTabRegistrySync(): (
	scripts: DesktopSettingsTabScriptServerEntry[],
	tabs?: DesktopSettingsTabServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	let prevIdsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopSettingsTabScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'settings-tab-script-load',
				handle: entry.handle,
				url: entry.scriptUrl,
				error: err,
			} );
			return;
		}
		loadedUrls.add( entry.scriptUrl );
		loadedHandles.add( entry.handle );
	};

	const idsByHandleFrom = (
		tabs: DesktopSettingsTabServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! tabs ) {
			return map;
		}
		for ( const entry of tabs ) {
			if ( ! entry.scriptHandle || ! entry.id ) {
				continue;
			}
			let set = map.get( entry.scriptHandle );
			if ( ! set ) {
				set = new Set< string >();
				map.set( entry.scriptHandle, set );
			}
			set.add( entry.id );
		}
		return map;
	};

	const removeByHandle = ( handle: string ): void => {
		// (B) owner-tagged JS registrations.
		unregisterSettingsTabsByOwner( handle );
		// (A) PHP-declared metadata from the last known payload.
		const declared = prevIdsByHandle.get( handle );
		if ( declared ) {
			// If a tab declared in PHP wasn't owner-tagged in JS, the
			// owner-sweep above missed it — catch it by id here. Tabs
			// still present in `listSettingsTabs()` after the sweep are
			// candidates; delete by id directly.
			const present = new Set(
				listSettingsTabs().map( ( t ) => t.id ),
			);
			for ( const id of declared ) {
				if ( present.has( id ) ) {
					unregisterSettingsTab( id );
				}
			}
		}
	};

	return async ( scripts, tabs ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			removeByHandle( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( tabs );
	};
}
