/**
 * Server-driven dock rail renderer sync.
 *
 * Mirrors `src/commands/server-sync.ts` for the rail-renderer
 * registry. Plugins opt in server-side with
 * `openstation_register_dock_rail_renderer_script( $handle )`; this
 * module receives the list of registered script URLs on every live
 * refresh (plugins.php bridge or boot from `config`) and:
 *
 *   - Injects each new `scriptUrl` into the shell page via
 *     `loadVendorScript`. The plugin's JS runs and calls
 *     `wp.os.registerDockRailRenderer()`. The registry's
 *     `subscribeDockRailRenderers` fan-out repaints the OS Settings
 *     picker AND triggers the layout dispatcher to rebuild rails if
 *     the user's pick now resolves to the new renderer.
 *
 *   - On deactivation (a previously-seen `handle` is missing from the
 *     incoming payload), removes every renderer attributable to that
 *     handle via `unregisterByOwner`. If the user had picked one of
 *     them, the dispatcher's subscription falls back through the
 *     registry's resolution chain (user pick → `'default'`) and
 *     rebuilds the rails with the shipped baseline.
 *
 * Plugins that don't set `owner: '<handle>'` on their JS registration
 * keep their renderer until the next page reload (graceful
 * backwards-compat). Plugin authors using the documented pattern get
 * full live activate/deactivate behaviour.
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import { unregisterByOwner } from './registry';
import type { DesktopDockRailRendererScriptServerEntry } from './../types';

export function createDockRailRendererSync(): (
	scripts: DesktopDockRailRendererScriptServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	const ensureScript = async (
		entry: DesktopDockRailRendererScriptServerEntry,
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
				scope: 'dock-rail-renderer-script-load',
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

		// Deactivation sweep — handles we'd previously loaded that
		// aren't in the new payload. `unregisterByOwner` notifies the
		// registry; the dispatcher's subscription rebuilds rails if
		// the resolved active renderer changed.
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			unregisterByOwner( handle );
			loadedHandles.delete( handle );
		}

		// Activation sweep — newly-arrived handles get their script
		// injected. The plugin's JS calls `registerDockRailRenderer()`
		// during evaluation; the registry's notify cascade handles
		// the rest.
		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}
	};
}
