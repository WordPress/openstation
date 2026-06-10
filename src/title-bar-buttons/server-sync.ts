/**
 * Server-driven title-bar-button sync.
 *
 * Mirrors `src/commands/server-sync.ts` and
 * `src/settings/server-sync.ts` for the title-bar registry. Plugins
 * opt in server-side with
 * `desktop_mode_register_titlebar_button_script()`; this module
 * loads each opted-in script on activation, and on deactivation
 * unregisters every button whose `owner` matches the departing
 * handle.
 *
 * Buttons that don't set `owner` survive past deactivation until
 * the next page reload — graceful backwards-compat. Open windows
 * repaint live via the registry's subscribe fan-out (see
 * `Window.renderCustomTitleBarButtons`).
 *
 * @since 0.5.2
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import { unregisterTitleBarButtonsByOwner } from './registry';
import type { DesktopTitleBarButtonScriptServerEntry } from './../types';

export function createTitleBarButtonRegistrySync(): (
	scripts: DesktopTitleBarButtonScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopTitleBarButtonScriptServerEntry,
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
				scope: 'titlebar-button-script-load',
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

		// Deactivation — drop buttons owned by departing handles.
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterTitleBarButtonsByOwner( handle );
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
