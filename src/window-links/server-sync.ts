/**
 * Server-driven window-link renderer sync.
 *
 * Mirrors `src/effects/server-sync.ts`. Plugins opt in server-side
 * with `openstation_register_window_link_renderer_script()`; this
 * module loads each opted-in script on activation, and on
 * deactivation unregisters every renderer whose `owner` matches the
 * departing handle.
 *
 * Renderers that don't set `owner` survive past deactivation until
 * the next page reload — graceful backwards-compat (the render host
 * additionally falls back to the built-in `svg-splines` should the
 * ACTIVE renderer disappear). The OS Settings selector and the render
 * host react live via the registry's subscribe fan-out.
 */

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

		// Deactivation — drop renderers owned by departing handles.
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterWindowLinkRenderersByOwner( handle );
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
