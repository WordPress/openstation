/**
 * Desktop Mode — OS Settings.
 *
 * Shell-level preferences that live outside WordPress: wallpaper, accent
 * color, dock size. Persisted to localStorage so they survive reloads
 * without a round-trip to the server; applied via the wallpaper layer +
 * CSS custom properties on the desktop shell so every downstream rule
 * (title bars, dock chips, focus rings, window chrome) inherits the new
 * values without per-rule plumbing.
 *
 * Wallpapers are registry-driven: built-in presets live in
 * `src/wallpapers/built-in.ts`, third-party plugins register via the
 * public `wp.desktop.registerWallpaper()` / `desktop-mode.wallpapers`
 * filter, and this module is responsible only for
 *
 *   - managing user preference state (current wallpaper id, accent,
 *     dock size, custom-gradient colors/angle, custom-image reference)
 *   - delegating wallpaper application to the WallpaperLayer
 *   - rendering the OS Settings panel UI, iterating the registry to
 *     produce swatches and hosting each selected wallpaper's optional
 *     in-panel editor (`renderEditor`).
 *
 * The 1,400-line monolith was split into this folder:
 *
 *   src/settings/
 *   ├── index.ts           — this file: class + panel composition
 *   ├── types.ts           — shared interfaces
 *   ├── constants.ts       — STORAGE_KEY, ACCENTS, DOCK_SIZES, DEFAULTS, ids
 *   ├── utils.ts           — stripHtml, isPromise, sanitize*, isHexColor
 *   ├── labels.ts          — translated accent / dock-size labels
 *   ├── state.ts           — load / save / sanitizers
 *   ├── media-api.ts       — REST client
 *   └── sections/
 *       ├── wallpaper.ts   — swatch grid + editor slot + custom-gradient
 *       ├── custom-image.ts — upload + library tabs
 *       ├── accent.ts      — accent swatch row
 *       └── dock-size.ts   — segmented dock-size control
 */

import type { WallpaperLayer } from '../wallpapers/layer';
import type { WallpaperTeardown } from '../wallpapers/types';
import * as registry from '../wallpapers/registry';
import { seedWallpaperSettings } from '../wallpapers/settings-store';
import {
	ADMIN_BAR_MODES,
	DEFAULT_WALLPAPER_ID,
	DOCK_SIZES,
	WINDOW_RADII,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import {
	loadState,
	saveState,
	setLastConfirmedState,
	type OsSettingsSaveLifecycleDetail,
} from './state';
import { setActiveDockRailRenderer } from '../dock-rail';
import { applyDesktopTheme } from '../desktop-themes/apply';
import type {
	OsSettingsConfig,
	OsSettingsState,
	SettingsCtx,
} from './types';
import {
	registerCustomGradient,
	registerCustomImageIfPresent,
} from './sections/wallpaper';
import type { OsSettingsSnapshot } from './registry';

export type { OsSettingsConfig };

/**
 * Lazy-load the `os-settings-panel[.min].js` bundle.
 *
 * Idempotent — concurrent callers share a single promise; once the
 * bundle has registered `window.desktopModeRenderOsSettingsPanel`,
 * subsequent calls resolve synchronously from the global.
 */
let _panelLoadPromise:
	| Promise< NonNullable< Window[ 'desktopModeRenderOsSettingsPanel' ] > >
	| null = null;
function loadOsSettingsPanelBundle(
	scriptUrl: string,
): Promise< NonNullable< Window[ 'desktopModeRenderOsSettingsPanel' ] > > {
	if ( window.desktopModeRenderOsSettingsPanel ) {
		return Promise.resolve( window.desktopModeRenderOsSettingsPanel );
	}
	if ( _panelLoadPromise ) {
		return _panelLoadPromise;
	}
	_panelLoadPromise = new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-desktop-mode-os-settings-panel="1"]',
		);
		const finish = (): void => {
			const fn = window.desktopModeRenderOsSettingsPanel;
			if ( ! fn ) {
				reject(
					new Error(
						'[desktop-mode] os-settings-panel bundle loaded but did not register desktopModeRenderOsSettingsPanel',
					),
				);
				return;
			}
			resolve( fn );
		};
		if ( existing ) {
			if ( window.desktopModeRenderOsSettingsPanel ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load os-settings-panel bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.desktopModeOsSettingsPanel = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load os-settings-panel bundle' ) ),
		);
		document.head.appendChild( s );
	} );
	return _panelLoadPromise;
}

/**
 * OS Settings controller.
 *
 * Single instance per shell. Owns the persisted state, delegates
 * wallpaper painting to the {@link WallpaperLayer}, and renders the
 * configuration panel into a native window's body on demand.
 *
 * Implements `SettingsCtx` so section builders can depend on the
 * narrow interface instead of the class itself.
 */
export class OsSettings implements SettingsCtx {
	public state: OsSettingsState;
	public config: OsSettingsConfig;
	public layer: WallpaperLayer;

	/**
	 * Teardown for whichever wallpaper's `renderEditor` is currently
	 * mounted in the OS Settings panel. Null when no editor is active.
	 */
	public activeEditorTeardown: WallpaperTeardown | null = null;

	/**
	 * Unsubscribe from the settings-tab registry. Set while a panel is
	 * mounted; cleared when the panel re-renders or the next render
	 * takes over.
	 *
	 * Public because the lazy panel-render module
	 * (`src/settings/panel.ts`) reads and writes it across renders.
	 */
	public tabRegistryUnsubscribe: ( () => void ) | null = null;

	/**
	 * Most-recent active settings tab id, captured from
	 * `wpd-tab-change`. Used to keep the user on whatever tab they
	 * picked when a registry mutation forces the panel to re-render
	 * (e.g. when a third-party plugin live-registers a new settings
	 * tab via the chromeless plugins-changed bridge).
	 *
	 * Public for the same reason as `tabRegistryUnsubscribe` above.
	 */
	public activeTabId: string | null = null;

	/**
	 * Subscribers to OS Settings state changes — third-party tabs that
	 * need to react when the user edits AI key / accent / etc. in an
	 * adjacent built-in tab. Fired from {@link save}.
	 */
	private osSettingsListeners = new Set<( snapshot: OsSettingsSnapshot ) => void>();

	/** Project the private state into the public snapshot shape. */
	public getOsSettingsSnapshot(): OsSettingsSnapshot {
		return {
			wallpaper: this.state.wallpaper,
			accent: this.state.accent,
			dockSize: this.state.dockSize,
			windowRadius: this.state.windowRadius,
			adminBarMode: this.state.adminBarMode,
			desktopLayout: this.state.desktopLayout,
			dockRailRenderer: this.state.dockRailRenderer,
			desktopTheme: this.state.desktopTheme,
			appliedThemeRecommendations:
				this.state.appliedThemeRecommendations.slice(),
			unfocusEffect: this.state.unfocusEffect,
			windowReveal: this.state.windowReveal,
			windowRevealDuration: this.state.windowRevealDuration,
			windowLinkRenderer: this.state.windowLinkRenderer,
			windowLinkVisibility: this.state.windowLinkVisibility,
			windowLinksEnabled: this.state.windowLinksEnabled,
			windowLinkRaiseOnFocus: this.state.windowLinkRaiseOnFocus,
			windowLinkHighlight: this.state.windowLinkHighlight,
			ai: { ...this.state.ai },
			nativePostsEnabled: this.state.nativePostsEnabled,
			nativePostsHiddenColumns: this.state.nativePostsHiddenColumns.slice(),
			nativePagesEnabled: this.state.nativePagesEnabled,
			nativeUsersEnabled: this.state.nativeUsersEnabled,
			nativePluginsEnabled: this.state.nativePluginsEnabled,
			nativeCommentsEnabled: this.state.nativeCommentsEnabled,
			developerModeEnabled: this.state.developerModeEnabled,
			foldersSharingEnabled: this.state.foldersSharingEnabled,
			itemVisibility: { ...this.state.itemVisibility },
			dockOrder: this.state.dockOrder.slice(),
			dockPromotedPositions: Object.fromEntries(
				Object.entries( this.state.dockPromotedPositions ).map(
					( [ k, v ] ) => [ k, { ...v } ],
				),
			),
		};
	}

	public subscribeOsSettings(
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	): () => void {
		this.osSettingsListeners.add( cb );
		return () => {
			this.osSettingsListeners.delete( cb );
		};
	}

	/**
	 * Last `body` element a `renderPanel()` call mounted into. Tracked
	 * so the save-failure rollback handler can re-render the panel
	 * without the caller having to plumb the body through.
	 *
	 * Cleared when the body becomes detached (window closed) so a
	 * stale handler can't paint into a dead DOM tree.
	 */
	private _lastRenderedBody: HTMLElement | null = null;

	constructor( config: OsSettingsConfig, layer: WallpaperLayer ) {
		this.config = config;
		this.layer = layer;
		this.state = loadState();

		// Prime the rollback baseline so the FIRST failed save still
		// has a snapshot to revert to. The boot state came from user
		// meta and is by definition server-confirmed.
		setLastConfirmedState( this.state );

		// Auto-rollback on save failure — restore the in-memory state
		// to the last server-confirmed snapshot AND re-render the
		// panel so the controls visually revert. Without this, the
		// optimistic UI lies: the user toggles a setting offline, the
		// save fails, and the toggle stays in its (incorrect) flipped
		// position until a manual reload reconciles with the server.
		document.addEventListener(
			'desktop-mode-os-settings-save-lifecycle',
			( e: Event ) => {
				const detail = ( e as CustomEvent< OsSettingsSaveLifecycleDetail > )
					.detail;
				if ( ! detail || detail.phase !== 'failed' || ! detail.rolledBackTo ) {
					return;
				}
				this.state = detail.rolledBackTo;
				this.apply();
				if ( this._lastRenderedBody?.isConnected ) {
					this.renderPanel( this._lastRenderedBody );
				}
			},
		);

		// Built-in dynamic wallpapers — registered here rather than in
		// `built-in.ts` because their `resolveValue` and `renderEditor`
		// close over state that lives on this instance.
		registerCustomGradient( this );
		registerCustomImageIfPresent( this.state );
	}

	/**
	 * Apply the current state: wallpaper via the layer, accent + dock
	 * size as CSS custom properties on the shell.
	 *
	 * Safe to call repeatedly — calls into `layer.apply` dedupe via
	 * generation counter; CSS property writes are idempotent.
	 */
	public apply(): void {
		const shell = document.getElementById( 'desktop-mode-shell' );
		if ( ! shell ) {
			return;
		}

		// Mirror the persisted per-wallpaper settings into the shared
		// runtime store BEFORE the layer mounts anything, so the mount's
		// `ctx.settings` reads the user's saved values. apply() runs on
		// boot, on every settings change, and after a save-failure
		// rollback — re-seeding on each covers all three paths.
		seedWallpaperSettings( this.state.wallpaperSettings );

		// Wallpaper — look up in the registry. Fall back to the
		// server-declared default id (via `desktop_mode_default_wallpaper`)
		// if the saved wallpaper was registered by a plugin that's no
		// longer loaded, then to the TS compile-time default as a last
		// resort.
		const def =
			registry.get( this.state.wallpaper ) ||
			registry.get( getDefaultWallpaperId() ) ||
			registry.get( DEFAULT_WALLPAPER_ID ) ||
			registry.all()[ 0 ];
		if ( def ) {
			this.layer.apply( def );
		}

		const accents = getAccents();
		const accent = accents.find( ( a ) => a.id === this.state.accent ) ?? accents[ 0 ];
		const dockSize =
			DOCK_SIZES.find( ( d ) => d.id === this.state.dockSize ) ?? DOCK_SIZES[ 1 ];
		const windowRadius =
			WINDOW_RADII.find( ( r ) => r.id === this.state.windowRadius ) ??
			WINDOW_RADII[ 1 ];

		// Set on <html> rather than the shell so the cascade reaches
		// siblings of #desktop-mode-shell — specifically the WordPress
		// admin bar, which needs --desktop-mode-dock-width to size its
		// leftmost (W-logo) slot in visual alignment with the dock
		// below it. Shell-scoped variables cascade to shell children
		// only; :root-scoped variables cascade everywhere.
		const root = document.documentElement;
		root.style.setProperty( '--wp-admin-theme-color', accent.value );
		root.style.setProperty( '--desktop-mode-dock-width', `${ dockSize.width }px` );
		root.style.setProperty( '--desktop-mode-dock-icon-size', `${ dockSize.icon }px` );
		root.style.setProperty(
			'--desktop-mode-window-radius',
			`${ windowRadius.value }px`,
		);
		// ALSO on the shell element, and this one is not redundant.
		//
		// A desktop theme may declare `--desktop-mode-window-radius`
		// in its `tokens`, and the compiled stylesheet writes it on
		// `.desktop-mode-shell[data-desktop-mode-desktop-theme="…"]`
		// and `body.desktop-mode-desktop-theme-…`. Both of those
		// MATCH an ancestor of every window, while the `:root` write
		// above only reaches windows by inheritance — so the theme
		// would win and the Window-corners preset would silently do
		// nothing for as long as that theme was worn.
		//
		// An inline style on the shell outranks any selector, so the
		// user's pick is authoritative. A theme that wants a
		// particular radius asks for it through
		// `recommendedOsSettings.windowRadius`, which sets the user's
		// preference once and leaves it theirs to change.
		shell.style.setProperty(
			'--desktop-mode-window-radius',
			`${ windowRadius.value }px`,
		);

		// Admin-bar mode — a body class rather than a shell-scoped
		// attribute, because the thing it styles (`#wpadminbar`) is a
		// SIBLING of the shell, not a descendant. PHP writes the same
		// class on `admin_body_class` so the first paint is already
		// correct; re-writing it here is what makes a pick in OS
		// Settings take effect without a reload.
		const adminBarMode =
			ADMIN_BAR_MODES.find( ( m ) => m.id === this.state.adminBarMode ) ??
			ADMIN_BAR_MODES[ 0 ];
		for ( const mode of ADMIN_BAR_MODES ) {
			document.body.classList.toggle(
				`desktop-mode-admin-bar-${ mode.id }`,
				mode.id === adminBarMode.id,
			);
		}

		// Desktop layout is driven by an attribute on the shell root;
		// the layout dispatcher (desktop.ts) reads it on init and on
		// every settings change to rebuild the dock(s) and (in spatial
		// mode) the synthesized desktop icons. Written here so every
		// apply() is the single source of truth — no matter how the
		// state got to this point (init from localStorage, picker
		// change, reset).
		shell.setAttribute(
			'data-desktop-mode-layout',
			this.state.desktopLayout,
		);

		// Dock rail renderer pick — push into the registry so the
		// dispatcher rebuilds the rails when the resolved renderer
		// changes. Doing this from `apply()` (rather than only on
		// settings save) covers the boot path: state loads from
		// server / localStorage, `apply()` runs, registry mirrors
		// the persisted choice.
		setActiveDockRailRenderer( this.state.dockRailRenderer );

		// Desktop theme. One line covers every path that can change
		// it — boot, picking a theme in the Themes tab, resetting
		// settings, and the rollback after a failed save all funnel
		// through `apply()`. `applyDesktopTheme` dedupes on the active
		// id, so the repeated calls this makes cost two comparisons.
		applyDesktopTheme( this.state.desktopTheme );
	}

	public save( opts: { windowId?: string } = {} ): void {
		saveState( this.state, opts );
		if ( this.osSettingsListeners.size > 0 ) {
			const snapshot = this.getOsSettingsSnapshot();
			const listeners = Array.from( this.osSettingsListeners );
			for ( const cb of listeners ) {
				try {
					cb( snapshot );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[desktop-mode] os-settings listener threw:',
							err,
						);
					}
				}
			}
		}
	}

	/**
	 * Render the settings panel into the given native-window body.
	 *
	 * Builds three sections (wallpaper, accent, dock size) and wires
	 * each to save/apply on change. The panel is a one-shot build per
	 * window open — closing and re-opening renders a fresh tree.
	 */
	/**
	 * Render the settings panel into the given native-window body.
	 *
	 * Lazy — the actual rendering logic plus every
	 * `<wpd-*>` component the panel uses lives in
	 * `src/settings/panel.ts`, compiled into its own Vite target
	 * `os-settings-panel[.min].js`. The script is injected on the
	 * first call below and the matching
	 * `window.desktopModeRenderOsSettingsPanel( ctx, body )` global
	 * is then invoked. Subsequent calls (registry-driven re-render,
	 * save-failure rollback) skip the load and forward immediately.
	 *
	 * Why this is a `<script>`-injected sibling bundle rather than
	 * an in-bundle dynamic import: Vite IIFE lib mode inlines
	 * `import()` calls, so an in-bundle lazy import would give zero
	 * byte savings. A separate Vite target is the only mechanism
	 * that actually shrinks `desktop.min.js`. See the Stage 8
	 * section of `BUNDLE-SIZE-REPORT.md` for the full picture.
	 */
	/**
	 * Switch the active settings tab. Records the choice on
	 * {@link activeTabId} (so the next render mounts on it) and, when
	 * the panel is currently mounted, flips the live `<wpd-tabs>` value
	 * in place so an already-open OS Settings window jumps to the tab
	 * without a full re-render. Deep-linking entry points
	 * (`openOsSettings({ tabId })`) call this after opening the window.
	 *
	 * @param tabId Settings tab id, e.g. `'ai'`, `'apps-icons'`.
	 */
	public focusTab( tabId: string ): void {
		this.activeTabId = tabId;
		const body = this._lastRenderedBody;
		if ( ! body?.isConnected ) {
			return;
		}
		const tabs = body.querySelector( 'wpd-tabs' ) as
			| ( HTMLElement & { value?: string } )
			| null;
		if ( tabs ) {
			tabs.value = tabId;
		}
	}

	public renderPanel( body: HTMLElement ): void {
		// Track the body so the save-failure rollback handler can
		// re-render after restoring the last-confirmed state.
		this._lastRenderedBody = body;

		const fn = window.desktopModeRenderOsSettingsPanel;
		if ( fn ) {
			fn( this, body );
			return;
		}

		void loadOsSettingsPanelBundle(
			this.config.osSettingsPanelBundleUrl ?? '',
		)
			.then( ( render ) => {
				if ( ! body.isConnected ) {
					return;
				}
				render( this, body );
			} )
			.catch( ( err ) => {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[desktop-mode] OS Settings panel failed to load:',
						err,
					);
				}
			} );
	}
}

