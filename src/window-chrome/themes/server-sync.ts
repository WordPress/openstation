/**
 * Server-driven window-theme sync.
 *
 * Mirrors `src/commands/server-sync.ts` and the rest of the
 * server-sync family. Plugins opt in server-side via
 * `desktop_mode_register_window_theme_script()` (and optionally
 * `desktop_mode_register_window_theme()` for token-only themes); this
 * module receives the resolved script URL list on every live refresh
 * and:
 *
 *   - Loads each newly-arrived `scriptUrl` via `loadVendorScript`. The
 *     plugin's JS runs and calls `wp.desktop.registerWindowTheme()`
 *     as normal. The theme registry's `subscribeWindowThemes` fan-out
 *     repaints any open window the theme matches.
 *   - On deactivation (a previously-seen `handle` is missing from the
 *     incoming payload), unregisters every theme attributable to that
 *     handle. Attribution unions:
 *       1. The `owner` field set by the plugin's JS when calling
 *          `registerWindowTheme({ …, owner: 'my-script-handle' })`.
 *       2. The id↔handle mapping captured from the *previous*
 *          `serverWindowThemes` payload — themes declared via
 *          `desktop_mode_register_window_theme()` with a `script` arg
 *          get this for free.
 *
 *     Themes registered via JS without an `owner` survive past
 *     deactivation until the next reload (graceful backwards-compat).
 *
 * Themes pre-registered via PHP metadata (`serverWindowThemes`)
 * register their tokens shell-side too, without waiting for a JS
 * round trip — this is what enables stylesheet-only themes.
 */

import { doAction, HOOKS } from '../../hooks';
import { loadVendorScript } from '../../wallpapers/vendor-loader';
import {
	registerWindowTheme,
	unregisterWindowTheme,
	listWindowThemes,
	unregisterWindowThemesByOwner,
} from './registry';
import type {
	DesktopWindowThemeScriptServerEntry,
	DesktopWindowThemeServerEntry,
} from '../../types';

export function createWindowThemeRegistrySync(): (
	scripts: DesktopWindowThemeScriptServerEntry[],
	themes?: DesktopWindowThemeServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();
	// Snapshot of the previous payload's id↔handle mapping. Used to
	// look up themes registered by a handle that's about to leave.
	let prevIdsByHandle = new Map< string, Set< string > >();
	// Themes the SHELL registered from PHP metadata (vs themes registered
	// by the plugin's JS) — we own these and can re-register / un-register
	// safely on every payload diff.
	const shellRegistered = new Set< string >();

	const ensureScript = async (
		entry: DesktopWindowThemeScriptServerEntry,
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
				scope: 'window-theme-script-load',
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
		themes: DesktopWindowThemeServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! themes ) {
			return map;
		}
		for ( const entry of themes ) {
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

	const collectIdsToRemove = ( handle: string ): Set< string > => {
		const ids = new Set< string >();
		// (B) owner-tagged JS registrations.
		for ( const def of listWindowThemes() ) {
			if ( def.owner === handle ) {
				ids.add( def.id );
			}
		}
		// (A) PHP-declared metadata from the last known payload.
		const declared = prevIdsByHandle.get( handle );
		if ( declared ) {
			for ( const id of declared ) {
				ids.add( id );
			}
		}
		return ids;
	};

	const applyMetadata = (
		themes: DesktopWindowThemeServerEntry[] | undefined,
	): void => {
		if ( ! themes ) {
			return;
		}
		for ( const entry of themes ) {
			if ( ! entry.id || ! entry.tokens ) {
				continue;
			}
			// Stylesheet-only themes: register a "match every window"
			// predicate so the theme applies sitewide. Plugins that
			// want narrower matching ship a script that overrides the
			// metadata-only registration with a richer `match`.
			try {
				registerWindowTheme( {
					id: entry.id,
					label: entry.label,
					tokens: entry.tokens,
					priority: entry.priority,
					match: () => true,
					owner: entry.scriptHandle || undefined,
				} );
				shellRegistered.add( entry.id );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'window-theme-shell-register',
					id: entry.id,
					error: err,
				} );
			}
		}
	};

	return async ( scripts, themes ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		// Deactivation — for handles that left the payload, drop their
		// attributable themes (owner-tagged JS registrations + PHP-
		// declared metadata from the previous snapshot).
		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			const ids = collectIdsToRemove( handle );
			for ( const id of ids ) {
				unregisterWindowTheme( id );
				shellRegistered.delete( id );
			}
			// Owner-bulk fallback for any owner-tagged JS theme that
			// declared neither metadata nor an explicit id we know
			// about. Idempotent with the per-id calls above.
			unregisterWindowThemesByOwner( handle );
			loadedHandles.delete( handle );
		}

		// Activation — apply PHP metadata up-front so stylesheet-only
		// themes work without waiting on JS, then load the per-handle
		// script (which may overwrite the metadata-only theme with a
		// richer `match`).
		applyMetadata( themes );

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevIdsByHandle = idsByHandleFrom( themes );
	};
}
