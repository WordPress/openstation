/**
 * Server-driven screen-effect sync.
 *
 * Mirrors `src/effects/server-sync.ts`. Plugins opt in server-side with
 * `desktop_mode_register_screen_effect_script()`; this module loads
 * each opted-in script on activation, and on deactivation unregisters
 * every effect whose `owner` matches the departing handle.
 *
 * Effects that don't set `owner` survive past deactivation until the
 * next page reload — graceful backwards-compat. The OS Settings →
 * Experimental list and the running stage both react live via the
 * registry's subscribe fan-out, so a plugin activated mid-session gets
 * its shader on screen with no reload.
 *
 * Note this runs in the MAIN bundle, not the lazy `stage` one: a
 * plugin's effect has to reach the registry whether or not the user has
 * the canvas stage switched on, otherwise its checkbox would never
 * appear for them to switch it on with.
 *
 * @since 0.9.8
 */

import { doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { unregisterScreenEffectsByOwner } from './registry';
import type { DesktopScreenEffectScriptServerEntry } from '../types';

export function createScreenEffectRegistrySync(): (
	scripts: DesktopScreenEffectScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopScreenEffectScriptServerEntry,
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
				scope: 'screen-effect-script-load',
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
			unregisterScreenEffectsByOwner( handle );
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
