/**
 * Server-driven wallpaper registry sync.
 *
 * Third time we reach for this pattern (see
 * `src/native-windows.ts`, `src/widgets/server-sync.ts` for the
 * symmetric versions on their own registries). Plugins declare
 * their wallpaper server-side via
 * `openstation_register_wallpaper()`; this module diffs the shell's
 * current wallpaper registry against the fresh payload on every
 * live refresh and bridges the plugin-side JS into the shell's
 * registry.
 *
 * The split: PHP owns METADATA (id, label, preview, type, script
 * URL). JS owns the CALLBACK surface (mount, resolveValue,
 * renderEditor) because functions don't serialize. Plugins publish
 * a full `WallpaperDef` on `window.openStationWallpapers[ id ]`; the
 * shell loads the script (if not already in the tab), reads that
 * global, and forwards the def to the standard registry.
 *
 * That script load is deferred. The metadata alone is enough to
 * register a stub and paint a picker tile, so a canvas wallpaper's
 * bundle waits until it is the wallpaper actually being applied or
 * the user opens the picker — see `./lazy.ts`, which owns the
 * deferral and the hydrate-on-demand path.
 *
 * On deactivation we unregister the def AND call
 * `osSettings.apply()` — if the user's current selection was the
 * wallpaper leaving, the apply path falls back to a built-in
 * default rather than leaving a dead id in place.
 */

import { doAction, HOOKS } from './../hooks';
import * as registry from './registry';
import { buildStub, clearPending, hydrate, setPending } from './lazy';
import type { OsSettings } from '../settings';
import type { DesktopWallpaperServerEntry } from '../types';
import type { WallpaperDef } from './types';

export interface WallpaperRegistrySyncDeps {
	osSettings: OsSettings;
}

export function createWallpaperRegistrySync(
	deps: WallpaperRegistrySyncDeps,
): ( list: DesktopWallpaperServerEntry[] ) => Promise< void > {
	const { osSettings } = deps;

	const registered = new Set< string >();

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
			description: entry.description || undefined,
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

		// Everything else needs the plugin's bundle to produce a def.
		// Register a stub from the metadata now and leave the download
		// for the moment something actually needs the callbacks —
		// see `./lazy.ts`.
		if ( ! entry.scriptUrl ) {
			// Neither a usable CSS value nor a script to publish a def.
			// Nothing to register; a later sync retries in case the
			// plugin fixes its registration.
			return;
		}
		setPending( entry );

		// A stub is only worth registering if it can stand in for the
		// real def in the picker, and the swatch is the one thing PHP
		// isn't required to declare. Without it there is nothing to
		// paint a tile from, so fall back to loading the bundle now
		// and letting the JS def — which does carry a preview —
		// register itself.
		const previewable = entry.preview !== '' || entry.value !== '';
		if ( previewable ) {
			try {
				registry.register( buildStub( entry ) );
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'wallpaper-register',
					id: entry.id,
					error: err,
				} );
				clearPending( entry.id );
				return;
			}
			registered.add( entry.id );
		}

		// Two reasons to load right now: the wallpaper the desktop is
		// about to paint, and the one we couldn't build a stub for.
		// Everything else waits for the picker. For the active
		// wallpaper the `apply()` below then mounts the real def
		// rather than the stub's delegating mount — one fewer
		// indirection on the wallpaper the user actually sees.
		if ( ! previewable || osSettings.state.wallpaper === entry.id ) {
			const def = await hydrate( entry.id );
			if ( ! previewable ) {
				if ( ! def ) {
					// No stub registered and no def arrived — leave the
					// id unregistered so the next sync retries.
					clearPending( entry.id );
					return;
				}
				registered.add( entry.id );
			}
		}

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
		clearPending( id );
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
