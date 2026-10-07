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

				deps: entry.scriptDeps,
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

		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterTitleBarButtonsByOwner( handle );
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}
	};
}
