/**
 * Desktop Mode — Built-in wallpaper presets (server-declared).
 *
 * Historically this module hard-coded five gradient/solid presets
 * (dark, aurora, sunset, forest, mono) and shoved them into the JS
 * registry at boot. As of 0.11.0 the presets live in PHP — see
 * `includes/wallpapers.php` — and flow to the shell through the same
 * `config.serverWallpapers` payload third-party plugins use. A theme
 * can now add / remove / rename a built-in via `add_filter(
 * 'desktop_mode_wallpapers', … )` in `functions.php` without rebuilding
 * the bundle.
 *
 * The file is kept so imports in `src/desktop.ts` don't break; the
 * function is now a no-op. If a future preset needs JS-only behaviour
 * (a canvas wallpaper, a dynamic gradient driven by the clock), add
 * it here and register through the JS-side `register()` API.
 *
 * @since 0.6.0
 * @since 0.11.0 Presets moved to PHP; function is now a no-op. The
 *               compile-time `BUILT_IN_PRESET_IDS` tuple is kept as
 *               a reference for code paths that still need a stable
 *               fallback list.
 */

/** Preset ids kept in a stable order — mirrors `includes/wallpapers.php`. */
export const BUILT_IN_PRESET_IDS = [
	'dark',
	'aurora',
	'sunset',
	'forest',
	'mono',
] as const;

export type BuiltInPresetId = ( typeof BUILT_IN_PRESET_IDS )[ number ];

/**
 * @deprecated Since 0.11.0. Retained as a no-op to avoid breaking
 *             imports in `desktop.ts`. The five presets are now
 *             declared in `includes/wallpapers.php` and arrive in
 *             the shell config as `serverWallpapers`.
 */
export function registerBuiltInWallpapers(): void {
	// Intentionally empty — see file docblock.
}
