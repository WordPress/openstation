/**
 * Shared types for the Preferences store.
 *
 * Kept in a dedicated file so the persistence helpers, the public API
 * facade and the Preferences app can all import without pulling in the
 * store class (which would create a circular-import trap).
 */

import type { NavPlacement } from '../nav/types';
import type { MioLook } from '../mio/types';
import type {
	ADMIN_BAR_MODES,
	DOCK_BEHAVIORS,
	DOCK_SIZES,
	WINDOW_RADII,
} from './constants';

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
export type DockBehaviorId = ( typeof DOCK_BEHAVIORS )[ number ][ 'id' ];
export type DockPlacementId = 'left' | 'right' | 'bottom';

/**
 * Top-level desktop layout. User-tunable via Preferences → Appearance.
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

/**
 * The persisted settings — the shape user meta holds, the shape
 * `wp.os.getOsSettings()` returns, and the shape
 * `wp.os.updateOsSettings()` patches. Defaults merged on load.
 */
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
	/**
	 * Window corner-radius preset: `'sharp'` | `'default'` | `'round'`.
	 * Written to `--os-window-radius` by the apply pass, so a change
	 * reflows every open window's corners live. A desktop theme that
	 * sets that custom property in its `tokens` overrides this for as
	 * long as the theme is worn.
	 */
	windowRadius: WindowRadiusId;
	/**
	 * How the WordPress admin bar presents above the shell:
	 * `'static'` (always visible, vanilla behavior), `'dynamic'`
	 * (auto-hides to a peek strip, reveals on hover/focus), or
	 * `'hidden'` (not rendered — the default). Written as an
	 * `os-admin-bar-<mode>` body class by both PHP (first paint) and
	 * the apply pass (live changes).
	 */
	adminBarMode: AdminBarModeId;
	desktopLayout: DesktopLayoutId;
	/**
	 * Which edge the dock sits on: `'bottom'` (the default),
	 * `'left'`, or `'right'`.
	 *
	 * Read by the layout dispatcher for `'unified'`. `'classic'`
	 * ignores it — that layout IS a placement decision, a left side
	 * bar plus a bottom dock, and moving one of the two rails would
	 * leave both on the same edge.
	 */
	dockPlacement: DockPlacementId;
	/**
	 * How the dock presents — the single rail in `'unified'`, the
	 * bottom dock in `'classic'`: `'static'` (always on screen, the
	 * default — the band it floats over is reserved from the work
	 * area) or `'dynamic'` (folded into an indicator line at its
	 * edge, expanded when the pointer reaches that edge or something
	 * on it takes focus; reserves nothing).
	 */
	dockBehavior: DockBehaviorId;
	/**
	 * The same choice for the `'classic'` layout's sidebar, its own
	 * rail on its own edge. Ignored by `'unified'`.
	 */
	sideDockBehavior: DockBehaviorId;
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
	 * has since chosen. Capped at 64. Shell-owned — the public write
	 * path ignores it.
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
	 * Master switch for the window-links feature (Preferences →
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
	/**
	 * Per-user opt-in for the native Posts window. When true, clicking
	 * the Posts dock tile opens the `<os-table>`-driven native window
	 * instead of the chromeless `edit.php` iframe. Default off so
	 * existing muscle memory is preserved on upgrade.
	 */
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
	 * chromeless iframe. Default off.
	 */
	nativePagesEnabled: boolean;
	/**
	 * Per-user opt-in for the native Users window. Capability-gated on
	 * the server (the window is only registered for users with
	 * `list_users`). Default off.
	 */
	nativeUsersEnabled: boolean;
	/**
	 * Per-user opt-in for the native Plugins window (Installed list +
	 * wp.org Browse gallery). Capability-gated on the server
	 * (`activate_plugins`). Default off.
	 */
	nativePluginsEnabled: boolean;
	/**
	 * Per-user opt-in for the native Comments window. Capability-gated
	 * on the server (`edit_posts`). Default off.
	 */
	nativeCommentsEnabled: boolean;
	/**
	 * Per-user opt-in for Station Home, the native Dashboard window.
	 * When true, the Dashboard dock tile / `index.php` links open
	 * Station Home instead of the chromeless Dashboard iframe. Default
	 * off so custom dashboards keep working untouched on upgrade.
	 */
	stationHomeEnabled: boolean;
	/**
	 * Per-user opt-in for the service worker's shared admin-asset
	 * cache (Experimental). The value lives server-side and reaches
	 * the SW inside the served script bytes, so a change applies via a
	 * normal SW update on the next reload. Default off.
	 */
	adminAssetCacheEnabled: boolean;
	/**
	 * Per-user opt-in for hover-intent window prewarming
	 * (Experimental). When true, a sustained mouse hover on a dock
	 * tile speculatively builds that page's window hidden. Default off.
	 */
	windowPrewarmEnabled: boolean;
	/**
	 * When true, left-clicking the empty wallpaper triggers the
	 * "Show desktop" toggle (macOS-style) and the matching entry is
	 * hidden from the wallpaper context menu. Default off. Per-user.
	 */
	showDesktopOnWallpaperClick: boolean;
	/**
	 * Whether the "close all windows" shortcut (`⌥⌘W` / `Ctrl+Alt+W`)
	 * asks before it closes. True by default; the dialog's "Don't ask
	 * again" checkbox is the only thing that writes false — which is
	 * why the toggle exists in Preferences → Windows: an opt-out with
	 * no way back is a trap, not a preference. Per-user.
	 */
	confirmCloseAllWindows: boolean;
	/**
	 * Whether Mio, the desk companion, is on. Toggled from Mio's dock
	 * tile; the shell lazy-loads `assets/js/mio[.min].js` the first
	 * time it flips true. Off by default. See `docs/mio.md`.
	 */
	mioEnabled: boolean;
	/**
	 * The user's own Mio, as built in "Make it yours" — colours, ring,
	 * glow, hologram, and silhouette. Only the keys they actually
	 * changed are stored. Per user rather than per browser because it
	 * is a preference about the person, not the machine.
	 */
	mioStyle: MioLook;
	/**
	 * When true, post-type tiles inside the My WordPress window carry
	 * a diagonal corner ribbon (`Draft` / `Pending` / `Private` /
	 * `Scheduled`) for non-published rows. Default on. Per-user.
	 */
	showPostStatusRibbons: boolean;
	/**
	 * When true, unlocks developer-facing surfaces meant for plugin
	 * authors rather than end users: the Starter Widget, the
	 * Preferences → Components tab's missing-import-warner demo, and
	 * Code Blue. Default off. Per-user.
	 */
	developerModeEnabled: boolean;
	/**
	 * Per-user kill switch for the folder-sharing feature. Default on.
	 * When `false`, every share-related surface is suppressed in this
	 * user's shell and the share REST routes return 404. Independent of
	 * the destructive "Delete folder sharing data" admin action.
	 */
	foldersSharingEnabled: boolean;
	/**
	 * Per-item navigation placement. Maps a {@link NavItem} id to one
	 * of `'rail' | 'desktop' | 'both' | 'hidden'`.
	 *
	 * `'rail'` rather than `'dock'` on purpose: for a Core admin menu
	 * in the split layout the rail IS the sidebar, so storing a rail
	 * name would need a migration on every layout switch. Missing keys
	 * mean "no override" — the item takes the default for its kind
	 * (`src/nav/defaults.ts`).
	 */
	navPlacement: Record< string, NavPlacement >;
	/**
	 * User-defined ordering, flat across every zone. Each zone renders
	 * its own members in this order; ids not listed keep their
	 * registration order and render after the listed ones. Unknown ids
	 * (a deactivated plugin) survive the round-trip in case it comes
	 * back.
	 */
	navOrder: string[];
	/**
	 * Persisted desktop position (in CSS px) for every item the user
	 * has promoted onto the wallpaper, keyed by item id. Missing keys
	 * mean "no override" — the synth placement falls back to the
	 * default grid slot.
	 */
	dockPromotedPositions: Record< string, { x: number; y: number } >;
}
