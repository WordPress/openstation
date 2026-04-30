/**
 * Shared types for the OS Settings module.
 *
 * Kept in a dedicated file so section builders, persistence helpers,
 * and the REST client can all import without pulling in the class
 * implementation (which would create a circular-import trap).
 */

import type { WallpaperLayer } from '../wallpapers/layer';
import type { WallpaperTeardown } from '../wallpapers/types';
import type { DOCK_SIZES } from './constants';

/**
 * Accent id. Historically derived from the built-in `ACCENTS` tuple,
 * but accents now come from PHP (`desktop_mode_accent_colors`) and a
 * theme can legitimately add its own swatch. String is the honest
 * type — validation happens at runtime in `getAccents()` / state
 * deserialization.
 */
export type AccentId = string;
export type DockSizeId = ( typeof DOCK_SIZES )[ number ][ 'id' ];
export type DockPlacementId = 'left' | 'right' | 'bottom';

/**
 * Top-level desktop layout. User-tunable via OS Settings → Appearance.
 *
 * - `classic` — left side bar with core admin menus + bottom dock with
 *   plugin menus. Two `Dock` instances. Default.
 * - `unified` — single bottom dock with every item. One `Dock` instance.
 * - `spatial` — bottom dock with plugin menus + core menus rendered as
 *   icons on the wallpaper. One `Dock` instance, plus synthesized
 *   desktop icons.
 *
 * @since 0.18.0
 */
export type DesktopLayoutId = 'classic' | 'unified' | 'spatial';

/** Two endpoints on the gradient, plus an angle in degrees (0–360). */
export interface CustomGradient {
	from: string;
	to: string;
	angle: number;
}

/** Uploaded-image wallpaper — both id (for cleanup / re-select) and URL. */
export interface CustomImage {
	id: number;
	url: string;
}

/**
 * AI provider id. Kept as a plain string so new providers can be added
 * without touching the sanitization ladder — the picker is driven by the
 * runtime list in `wpDesktopConfig.aiProviders`, populated by every
 * plugin that calls `desktop_mode_register_ai_provider()`.
 */
export type AiProviderId = string;

/** AI integration preferences — provider choice + per-provider API keys. */
export interface AiSettings {
	enabled: boolean;
	provider: AiProviderId;
	/** Legacy single-key field; treated as the OpenAI key for backwards compat. */
	apiKey: string;
	/** Per-provider key map. Falls back to `apiKey` for `openai`. */
	apiKeys: Record< string, string >;
}

/** Provider entry surfaced via `wpDesktopConfig.aiProviders`. */
export interface AiProviderEntry {
	id: string;
	label: string;
	description: string;
	api_key_label: string;
	api_key_link: string;
	capabilities: string[];
}

/** Shape of the persisted settings. Defaults merged on load. */
export interface OsSettingsState {
	wallpaper: string;
	accent: AccentId;
	dockSize: DockSizeId;
	desktopLayout: DesktopLayoutId;
	/**
	 * Active submenu-renderer id. Resolves through
	 * `wp.desktop.submenu` registry; falls back to `'default'` when
	 * the named renderer is missing (plugin deactivated, typo, etc.).
	 *
	 * @since 0.18.0
	 */
	submenuRenderer: string;
	customGradient: CustomGradient;
	customImage: CustomImage | null;
	/**
	 * Whether the Media Library picker filters out small images. Default
	 * on — smaller images are icons/avatars that look terrible stretched
	 * to cover the desktop.
	 */
	libraryHdOnly: boolean;
	ai: AiSettings;
}

/**
 * Subset of the REST media item we actually use. `_fields` on the
 * request narrows the payload to match so we're not shipping 60kb of
 * Gutenberg-specific metadata for a picker.
 */
export interface MediaItem {
	id: number;
	source_url: string;
	alt_text: string;
	title: { rendered: string };
	media_details: {
		width: number;
		height: number;
		sizes?: Record<
			string,
			{ source_url: string; width: number; height: number } | undefined
		>;
	};
}

/** Config needed to talk to the REST media endpoint. */
export interface OsSettingsConfig {
	mediaUrl: string;
	restNonce: string;
	canUpload: boolean;
	/** Whether the current user has manage_options capability. */
	isAdmin: boolean;
	/** Platform-wide AI settings — null for non-admins. */
	aiPlatformSettings: {
		enabled: boolean;
		provider: string;
		apiKey: string;
		apiKeys?: Record< string, string >;
	} | null;
	/** REST endpoint for reading/writing platform AI settings. */
	aiPlatformSettingsUrl: string;
	/** Platform-wide extended options — null for non-admins. */
	extendedOptions: {
		media_library_enhanced: boolean;
	} | null;
	/** REST endpoint for reading/writing extended options. */
	extendedOptionsUrl: string;
}

/**
 * The context object that section builders and section-scoped helpers
 * receive. The `OsSettings` class implements this interface; decoupling
 * it as an interface lets sections depend on the shape without pulling
 * in the class itself, which would be a circular import.
 */
export interface SettingsCtx {
	state: OsSettingsState;
	config: OsSettingsConfig;
	layer: WallpaperLayer;
	/**
	 * Teardown for the currently-mounted wallpaper editor, or null when
	 * nothing is mounted. Mutable — the wallpaper section updates it as
	 * editors mount/unmount.
	 */
	activeEditorTeardown: WallpaperTeardown | null;
	save(): void;
	apply(): void;
	/** Used by the Reset-to-defaults button to rebuild the panel. */
	renderPanel( body: HTMLElement ): void;
}
