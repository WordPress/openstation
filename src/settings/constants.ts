/**
 * Constants for the OS Settings module.
 *
 * Kept plain (no i18n) so they can be imported from anywhere —
 * including files that shouldn't pull `@wordpress/i18n` into their
 * dependency graph.
 *
 * Most values are fallbacks. The live set comes from
 * `desktopModeConfig.accentColors` / `.defaultWallpaper`, populated by
 * PHP via `desktop_mode_accent_colors` / `desktop_mode_default_wallpaper`
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
export const DEFAULT_WALLPAPER_ID = 'dark';

/**
 * Built-in accent swatches applied to `--wp-admin-theme-color`.
 *
 * This is the compile-time fallback list used when PHP doesn't hand
 * us a live `accentColors` array in `desktopModeConfig` — the live list
 * is what the picker actually renders. Plugins that want to
 * customise the list should hook `desktop_mode_accent_colors` in PHP,
 * not fork this constant.
 */
export const DEFAULT_ACCENTS: readonly AccentColor[] = [
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
 * Reads `window.wp.desktop.config.accentColors` (populated by PHP via
 * `desktop_mode_accent_colors`) and validates each entry shape. Drops
 * malformed entries rather than letting a bad filter render broken
 * swatches. Falls back to {@link DEFAULT_ACCENTS} when the config is
 * missing or yields zero valid entries.
 *
 * @since 0.11.0
 */
export function getAccents(): readonly AccentColor[] {
	const config = ( window as unknown as {
		wp?: { desktop?: { config?: DesktopConfig } };
	} ).wp?.desktop?.config;
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
 * `window.wp.desktop.config.defaultWallpaper` and falls back to
 * {@link DEFAULT_WALLPAPER_ID} when absent/invalid.
 *
 * @since 0.11.0
 */
export function getDefaultWallpaperId(): string {
	const config = ( window as unknown as {
		wp?: { desktop?: { config?: DesktopConfig } };
	} ).wp?.desktop?.config;
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
 * Dock-placement options. Drives the `data-desktop-mode-dock-placement`
 * attribute that each `Dock` instance writes onto its own root. CSS
 * keys off that attribute to position the rail, flip the tooltip
 * anchor, and adjust the desktop-area inset.
 *
 * Placement is no longer user-tunable on its own: it is derived from
 * the active `desktopLayout` (classic uses both `bottom` and `left`,
 * unified + spatial both use `bottom`). The list is kept around as
 * the canonical orientation set the dock and its CSS reason about.
 */
export const DOCK_PLACEMENTS = [
	{ id: 'bottom', label: 'Bottom' },
	{ id: 'left', label: 'Left' },
	{ id: 'right', label: 'Right' },
] as const;

/**
 * Desktop layout options. User picks one in OS Settings → Appearance;
 * the shell root reflects the choice in `data-desktop-mode-layout` and
 * the layout dispatcher rebuilds the dock(s) + desktop icons.
 */
export const DESKTOP_LAYOUTS = [
	{ id: 'classic', label: 'Classic' },
	{ id: 'unified', label: 'Unified' },
	{ id: 'spatial', label: 'Spatial' },
] as const;

export const DEFAULTS: OsSettingsState = {
	wallpaper: DEFAULT_WALLPAPER_ID,
	accent: 'wp-blue',
	dockSize: 'default',
	desktopLayout: 'classic',
	dockRailRenderer: 'default',
	customGradient: {
		from: '#2271b1',
		to: '#7c3aed',
		angle: 135,
	},
	customImage: null,
	libraryHdOnly: true,
	ai: {
		enabled: false,
		provider: 'openai',
		apiKey: '',
		apiKeys: {},
		transport: 'off',
	},
	// Opt-out as of 0.8.0. Fresh installs land on the native Posts
	// window — same screen the rest of desktop mode is built for. A
	// user can still flip this off to fall back to the chromeless
	// `edit.php` iframe, but the new default is "use the native UI."
	heartbeatRate: 60,
	nativePostsEnabled: true,
	nativePostsHiddenColumns: [],
	// Same opt-out posture as Posts — fresh installs land on the
	// native Pages window, users can flip back to the iframe.
	nativePagesEnabled: true,
	// Native Users window — same opt-out posture. Capability-gated
	// server-side (the window is only registered for users with
	// `list_users`), so flipping this off only affects the small set
	// of users who can see the Users tile in the first place.
	nativeUsersEnabled: true,
	// Native Plugins window — replaces `plugins.php` and
	// `plugin-install.php`. Same opt-out posture; cap-gated on
	// `activate_plugins` server-side, so flipping this off only
	// affects users who could see the Plugins tile anyway.
	nativePluginsEnabled: true,
	// Native Comments window — replaces `edit-comments.php`. Same
	// opt-out posture; cap-gated on `edit_posts` server-side.
	nativeCommentsEnabled: true,
	showDesktopOnWallpaperClick: false,
	showPostStatusRibbons: true,
	foldersSharingEnabled: true,
	itemVisibility: {},
	dockOrder: [],
	dockPromotedPositions: {},
};

/**
 * Live-progress transport options. Order is the picker order in OS Settings.
 *
 * Default `off` is reliable on every host; `sse` is faster but needs the
 * server (and any reverse proxy in front of it) to allow long-lived
 * `text/event-stream` connections.
 *
 * @since 0.18.1
 */
export const AI_TRANSPORTS = [
	{ id: 'off', label: 'Off' },
	{ id: 'sse', label: 'Streaming (SSE)' },
] as const;

/**
 * Hard-coded fallback list — the only provider we know about without
 * reading the runtime registry. {@link getAiProviders} prefers the
 * runtime `desktopModeConfig.aiProviders` list when present, so adding a
 * new provider is a pure PHP concern.
 */
export const AI_PROVIDERS: ReadonlyArray< {
	id: string;
	label: string;
	description?: string;
	apiKeyLabel?: string;
	apiKeyLink?: string;
} > = [
	{
		id: 'openai',
		label: 'OpenAI',
		apiKeyLabel: 'OpenAI API key',
		apiKeyLink: 'https://platform.openai.com/api-keys',
	},
];

/**
 * Returns the runtime list of registered AI providers.
 *
 * Falls back to {@link AI_PROVIDERS} when the shell config is missing
 * (rare — happens in some test contexts and the very first frame
 * before `desktopModeConfig` is populated).
 */
export function getAiProviders(): ReadonlyArray< {
	id: string;
	label: string;
	description?: string;
	apiKeyLabel?: string;
	apiKeyLink?: string;
} > {
	const cfg = (
		window as typeof window & {
			desktopModeConfig?: {
				aiProviders?: Array< {
					id: string;
					label: string;
					description?: string;
					api_key_label?: string;
					api_key_link?: string;
					capabilities?: string[];
				} >;
			};
		}
	).desktopModeConfig;

	const list = cfg?.aiProviders;
	if ( ! Array.isArray( list ) || list.length === 0 ) {
		return AI_PROVIDERS;
	}

	return list.map( ( p ) => ( {
		id: p.id,
		label: p.label,
		description: p.description,
		apiKeyLabel: p.api_key_label,
		apiKeyLink: p.api_key_link,
	} ) );
}
