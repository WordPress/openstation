/**
 * Server-driven wallpaper registry sync.
 *
 * Third time we reach for this pattern (see
 * `src/native-windows.ts`, `src/widgets/server-sync.ts` for the
 * symmetric versions on their own registries). Plugins declare
 * their wallpaper server-side via
 * `desktop_mode_register_wallpaper()`; this module diffs the shell's
 * current wallpaper registry against the fresh payload on every
 * live refresh and bridges the plugin-side JS into the shell's
 * registry.
 *
 * The split: PHP owns METADATA (id, label, preview, type, script
 * URL). JS owns the CALLBACK surface (mount, resolveValue,
 * renderEditor) because functions don't serialize. Plugins publish
 * a full `WallpaperDef` on `window.wpDesktopWallpapers[ id ]`; the
 * shell loads the script (if not already in the tab), reads that
 * global, and forwards the def to the standard registry.
 *
 * On deactivation we unregister the def AND call
 * `osSettings.apply()` — if the user's current selection was the
 * wallpaper leaving, the apply path falls back to a built-in
 * default rather than leaving a dead id in place.
 *
 * @since 0.10.0
 */

import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './vendor-loader';
import * as registry from './registry';
import type { OsSettings } from '../settings';
import type { DesktopWallpaperServerEntry } from '../types';
import type { WallpaperDef } from './types';

interface WallpaperGlobals {
	wpDesktopWallpapers?: Record< string, WallpaperDef | undefined >;
}

export interface WallpaperRegistrySyncDeps {
	osSettings: OsSettings;
}

export function createWallpaperRegistrySync(
	deps: WallpaperRegistrySyncDeps,
): ( list: DesktopWallpaperServerEntry[] ) => Promise< void > {
	const { osSettings } = deps;

	const registered = new Set< string >();
	const loadedScripts = new Set< string >();

	const ensureScript = async (
		entry: DesktopWallpaperServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedScripts.has( entry.scriptUrl ) ) {
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
				scope: 'wallpaper-script-load',
				id: entry.id,
				error: err,
			} );
		}
		loadedScripts.add( entry.scriptUrl );
	};

	const readDef = ( id: string ): WallpaperDef | null => {
		const globals =
			( window as unknown as WallpaperGlobals ).wpDesktopWallpapers || {};
		return globals[ id ] ?? null;
	};

	/**
	 * Synthesize a `WallpaperDef` from a server entry without
	 * requiring a JS global. Works for CSS wallpapers whose `value`
	 * is a plain CSS string (gradient, color, `url(...)`) — the
	 * built-in presets all register through this path now, and
	 * third-party plugins that ship a purely-CSS wallpaper can skip
	 * shipping a JS bundle entirely.
	 */
	const defFromCssEntry = (
		entry: DesktopWallpaperServerEntry,
	): WallpaperDef | null => {
		if ( entry.type !== 'css' || entry.value === '' ) {
			return null;
		}
		return {
			id: entry.id,
			label: entry.label,
			type: 'css',
			value: entry.value,
			preview: entry.preview !== '' ? entry.preview : entry.value,
		};
	};

	const registerEntry = async (
		entry: DesktopWallpaperServerEntry,
	): Promise< void > => {
		if ( registered.has( entry.id ) ) {
			return;
		}

		// Fast path for CSS wallpapers with a static value — no
		// script load, no JS global read. The built-in presets
		// travel through this path and third-party plugins can too
		// when their wallpaper is pure CSS.
		const cssDef = defFromCssEntry( entry );
		if ( cssDef ) {
			registry.register( cssDef );
			registered.add( entry.id );
			osSettings.apply();
			return;
		}

		await ensureScript( entry );
		const def = readDef( entry.id );
		if ( ! def ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'wallpaper-missing-def',
				id: entry.id,
				error: new Error(
					`[wp-desktop-mode] No wallpaper def on window.wpDesktopWallpapers["${ entry.id }"]. Script loaded but didn't publish a def — check the plugin's enqueue + global assignment.`,
				),
			} );
			// Don't mark registered; next sync retries in case the
			// script was late to settle.
			return;
		}
		// Server-sync hydrates many defs in a row; one malformed def
		// shouldn't kill the loop. Catch the throw and surface via
		// SHELL_ERROR so the sync can continue with the rest.
		try {
			registry.register( def );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'wallpaper-register',
				id: entry.id,
				error: err,
			} );
			return;
		}
		registered.add( entry.id );
		// Re-apply the current wallpaper selection so a plugin that
		// activates with its saved wallpaper selection picks up
		// the new def immediately.
		osSettings.apply();
	};

	const unregisterEntry = ( id: string ): void => {
		if ( ! registered.has( id ) ) {
			return;
		}
		registry.unregister( id );
		registered.delete( id );
		// Re-apply so the settings panel + active wallpaper layer
		// refresh their selection. If the user was actively using
		// the deactivated wallpaper, `apply()` falls back to a
		// built-in default rather than leaving a dead reference.
		osSettings.apply();
	};

	return async ( list ) => {
		const incoming = new Set< string >();
		for ( const entry of list ) {
			incoming.add( entry.id );
		}

		for ( const id of Array.from( registered ) ) {
			if ( ! incoming.has( id ) ) {
				unregisterEntry( id );
			}
		}

		for ( const entry of list ) {
			if ( ! registered.has( entry.id ) ) {
				await registerEntry( entry );
			}
		}
	};
}
