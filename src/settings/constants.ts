/**
 * Constants for the OS Settings module.
 *
 * Kept plain (no i18n) so they can be imported from anywhere —
 * including files that shouldn't pull `@wordpress/i18n` into their
 * dependency graph.
 *
 * Most values are fallbacks. The live set comes from
 * `openStationConfig.accentColors` / `.defaultWallpaper`, populated by
 * PHP via `openstation_accent_colors` / `openstation_default_wallpaper`
 * filters. The getters in this file do the `runtime config → fallback`
 * dance so callers never have to branch on "is the config hydrated?"
 */

import type { AccentColor, DesktopConfig } from '../types';
import type { OsSettingsState } from './types';

/** localStorage key under which preferences are serialized. */
export const STORAGE_KEY = 'desktop-mode-os-settings';

/** Minimum resolution considered "HD" for the wallpaper picker filter. */
export const HD_MIN_WIDTH = 1920;
export const HD_MIN_HEIGHT = 1080;

/** How many media items we ask the REST endpoint for per page. */
export const MEDIA_PER_PAGE = 40;

/** Debounce window for the library search input. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Built-in wallpaper id for the custom-gradient editor. */
export const CUSTOM_GRADIENT_ID = 'custom-gradient';

/** Built-in wallpaper id for uploaded/library-picked images. */
export const CUSTOM_IMAGE_ID = 'custom-image';

/** Default fallback id when a registered wallpaper isn't available. */
export const DEFAULT_WALLPAPER_ID = 'galaxy';

/**
 * Built-in accent swatches applied to `--wp-admin-theme-color`.
 *
 * This is the compile-time fallback list used when PHP doesn't hand
 * us a live `accentColors` array in `openStationConfig` — the live list
 * is what the picker actually renders. Plugins that want to
 * customise the list should hook `openstation_accent_colors` in PHP,
 * not fork this constant.
 */
/**
 * The accent id that means "not one of the presets".
 *
 * Deliberately NOT in {@link DEFAULT_ACCENTS} or in the PHP list: it
 * has no fixed value, so it cannot be resolved by looking it up. Its
 * colour is `state.customAccent`, and `OsSettings.apply()` special-
 * cases it before the preset lookup.
 */
export const CUSTOM_ACCENT_ID = 'custom';

export const DEFAULT_ACCENTS: readonly AccentColor[] = [
	{ id: 'pulse', label: 'Pulse', value: '#f252fc' },
	{ id: 'nebula', label: 'Nebula', value: '#ec9bff' },
	{ id: 'sirius', label: 'Sirius', value: '#9af2ff' },
	{ id: 'lagoon', label: 'Lagoon', value: '#9f98ff' },
	{ id: 'wp-blue', label: 'WordPress Blue', value: '#2271b1' },
	{ id: 'indigo', label: 'Indigo', value: '#3858e9' },
	{ id: 'teal', label: 'Teal', value: '#04a4cc' },
	{ id: 'emerald', label: 'Emerald', value: '#059669' },
	{ id: 'amber', label: 'Amber', value: '#d97706' },
	{ id: 'rose', label: 'Rose', value: '#e11d48' },
] as const;

/**
 * Resolve the live accent-color list.
 *
 * Reads `window.wp.os.config.accentColors` (populated by PHP via
 * `openstation_accent_colors`) and validates each entry shape. Drops
 * malformed entries rather than letting a bad filter render broken
 * swatches. Falls back to {@link DEFAULT_ACCENTS} when the config is
 * missing or yields zero valid entries.
 */
export function getAccents(): readonly AccentColor[] {
	const config = ( window as unknown as {
		wp?: { os?: { config?: DesktopConfig } };
	} ).wp?.os?.config;
	const raw = config?.accentColors;
	if ( ! Array.isArray( raw ) || raw.length === 0 ) {
		return DEFAULT_ACCENTS;
	}
	const clean: AccentColor[] = [];
	for ( const entry of raw ) {
		if (
			entry &&
			typeof entry === 'object' &&
			typeof entry.id === 'string' &&
			typeof entry.label === 'string' &&
			typeof entry.value === 'string' &&
			entry.id !== '' &&
			entry.label !== '' &&
			/^#[0-9a-f]{3,8}$/i.test( entry.value )
		) {
			clean.push( { id: entry.id, label: entry.label, value: entry.value } );
		}
	}
	return clean.length > 0 ? clean : DEFAULT_ACCENTS;
}

/**
 * Resolve the live default-wallpaper slug. Reads
 * `window.wp.os.config.defaultWallpaper` and falls back to
 * {@link DEFAULT_WALLPAPER_ID} when absent/invalid.
 */
export function getDefaultWallpaperId(): string {
	const config = ( window as unknown as {
		wp?: { os?: { config?: DesktopConfig } };
	} ).wp?.os?.config;
	const raw = config?.defaultWallpaper;
	if ( typeof raw === 'string' && raw !== '' ) {
		return raw;
	}
	return DEFAULT_WALLPAPER_ID;
}

/** Dock-size options. Each ships a width in px + icon scale. */
export const DOCK_SIZES = [
	{ id: 'compact', label: 'Compact', width: 48, icon: 18 },
	{ id: 'default', label: 'Default', width: 56, icon: 20 },
	{ id: 'large', label: 'Large', width: 72, icon: 26 },
] as const;

/**
 * Window corner-radius presets. `value` (px) is written to the
 * `--os-window-radius` custom property by the settings apply
 * pass, so the choice reflows every open window's corners live.
 */
export const WINDOW_RADII = [
	{ id: 'sharp', label: 'Sharp', value: 0 },
	{ id: 'default', label: 'Default', value: 8 },
	{ id: 'round', label: 'Round', value: 16 },
] as const;

/**
 * Admin-bar presentation modes. Drives the
 * `os-admin-bar-<id>` body class (written by PHP on render
 * and re-written by the settings apply pass), which is what
 * `desktop.css` keys off to place — or hide — the WordPress admin bar
 * above the shell.
 *
 * - `static`  — the bar is always on screen and the shell starts
 *               below it. The shipped default, and vanilla behavior.
 * - `dynamic` — the bar slides off the top edge leaving a few pixels
 *               of peek, and slides back in when the pointer reaches
 *               the top of the viewport or something inside it takes
 *               keyboard focus. The reveal zone is deliberately taller
 *               than the visible peek (see the two
 *               `--os-admin-bar-*` tokens). The shell
 *               reclaims the full viewport and the bar overlays it
 *               when revealed. Modeled on the classic Windows
 *               auto-hide taskbar.
 * - `hidden`  — the bar is not rendered at all. The "Exit Desktop
 *               Mode" tile on the dock's core rail
 *               (`src/exit-os.ts`) is the way back to
 *               classic admin, so this is not a one-way door.
 */
export const ADMIN_BAR_MODES = [
	{ id: 'static', label: 'Static' },
	{ id: 'dynamic', label: 'Dynamic' },
	{ id: 'hidden', label: 'Hidden' },
] as const;

/**
 * Dock-placement options. Drives the `data-os-dock-placement`
 * attribute that each `Dock` instance writes onto its own root. CSS
 * keys off that attribute to position the rail, flip the tooltip
 * anchor, and adjust the desktop-area inset.
 *
 * `unified` takes its placement from the user's `dockPlacement` pick.
 * `classic` derives both of its rails from the layout itself — a left
 * side bar for core menus plus a bottom dock for plugin apps — and
 * ignores the setting.
 */
export const DOCK_PLACEMENTS = [
	{ id: 'bottom', label: 'Bottom' },
	{ id: 'left', label: 'Left' },
	{ id: 'right', label: 'Right' },
] as const;

/**
 * Desktop layout options. User picks one in OS Settings → Appearance;
 * the shell root reflects the choice in `data-os-layout` and
 * the layout dispatcher rebuilds the dock(s) + desktop icons.
 *
 * `unified` leads because it is the default: one dock is the shape a
 * first-run desktop arrives in. `classic` splits navigation across two
 * surfaces, which is a deliberate choice rather than a starting point.
 */
export const DESKTOP_LAYOUTS = [
	{ id: 'unified', label: 'Unified' },
	{ id: 'classic', label: 'Split' },
] as const;

export const DEFAULTS: OsSettingsState = {
	wallpaper: DEFAULT_WALLPAPER_ID,
	accent: 'pulse',
	// Only read when `accent` is CUSTOM_ACCENT_ID. Seeded with Pulse so
	// picking Custom before touching the colour field is a no-op rather
	// than a jump to black.
	customAccent: '#f252fc',
	dockSize: 'default',
	// `round` (16px), not `default` (8px). The preset ids are stored
	// values and cannot be renamed, so the option labelled "Default"
	// is no longer the shipped default — the label is cosmetic, the id
	// is data. See `WINDOW_RADII`.
	windowRadius: 'round',
	// Hidden by default. A desktop whose navigation is consolidated
	// into one dock has no second place left for navigation to live,
	// and the top bar was the loudest of those second places. The
	// dock's "Exit OpenStation" tile keeps the way back to classic
	// admin, so this is not a one-way door; `static` and `dynamic`
	// are one pick away in Appearance.
	adminBarMode: 'hidden',
	// One dock holding every menu. `classic` (side bar + bottom dock)
	// is the other option.
	desktopLayout: 'unified',
	dockPlacement: 'bottom',
	dockRailRenderer: 'default',
	// `''` = System default. Any other value is a desktop-theme
	// slug; the registry resolves it at apply time and falls back
	// to the system default when it isn't installed.
	desktopTheme: '',
	// Themes whose recommended OS settings this user has already been
	// seeded with. Empty means "no theme has ever recommended anything
	// to this user yet" — the first activation of a theme that does
	// will append to it.
	appliedThemeRecommendations: [],
	unfocusEffect: 'darken',
	// Off by default. A reveal is a deliberate flourish on every single
	// window load, which is the wrong thing to opt a user into on
	// their behalf — they choose one in OS Settings → Effects. `'none'`
	// keeps the plain opacity fade the shell has always had.
	windowReveal: 'none',
	// 0 = use each reveal's own tuned duration. Any other value is a
	// global override in ms, set from OS Settings → Effects.
	windowRevealDuration: 0,
	windowLinkRenderer: 'svg-splines',
	windowLinkVisibility: 'always',
	windowLinksEnabled: true,
	windowLinkRaiseOnFocus: true,
	windowLinkHighlight: true,
	customGradient: {
		from: '#2271b1',
		to: '#7c3aed',
		angle: 135,
	},
	customImage: null,
	wallpaperSettings: {},
	libraryHdOnly: true,
	ai: {
		enabled: false,
	},
	// Opt-in Beta. Fresh installs land on the classic
	// chromeless `edit.php` iframe; a user opts in via OS Settings →
	// Features → Beta features to get the native Posts window. The
	// native windows used to default ON (opt-out, 0.8.0) but are now
	// opt-in so the redesign is a deliberate choice, not imposed.
	heartbeatRate: 60,
	nativePostsEnabled: false,
	nativePostsHiddenColumns: [],
	// Same opt-in Beta posture as Posts — fresh installs keep the
	// iframe; users opt in to the native Pages window.
	nativePagesEnabled: false,
	// Native Users window — same opt-in Beta posture. Capability-gated
	// server-side (the window is only registered for users with
	// `list_users`), so this toggle only affects the small set of
	// users who can see the Users tile in the first place.
	nativeUsersEnabled: false,
	// Native Plugins window — replaces `plugins.php` and
	// `plugin-install.php`. Same opt-in Beta posture; cap-gated on
	// `activate_plugins` server-side, so this toggle only affects
	// users who could see the Plugins tile anyway.
	nativePluginsEnabled: false,
	// Native Comments window — replaces `edit-comments.php`. Same
	// opt-in Beta posture; cap-gated on `edit_posts` server-side.
	nativeCommentsEnabled: false,
	// Station Home — the native Dashboard window that claims the
	// ordinary `index.php` URL. Same opt-in Beta posture: default off
	// so a custom dashboard keeps rendering in the chromeless iframe
	// until the user deliberately switches.
	stationHomeEnabled: false,
	// Shared admin-asset cache (Experimental) — off until the user
	// opts in; the SW picks the change up on the next reload.
	adminAssetCacheEnabled: false,
	// Hover-intent window prewarming (Experimental) — off until the
	// user opts in; read live by the dock at hover time.
	windowPrewarmEnabled: false,
	showDesktopOnWallpaperClick: false,
	mioEnabled: false,
	// No opinions: the user has not been to "Make it yours" yet, so
	// they get whatever Mio the site ships.
	mioStyle: { appearance: {}, physics: {} },
	showPostStatusRibbons: true,
	developerModeEnabled: false,
	foldersSharingEnabled: true,
	navPlacement: {},
	navOrder: [],
	dockPromotedPositions: {},
};

