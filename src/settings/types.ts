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
 * runtime list in `desktopModeConfig.aiProviders`, populated by every
 * plugin that calls `desktop_mode_register_ai_provider()`.
 */
export type AiProviderId = string;

/**
 * Live-progress transport for the AI Copilot search.
 *
 * - `sse` — Server-Sent Events. Real-time progress ticks; preferred where the
 *   host allows long-lived `text/event-stream` connections.
 * - `off` — single REST request, no progress ticks. Works everywhere; the
 *   user sees "Thinking…" until the final answer arrives.
 *
 * Default `off` because some hosts silently drop SSE mid-stream, which
 * surfaces to the user as "Lost connection to the assistant". Power users
 * on hosts known to support SSE can opt in.
 *
 * @since 0.18.1
 */
export type AiTransportId = 'sse' | 'off';

/** AI integration preferences — provider choice + per-provider API keys. */
export interface AiSettings {
	enabled: boolean;
	provider: AiProviderId;
	/** Legacy single-key field; treated as the OpenAI key for backwards compat. */
	apiKey: string;
	/** Per-provider key map. Falls back to `apiKey` for `openai`. */
	apiKeys: Record< string, string >;
	/**
	 * Live-progress transport. See {@link AiTransportId}. Default `off`.
	 *
	 * @since 0.18.1
	 */
	transport: AiTransportId;
}

/** Provider entry surfaced via `desktopModeConfig.aiProviders`. */
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
	 * Active dock rail-renderer id. Resolves through the dock-rail
	 * registry; missing or invalid falls back to `'default'` (the
	 * built-in icon-strip renderer).
	 *
	 * @since 0.18.0
	 */
	dockRailRenderer: string;
	customGradient: CustomGradient;
	customImage: CustomImage | null;
	/**
	 * Whether the Media Library picker filters out small images. Default
	 * on — smaller images are icons/avatars that look terrible stretched
	 * to cover the desktop.
	 */
	libraryHdOnly: boolean;
	ai: AiSettings;
	/**
	 * Per-user opt-in for the native Posts window. When true, clicking
	 * the Posts dock tile opens the `<wpd-table>`-driven native window
	 * instead of the chromeless `edit.php` iframe. Default off so
	 * existing muscle memory is preserved on upgrade.
	 *
	 * @since 0.8.0
	 */
	nativePostsEnabled: boolean;
	/**
	 * Per-user list of column keys hidden in the native Posts window.
	 * Stored as the column `key` strings (`'author'`, `'categories'`,
	 * `'tags'`, `'date'`, plus any plugin-added column keys). The
	 * sticky `'title'` column is always visible — toggling it is
	 * blocked at the UI layer. Default empty (all columns visible).
	 *
	 * @since 0.8.0
	 */
	nativePostsHiddenColumns: string[];
	/**
	 * Per-user opt-in for the native Pages window. When true, clicking
	 * the Pages dock tile (or any link to `edit.php?post_type=page`)
	 * opens the `<wpd-table>`-driven native window instead of the
	 * chromeless iframe. Defaults on — see the matching default in
	 * `constants.ts`.
	 *
	 * @since 0.18.0
	 */
	nativePagesEnabled: boolean;
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
