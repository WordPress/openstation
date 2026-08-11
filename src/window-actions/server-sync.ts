/**
 * Server-driven window-action sync.
 *
 * Mirrors `src/title-bar-buttons/server-sync.ts` for the ⋯ actions
 * registry. Plugins opt in server-side with
 * `openstation_register_window_action_script()`; this module loads
 * each opted-in script on activation, and on deactivation unregisters
 * every action whose `owner` matches the departing handle.
 *
 * `WindowActionDef.owner` documented that unregistration before
 * anything performed it — `unregisterWindowActionsByOwner()` existed
 * with no caller. This is the caller.
 *
 * Actions that don't set `owner` survive past deactivation until the
 * next page reload — graceful backwards-compat. Menus pick up both
 * directions on their next open, and a menu that happens to be open
 * repaints in place through the registry's subscribe fan-out (see
 * `src/window/menus.ts`).
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import { unregisterWindowActionsByOwner } from './registry';
import type { DesktopWindowActionScriptServerEntry } from './../types';

export function createWindowActionRegistrySync(): (
	scripts: DesktopWindowActionScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopWindowActionScriptServerEntry,
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
				scope: 'window-action-script-load',
				handle: entry.handle,
				url: entry.scriptUrl,
				error: err,
			} );
			return;
		}
		loadedUrls.add( entry.scriptUrl );
		loadedHandles.add( entry.handle );
	};

	return async ( scripts ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		// Deactivation — drop actions owned by departing handles.
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterWindowActionsByOwner( handle );
			loadedHandles.delete( handle );
		}

		// Activation — inject any newly-arrived scripts.
		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}
	};
}
