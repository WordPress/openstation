import { doAction, HOOKS } from '../hooks';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { unregisterWindowLinkRenderersByOwner } from './renderer-registry';
import type { DesktopWindowLinkRendererScriptServerEntry } from '../types';

export function createWindowLinkRendererRegistrySync(): (
	scripts: DesktopWindowLinkRendererScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopWindowLinkRendererScriptServerEntry,
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
				scope: 'window-link-renderer-script-load',
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
			unregisterWindowLinkRenderersByOwner( handle );
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
