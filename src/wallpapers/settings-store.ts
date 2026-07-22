/**
 * Desktop Mode — Per-wallpaper settings store.
 *
 * Holds the current user's per-wallpaper settings (the values edited
 * through a wallpaper's `renderConfig` dialog in OS Settings). The
 * canonical persisted copy lives in `OsSettingsState.wallpaperSettings`
 * (user meta + localStorage, same save pipeline as every other OS
 * Settings preference); this store is the runtime mirror every bundle
 * reads from:
 *
 *   - The wallpaper layer stamps the active wallpaper's settings onto
 *     `WallpaperContext.settings` at mount time.
 *   - The OS Settings preview manager does the same for tile previews.
 *   - The config dialog writes through {@link publishWallpaperSettings},
 *     which also fires `desktop-mode.wallpaper.settings-changed` so a
 *     mounted wallpaper can live-apply without a remount.
 *
 * Routed through `createSharedStore` because the OS Settings panel
 * ships in its own Vite bundle — a module-level map would give the
 * main bundle and the panel bundle each their own copy (see
 * AGENTS.md, "Cross-bundle state").
 *
 * @since 0.9.5
 */

import { doAction, HOOKS } from '../hooks';
import { createSharedStore } from '../shared-store';

/**
 * A wallpaper's settings bag. Scalar values only — the shape mirrors
 * what the PHP sanitizer (`includes/os-settings.php`) round-trips.
 */
export type WallpaperSettings = Record< string, string | number | boolean >;

interface WallpaperSettingsStore {
	values: Record< string, WallpaperSettings >;
}

const store = createSharedStore< WallpaperSettingsStore >(
	'desktop-mode/wallpaper-settings',
	() => ( { values: {} } ),
);

/**
 * Read a wallpaper's current settings. Returns a copy — mutating the
 * result never writes back; use {@link publishWallpaperSettings}.
 *
 * @since 0.9.5
 *
 * @param id Wallpaper id.
 * @return The wallpaper's settings (empty object when none saved).
 */
export function getWallpaperSettings( id: string ): WallpaperSettings {
	return { ...( store.state.values[ id ] ?? {} ) };
}

/**
 * Replace the whole store from the persisted OS Settings state. Called
 * on boot (and after a save-failure rollback) by `OsSettings.apply()`.
 * Silent — no change hook fires; the boot path re-applies the active
 * wallpaper anyway, and firing per-id here would double-notify.
 *
 * @since 0.9.5
 *
 * @param all Map of wallpaper id → settings.
 */
export function seedWallpaperSettings(
	all: Record< string, WallpaperSettings >,
): void {
	const values = store.state.values;
	for ( const key of Object.keys( values ) ) {
		delete values[ key ];
	}
	for ( const [ id, settings ] of Object.entries( all ) ) {
		values[ id ] = { ...settings };
	}
}

/**
 * Write a wallpaper's settings into the store and fire the
 * `desktop-mode.wallpaper.settings-changed` action so a mounted
 * wallpaper (or anything else watching) can live-apply.
 *
 * Persistence is the caller's job — the OS Settings config dialog
 * writes the same object into `state.wallpaperSettings` and calls
 * `ctx.save()` alongside this.
 *
 * @since 0.9.5
 *
 * @param id       Wallpaper id.
 * @param settings Full post-merge settings object for the wallpaper.
 */
export function publishWallpaperSettings(
	id: string,
	settings: WallpaperSettings,
): void {
	store.state.values[ id ] = { ...settings };
	doAction( HOOKS.WALLPAPER_SETTINGS_CHANGED, {
		id,
		settings: { ...settings },
	} );
}
