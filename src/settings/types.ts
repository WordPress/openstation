/**
 * Shared types for the OS Settings module.
 *
 * Kept in a dedicated file so section builders, persistence helpers,
 * and the REST client can all import without pulling in the class
 * implementation (which would create a circular-import trap).
 */

import type { NavPlacement } from '../nav/types';
import type { MioLook } from '../mio/types';
import type { WallpaperLayer } from '../wallpapers/layer';
import type { WallpaperTeardown } from '../wallpapers/types';
import type { ADMIN_BAR_MODES, DOCK_SIZES, WINDOW_RADII } from './constants';

/**
 * Accent id. Historically derived from the built-in `ACCENTS` tuple,
 * but accents now come from PHP (`openstation_accent_colors`) and a
 * theme can legitimately add its own swatch. String is the honest
 * type — validation happens at runtime in `getAccents()` / state
 * deserialization.
 */
export type AccentId = string;
export type DockSizeId = ( typeof DOCK_SIZES )[ number ][ 'id' ];
export type WindowRadiusId = ( typeof WINDOW_RADII )[ number ][ 'id' ];
export type AdminBarModeId = ( typeof ADMIN_BAR_MODES )[ number ][ 'id' ];
export type DockPlacementId = 'left' | 'right' | 'bottom';

/**
 * Top-level desktop layout. User-tunable via OS Settings → Appearance.
 *
 * - `unified` — single bottom dock with every item, core cluster
 *   first. One `Dock` instance. Default, and shown as "Unified".
 * - `classic` — left side bar with core admin menus + bottom dock with
 *   plugin menus. Two `Dock` instances. Shown as "Split".
 */
export type DesktopLayoutId = 'classic' | 'unified';

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
 * AI assistant preferences.
 *
 * Credentials live in WordPress Core's Settings → Connectors and provider +
 * model selection is delegated to the Core AI Client, so the only per-user
 * state is the on/off toggle (opt-in, default off).
 */
export interface AiSettings {
	enabled: boolean;
}

/**
 * `openStationConfig.aiAssistant` — availability + per-user state the shell
 * uses to gate the Cmd+K assistant and its admin-bar icon.
 */
export interface AiAssistantConfig {
	/** Core Connectors + Abilities APIs present. When false the assistant is hidden. */
	available: boolean;
	/**
	 * Baseline: a text-generation provider is configured in Settings →
	 * Connectors. Comment scoring (text output only) gates on this.
	 */
	providerConfigured: boolean;
	/**
	 * Stricter: a configured provider supports text generation *and* function
	 * calling — what the agentic assistant needs. Gates the Cmd+K assistant,
	 * its admin-bar icon, and the "AI assistant" toggle.
	 */
	assistantProviderConfigured: boolean;
	/** Per-user toggle (opt-in, default off). */
	enabled: boolean;
	/** Absolute URL of the Settings → Connectors admin screen. */
	connectorsUrl: string;
}

/** Shape of the persisted settings. Defaults merged on load. */
export interface OsSettingsState {
	wallpaper: string;
	accent: AccentId;
	/**
	 * The colour behind the Custom accent swatch. A `#rrggbb` string,
	 * read only when `accent` is `custom`; the presets carry their own
	 * values and never consult it.
	 */
	customAccent: string;
	dockSize: DockSizeId;
	windowRadius: WindowRadiusId;
	/**
	 * How the WordPress admin bar presents above the shell:
	 * `'static'` (always visible, vanilla behavior), `'dynamic'`
	 * (auto-hides to a peek strip, reveals on hover/focus), or
	 * `'hidden'` (not rendered — the default).
	 */
	adminBarMode: AdminBarModeId;
	desktopLayout: DesktopLayoutId;
	/**
	 * Which edge the dock sits on: `'bottom'` (the default),
	 * `'left'`, or `'right'`.
	 *
	 * Read by the layout dispatcher for `'unified'`. `'classic'`
	 * ignores it — that layout
	 * IS a placement decision, a left side bar plus a bottom dock, and
	 * moving one of the two rails would leave both on the same edge.
	 */
	dockPlacement: DockPlacementId;
	/**
	 * Active dock rail-renderer id. Resolves through the dock-rail
	 * registry; missing or invalid falls back to `'default'` (the
	 * built-in icon-strip renderer).
	 */
	dockRailRenderer: string;
	/**
	 * Active desktop-theme slug, or `''` for the system default.
	 *
	 * Resolves through the desktop-theme registry; an unknown slug
	 * (deleted theme, deactivated plugin) degrades silently to the
	 * system default rather than erroring — matching what the PHP
	 * enqueue path does on the same input.
	 */
	desktopTheme: string;
	/**
	 * Slugs of the desktop themes whose `recommendedOsSettings` have
	 * already been seeded into this user's settings.
	 *
	 * A theme's recommendations are applied ONCE — the first time this
	 * user activates it — and this list is the record of that. It is
	 * what makes "a theme never overwrites a choice you made later"
	 * true: re-picking a theme you have worn before changes nothing.
	 * The Themes tab's "Apply recommended layout" action is the
	 * deliberate way back to the author's intended presentation.
	 *
	 * Slugs of themes that are no longer installed are kept: a theme
	 * deleted and reinstalled must not re-seed over settings the user
	 * has since chosen. Capped at 64.
	 */
	appliedThemeRecommendations: string[];
	/**
	 * Active unfocused-window effect id. Resolves through the
	 * unfocus-effect registry; `'none'` means no effect, an unknown id
	 * is treated as `'none'` by the engine until/if a matching effect
	 * registers. Default `'darken'`.
	 */
	unfocusEffect: string;
	/**
	 * Active window-reveal id — the `clip-path` transition that
	 * uncovers a window's content once it has finished loading.
	 * Resolves through the window-reveal registry; `'none'` means no
	 * reveal (the plain opacity fade), and an unknown id is treated as
	 * `'none'` until/if a matching reveal registers. Default `'none'`
	 * — reveals are opt-in.
	 */
	windowReveal: string;
	/**
	 * Global window-reveal duration override, in ms. `0` (the default)
	 * means "use each reveal's own timing" — the built-ins ship tuned
	 * durations, and flattening them all to one number would lose that.
	 * Any other value is clamped to 80–4000 and wins over both the
	 * reveal's own duration and the
	 * `--os-window-reveal-duration` theme token.
	 */
	windowRevealDuration: number;
	/**
	 * Active window-link renderer id. Resolves through the window-link
	 * renderer registry; `'none'` disables the visuals, an unknown id
	 * falls back to the built-in `'svg-splines'`.
	 */
	windowLinkRenderer: string;
	/**
	 * When window-link ties are visible: `'always'` (the default),
	 * `'focus'` (only while a relation-group member is focused), or
	 * `'off'`.
	 */
	windowLinkVisibility: 'focus' | 'always' | 'off';
	/**
	 * Master switch for the window-links feature (OS Settings →
	 * Features). Off unmounts the visuals and disables the group
	 * behaviors; the style knobs keep their values. Default on.
	 */
	windowLinksEnabled: boolean;
	/**
	 * Focusing a relation-group member raises its related windows to
	 * just below it. Default on.
	 */
	windowLinkRaiseOnFocus: boolean;
	/**
	 * Related windows of the focused member get a subtle outline.
	 * Default on.
	 */
	windowLinkHighlight: boolean;
	customGradient: CustomGradient;
	customImage: CustomImage | null;
	/**
	 * Per-wallpaper settings bags, keyed by wallpaper id — the values a
	 * wallpaper's `renderConfig` dialog writes (e.g. the Snow
	 * wallpaper's wind / particle count / flake size / background).
	 * Scalar values only; the wallpaper owns the keys' meaning. Missing
	 * ids mean "never configured" — the wallpaper uses its defaults.
	 * Capped at 64 wallpapers × 32 keys.
	 */
	wallpaperSettings: Record<
		string,
		Record< string, string | number | boolean >
	>;
	/**
	 * Whether the Media Library picker filters out small images. Default
	 * on — smaller images are icons/avatars that look terrible stretched
	 * to cover the desktop.
	 */
	libraryHdOnly: boolean;
	ai: AiSettings;
	/**
	 * Per-user opt-in for the native Posts window. When true, clicking
	 * the Posts dock tile opens the `<os-table>`-driven native window
	 * instead of the chromeless `edit.php` iframe. Default off so
	 * existing muscle memory is preserved on upgrade.
	 */
	/**
	 * Per-user override of the WordPress Heartbeat rate, in
	 * seconds. Applied via the `heartbeat_settings` PHP filter
	 * on every page load. Allowed values: 15 (fast — Core's
	 * "active" default, NOT recommended for general use because
	 * it triples server load vs. the 60 s default), 30 (medium),
	 * 45 (slow), 60 (very slow — default; Core's "idle" speed).
	 *
	 * 5 s isn't offered: WordPress's `minimalInterval` floor
	 * clamps anything below 15 back up to 15 unless every
	 * intermediate filter cooperates, and the perceived benefit
	 * over 15 s is negligible.
	 */
	heartbeatRate: 15 | 30 | 45 | 60;
	nativePostsEnabled: boolean;
	/**
	 * Per-user list of column keys hidden in the native Posts window.
	 * Stored as the column `key` strings (`'author'`, `'categories'`,
	 * `'tags'`, `'date'`, plus any plugin-added column keys). The
	 * sticky `'title'` column is always visible — toggling it is
	 * blocked at the UI layer. Default empty (all columns visible).
	 */
	nativePostsHiddenColumns: string[];
	/**
	 * Per-user opt-in for the native Pages window. When true, clicking
	 * the Pages dock tile (or any link to `edit.php?post_type=page`)
	 * opens the `<os-table>`-driven native window instead of the
	 * chromeless iframe. Defaults on — see the matching default in
	 * `constants.ts`.
	 */
	nativePagesEnabled: boolean;
	/**
	 * Per-user opt-in for the native Users window. When true, the
	 * Users dock tile / `users.php` links open the native
	 * `<os-table>` window instead of the classic iframe. Defaults on.
	 * Capability-gated on the server (the window is only registered
	 * for users with `list_users`); read-only for `list_users`-only
	 * users, with mutation actions appearing only when the matching
	 * `edit_users` / `promote_users` / `delete_users` caps are present.
	 */
	nativeUsersEnabled: boolean;
	/**
	 * Per-user opt-in for the native Plugins window. When true, the
	 * Plugins dock tile / `plugins.php` / `plugin-install.php` links
	 * open the native two-tab window (Installed list + wp.org Browse
	 * gallery) instead of the chromeless iframes. Defaults on.
	 * Capability-gated on the server (`activate_plugins`); the Browse
	 * tab is hidden for users without `install_plugins`. The
	 * `plugin-editor.php` URL is intentionally NOT claimed — it stays
	 * on the existing code-editor iframe.
	 */
	nativePluginsEnabled: boolean;
	/**
	 * Per-user opt-in for the native Comments window. When true, the
	 * Comments dock tile / `edit-comments.php` links open the native
	 * `<os-table>`-driven moderation queue instead of the chromeless
	 * iframe. Defaults on. Capability-gated on the server (`edit_posts`);
	 * bulk + reply actions further cap-gate inside the bundle.
	 */
	nativeCommentsEnabled: boolean;
	/**
	 * Per-user opt-in for Station Home, the native Dashboard window.
	 * When true, the Dashboard dock tile / `index.php` links open
	 * Station Home instead of the chromeless Dashboard iframe. Default
	 * off so custom dashboards (welcome panels, admin-page redirects,
	 * dashboard-replacement plugins) keep working untouched on upgrade.
	 */
	stationHomeEnabled: boolean;
	/**
	 * When true, left-clicking the empty wallpaper triggers the
	 * "Show desktop" toggle (macOS-style) and the matching entry is
	 * hidden from the wallpaper context menu. When false (default),
	 * the entry stays in the context menu and left clicks on the
	 * wallpaper do nothing. Per-user.
	 */
	showDesktopOnWallpaperClick: boolean;
	/**
	 * Whether Mio, the desk companion, is on. Toggled from Mio's dock
	 * tile; the shell lazy-loads `assets/js/mio[.min].js` the first
	 * time it flips true. Off by default. See `docs/mio.md`.
	 */
	mioEnabled: boolean;
	/**
	 * The user's own Mio, as built in "Make it yours" — colours, ring,
	 * glow, hologram, and silhouette. Only the keys they actually
	 * changed are stored, so a site that later ships a different Mio
	 * still shows through everywhere the user has no opinion.
	 *
	 * Here rather than in localStorage because it is a preference about
	 * the person, not the machine: ten minutes spent building a
	 * companion should be waiting on their phone. See `docs/mio.md`.
	 */
	mioStyle: MioLook;
	/**
	 * When true, post-type tiles inside the My WordPress window
	 * carry a diagonal corner ribbon (`Draft` / `Pending` /
	 * `Private` / `Scheduled`) for non-published rows. Per-user.
	 * Defaults to `true` — the ribbon is most users' easiest signal
	 * that a tile won't show up on the front-end yet, so we surface
	 * it out-of-the-box and let people who find it noisy toggle it
	 * off.
	 */
	showPostStatusRibbons: boolean;
	/**
	 * When true, unlocks developer-facing surfaces meant for plugin
	 * authors rather than end users: the Starter Widget appears in
	 * the add-widget picker, and the OS Settings → Components tab
	 * runs its intentional missing-import-warner demo (console
	 * banner + three deliberate console.errors). Defaults to
	 * `false` so regular users don't see developer noise. Per-user.
	 */
	developerModeEnabled: boolean;
	/**
	 * Per-user kill switch for the folder-sharing feature. Defaults
	 * to `true`. When `false`, every share-related surface is
	 * suppressed in this user's shell:
	 *
	 *   - The "Share folder" tile-menu entry and title-bar People
	 *     button never appear.
	 *   - The pending-invite modal never opens.
	 *   - "Leave shared folder" is hidden.
	 *   - The heartbeat skips the `shares.pending` payload for
	 *     this user; share REST routes return 404.
	 *
	 * Independent of the destructive "Delete folder sharing data"
	 * admin action, which drops the tables site-wide.
	 */
	foldersSharingEnabled: boolean;
	/**
	 * Per-item navigation placement. Maps a {@link NavItem} id to one
	 * of `'rail' | 'desktop' | 'both' | 'hidden'`.
	 *
	 * `'rail'` rather than `'dock'` on purpose: for a Core admin menu
	 * in the split layout the rail IS the sidebar, so storing a rail
	 * name would need a migration on every layout switch. See
	 * `src/nav/defaults.ts`.
	 *
	 * Missing keys mean "no override" — the item takes the default for
	 * its kind. Written sparsely: a newly-activated plugin's menu gets
	 * the right default with no write and no reconciliation pass.
	 */
	navPlacement: Record< string, NavPlacement >;
	/**
	 * User-defined ordering, flat across every zone. Each zone renders
	 * its own members in this order; ids not listed keep their
	 * registration order and render after the listed ones. Unknown ids
	 * (a deactivated plugin) survive the round-trip in case it comes
	 * back.
	 *
	 * Flat rather than per-zone so a Core menu keeps its position when
	 * the layout moves it between the dock and the sidebar.
	 */
	navOrder: string[];
	dockPromotedPositions: Record< string, { x: number; y: number } >;
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
	/** Platform-wide extended options — null for non-admins. */
	extendedOptions: {
		media_library_enhanced: boolean;
		games: boolean;
		agents: boolean;
	} | null;
	/** REST endpoint for reading/writing extended options. */
	extendedOptionsUrl: string;
	/**
	 * Fully-qualified URL of the lazy-loaded OS Settings panel
	 * bundle (`os-settings-panel[.min].js`). The class's stub
	 * `renderPanel()` `<script>`-injects it on the user's first
	 * Settings open; the bundle holds every section renderer + the
	 * `<os-*>` components only the panel needs.
	 */
	osSettingsPanelBundleUrl?: string;
	/**
	 * Whether this user may upload / delete desktop themes. Gates the
	 * management controls in the Themes tab; PICKING a theme is
	 * per-user and available to everyone, so the tab itself is not
	 * gated.
	 */
	canManageDesktopThemes?: boolean;
	/**
	 * REST base for the desktop-theme upload / delete routes
	 * (`desktop-mode/v1/desktop-themes`).
	 */
	desktopThemesUrl?: string;
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
