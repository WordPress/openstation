/**
 * Server-driven unfocus-effect sync.
 *
 * Mirrors `src/title-bar-buttons/server-sync.ts`. Plugins opt in
 * server-side with `open_station_register_unfocus_effect_script()`;
 * this module loads each opted-in script on activation, and on
 * deactivation unregisters every effect whose `owner` matches the
 * departing handle.
 *
 * Effects that don't set `owner` survive past deactivation until the
 * next page reload — graceful backwards-compat. The OS Settings
 * selector and the engine react live via the registry's subscribe
 * fan-out.
 */

import { doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { unregisterUnfocusEffectsByOwner } from './registry';
import type { DesktopUnfocusEffectScriptServerEntry } from '../types';

export function createUnfocusEffectRegistrySync(): (
	scripts: DesktopUnfocusEffectScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopUnfocusEffectScriptServerEntry,
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
				scope: 'unfocus-effect-script-load',
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

		// Deactivation — drop effects owned by departing handles.
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterUnfocusEffectsByOwner( handle );
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
