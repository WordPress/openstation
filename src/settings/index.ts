/**
 * OpenStation — OpenStation Preferences.
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
 * public `wp.os.registerWallpaper()` / `os.wallpapers`
 * filter, and this module is responsible only for
 *
 *   - managing user preference state (current wallpaper id, accent,
 *     dock size, custom-gradient colors/angle, custom-image reference)
 *   - delegating wallpaper application to the WallpaperLayer
 *   - rendering the OpenStation Preferences panel UI, iterating the registry to
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
 *       └── desktop-layout.ts — layout cards + inline dock options
 */

import type { WallpaperLayer } from '../wallpapers/layer';
import type { WallpaperTeardown } from '../wallpapers/types';
import * as registry from '../wallpapers/registry';
import { seedWallpaperSettings } from '../wallpapers/settings-store';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DEFAULT_WALLPAPER_ID,
	DOCK_BEHAVIORS,
	DOCK_SIZES,
	WINDOW_RADII,
	getAccents,
	getDefaultWallpaperId,
} from './constants';
import { refreshWorkArea } from '../work-area';
import { refreshDockBehavior } from '../dock-behavior';
import {
	loadState,
	saveState,
	type OsSettingsSaveLifecycleDetail,
} from './state';
import { setActiveDockRailRenderer } from '../dock-rail';
import { applyDesktopTheme } from '../desktop-themes/apply';
import { ensureDeferredStyle } from '../deferred-styles';
import { showInlineLoader } from '../ui/inline-loader';
import { __ } from '../i18n';
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
 * bundle has registered `window.openStationRenderOsSettingsPanel`,
 * subsequent calls resolve synchronously from the global.
 *
 * **A failure is not memoized.** The rejected promise is dropped and
 * the dead `<script>` is removed from the DOM, so the next call injects
 * a fresh tag and genuinely re-fetches. Without both halves a retry is
 * theatre: keeping the promise re-awaits the same rejection, and
 * keeping the tag sends the retry down the `existing` branch below to
 * attach listeners to a script whose `error` already fired and will
 * never fire again — a spinner that hangs forever. The panel offers the
 * user a Retry control, and a transient network blip is the ordinary
 * reason it is pressed.
 */
let _panelLoadPromise:
	| Promise< NonNullable< Window[ 'openStationRenderOsSettingsPanel' ] > >
	| null = null;
function loadOsSettingsPanelBundle(
	scriptUrl: string,
): Promise< NonNullable< Window[ 'openStationRenderOsSettingsPanel' ] > > {
	if ( window.openStationRenderOsSettingsPanel ) {
		return Promise.resolve( window.openStationRenderOsSettingsPanel );
	}
	if ( _panelLoadPromise ) {
		return _panelLoadPromise;
	}
	_panelLoadPromise = new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-settings-panel="1"]',
		);
		const fail = ( err: Error ): void => {
			_panelLoadPromise = null;
			document
				.querySelector( 'script[data-os-settings-panel="1"]' )
				?.remove();
			reject( err );
		};
		const finish = (): void => {
			const fn = window.openStationRenderOsSettingsPanel;
			if ( ! fn ) {
				fail(
					new Error(
						'[openstation] os-settings-panel bundle loaded but did not register openStationRenderOsSettingsPanel',
					),
				);
				return;
			}
			resolve( fn );
		};
		if ( existing ) {
			if ( window.openStationRenderOsSettingsPanel ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					fail( new Error( 'failed to load os-settings-panel bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osSettingsPanel = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			fail( new Error( 'failed to load os-settings-panel bundle' ) ),
		);
		document.head.appendChild( s );
	} );
	return _panelLoadPromise;
}

/**
 * OpenStation Preferences controller.
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
	 * mounted in the OpenStation Preferences panel. Null when no editor is active.
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
	 * `os-window-tab-change`. Used to keep the user on whatever tab
	 * they picked when a registry mutation forces the panel to
	 * re-render (e.g. when a third-party plugin live-registers a new
	 * settings tab via the chromeless plugins-changed bridge).
	 *
	 * Public for the same reason as `tabRegistryUnsubscribe` above.
	 */
	public activeTabId: string | null = null;

	/**
	 * Aborts the previous render's `os-window-tab-change` listener.
	 *
	 * The tab strip lives on the window element now, not inside the
	 * panel's render root, so it is NOT replaced when the panel
	 * re-renders — which means a listener bound to it would survive
	 * and stack, one more per registry mutation. One controller per
	 * render, aborted by the next.
	 */
	public tabChangeAbort: AbortController | null = null;

	/**
	 * Subscribers to OpenStation Preferences state changes — third-party tabs that
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
			dockPlacement: this.state.dockPlacement,
			dockBehavior: this.state.dockBehavior,
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
			stationHomeEnabled: this.state.stationHomeEnabled,
			adminAssetCacheEnabled: this.state.adminAssetCacheEnabled,
			windowPrewarmEnabled: this.state.windowPrewarmEnabled,
			developerModeEnabled: this.state.developerModeEnabled,
			foldersSharingEnabled: this.state.foldersSharingEnabled,
			showPostStatusRibbons: this.state.showPostStatusRibbons,
			navPlacement: { ...this.state.navPlacement },
			navOrder: this.state.navOrder.slice(),
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
		// `loadState()` primes the rollback + diff baseline itself,
		// but only when it read the state out of user meta. Priming
		// it unconditionally from here was the bug: with the server
		// snapshot absent, the boot state comes from the localStorage
		// cache, which can hold values a previous session never got
		// as far as saving — and a baseline that claims those are
		// confirmed is a baseline that never sends them.
		this.state = loadState();

		// Auto-rollback on save failure — restore the in-memory state
		// to the last server-confirmed snapshot AND re-render the
		// panel so the controls visually revert. Without this, the
		// optimistic UI lies: the user toggles a setting offline, the
		// save fails, and the toggle stays in its (incorrect) flipped
		// position until a manual reload reconciles with the server.
		document.addEventListener(
			'os-settings-save-lifecycle',
			( e: Event ) => {
				const detail = ( e as CustomEvent< OsSettingsSaveLifecycleDetail > )
					.detail;
				if ( ! detail ) {
					return;
				}
				const openStation = ( window as unknown as {
					wp?: {
						os?: {
							windowManager?: {
								getById?: ( id: string ) => {
									markActivity: (
										phase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed',
										opts?: { error?: string },
									) => void;
								} | undefined;
							};
						};
					};
				} ).wp?.os;
				const win = openStation?.windowManager?.getById?.( 'os-settings' );
				if ( win ) {
					win.markActivity( detail.phase, { error: detail.error } );
				}
				if ( detail.phase !== 'failed' || ! detail.rolledBackTo ) {
					return;
				}
				this.state = detail.rolledBackTo;
				this.apply();
				this._notify();
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
		const shell = document.getElementById( 'os-shell' );
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
		// server-declared default id (via `openstation_default_wallpaper`)
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
		/*
		 * Custom resolves from state, not from the list: it is the one
		 * accent with no fixed value, so a lookup would miss it and
		 * fall through to the first preset. Checked before the lookup
		 * rather than after, because the fallback that catches an
		 * unknown id is the same expression and would swallow it.
		 */
		const preset =
			accents.find( ( a ) => a.id === this.state.accent ) ?? accents[ 0 ];
		const accentValue =
			this.state.accent === CUSTOM_ACCENT_ID
				? this.state.customAccent
				: preset.value;
		const dockSize =
			DOCK_SIZES.find( ( d ) => d.id === this.state.dockSize ) ?? DOCK_SIZES[ 1 ];
		const windowRadius =
			WINDOW_RADII.find( ( r ) => r.id === this.state.windowRadius ) ??
			WINDOW_RADII[ 1 ];

		// Set on <body> rather than the shell so the cascade reaches
		// siblings of #os-shell — specifically the WordPress
		// admin bar, which needs --os-dock-width to size its
		// leftmost (W-logo) slot in visual alignment with the dock
		// below it. Shell-scoped variables cascade to shell children
		// only; everything the shell page renders is inside <body>.
		//
		// <body> specifically, not <html>, and that is load-bearing:
		// the brand palette declares `--wp-admin-theme-color` on
		// `body.os-active` (see `variables.css`, which is
		// scoped there so it cannot leak into iframe documents). A
		// custom property inherits from the NEAREST ancestor that has
		// one, regardless of the specificity behind it — so a value
		// written on <html> would lose to that rule for everything
		// inside the body, and the accent picker would appear to do
		// nothing. On the same element, an inline style always wins.
		const root = document.body;
		root.style.setProperty( '--wp-admin-theme-color', accentValue );
		// The control kit paints its on states and selection rings from
		// `--os-ui-accent` — switches, checkboxes, radios, sliders, the
		// segmented pill, the swatch ring. The palette declares it at
		// Pulse, and that declaration stays the brand's; this inline
		// write is the user's pick, and without it choosing an accent
		// moves the title bars and leaves every control pink.
		root.style.setProperty( '--os-ui-accent', accentValue );
		/*
		 * The ambient layer resolves one step back through
		 * `--os-ui-accent-dim` — the dock divider, the selected
		 * sidebar row's wash and bloom, every glow. It has to move
		 * with the pick too, or the station stays pink around a teal
		 * control.
		 *
		 * Pulse keeps the palette's own value rather than a derived
		 * one: the brand mixes its dim by hand, pulling saturation
		 * and lightness down together, and no single step reproduces
		 * that pair. Every other accent gets the darkening step,
		 * which is what "one step back" means for a colour we were
		 * handed rather than given a twin for.
		 */
		const BRAND_ACCENT = '#f252fc';
		const accentDim =
			accentValue.toLowerCase() === BRAND_ACCENT
				? null
				: `color-mix( in srgb, ${ accentValue } 88%, #000 )`;
		if ( accentDim === null ) {
			root.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			root.style.setProperty( '--os-ui-accent-dim', accentDim );
		}
		/*
		 * And again on the shell, for the same reason `--os-window-radius`
		 * is written twice below: a desktop theme declares its own
		 * `--os-ui-accent` on `.os-shell[data-os-desktop-theme="…"]`,
		 * which is a NEARER ancestor of every control than <body> is.
		 * Legacy ships `#2271b1`, so with a theme worn the write above
		 * reaches nothing inside the shell and picking Teal left every
		 * control WordPress blue while the derived `-dim` wash went teal:
		 * one pick, two answers, from the same click.
		 *
		 * An inline style on the shell outranks any selector, so the
		 * user's pick is authoritative in both places.
		 */
		shell.style.setProperty( '--os-ui-accent', accentValue );
		if ( accentDim === null ) {
			shell.style.removeProperty( '--os-ui-accent-dim' );
		} else {
			shell.style.setProperty( '--os-ui-accent-dim', accentDim );
		}
		root.style.setProperty( '--os-dock-width', `${ dockSize.width }px` );
		root.style.setProperty( '--os-dock-icon-size', `${ dockSize.icon }px` );
		root.style.setProperty(
			'--os-window-radius',
			`${ windowRadius.value }px`,
		);
		// ALSO on the shell element, and this one is not redundant.
		//
		// A desktop theme may declare `--os-window-radius`
		// in its `tokens`, and the compiled stylesheet writes it on
		// `.os-shell[data-os-desktop-theme="…"]`
		// and `body.os-desktop-theme-…`. Both of those
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
			'--os-window-radius',
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
				`os-admin-bar-${ mode.id }`,
				mode.id === adminBarMode.id,
			);
		}

		// Dock behavior — the same shape as the admin-bar mode: one
		// `os-dock-<behavior>` body class, written by PHP for the
		// first paint and re-written here so a pick lands live.
		// `dock.css` parks the rail off `os-dock-dynamic`, and the
		// work area stops reserving the rail's band under it — which
		// is why the measurement is refreshed right after the class.
		const dockBehavior =
			DOCK_BEHAVIORS.find( ( b ) => b.id === this.state.dockBehavior ) ??
			DOCK_BEHAVIORS[ 0 ];
		for ( const behavior of DOCK_BEHAVIORS ) {
			document.body.classList.toggle(
				`os-dock-${ behavior.id }`,
				behavior.id === dockBehavior.id,
			);
		}
		refreshDockBehavior();
		refreshWorkArea();

		// Desktop layout is driven by an attribute on the shell root;
		// the layout dispatcher (desktop.ts) reads it on init and on
		// every settings change to rebuild the dock(s). Written here so
		// every apply() is the single source of truth — no matter how
		// the state got to this point (init from localStorage, picker
		// change, reset).
		shell.setAttribute(
			'data-os-layout',
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
		this._notify();
	}

	private _notify(): void {
		if ( this.osSettingsListeners.size > 0 ) {
			const snapshot = this.getOsSettingsSnapshot();
			const listeners = Array.from( this.osSettingsListeners );
			for ( const cb of listeners ) {
				try {
					cb( snapshot );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[openstation] os-settings listener threw:',
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
	 * `<os-*>` component the panel uses lives in
	 * `src/settings/panel.ts`, compiled into its own Vite target
	 * `os-settings-panel[.min].js`. The script is injected on the
	 * first call below and the matching
	 * `window.openStationRenderOsSettingsPanel( ctx, body )` global
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
	 * the panel is currently mounted, flips the live `<os-tabs>` value
	 * in place so an already-open OpenStation Preferences window jumps to the tab
	 * without a full re-render. Deep-linking entry points
	 * (`openOsSettings({ tabId })`) call this after opening the window.
	 *
	 * @param tabId Settings tab id, e.g. `'ai'`, `'navigation'`.
	 */
	public focusTab( tabId: string ): void {
		this.activeTabId = tabId;
		const body = this._lastRenderedBody;
		if ( ! body?.isConnected ) {
			return;
		}
		const tabs = body.querySelector( 'os-tabs' ) as
			| ( HTMLElement & { value?: string } )
			| null;
		if ( tabs ) {
			tabs.value = tabId;
		}
	}

	public renderPanel( body: HTMLElement ): void {
		// The panel's stylesheet is a `deferredStyles` entry, not a
		// boot enqueue — inject it here so the `<link>` fetches in
		// parallel with the panel bundle below.
		ensureDeferredStyle( 'os-settings' );

		// Track the body so the save-failure rollback handler can
		// re-render after restoring the last-confirmed state.
		this._lastRenderedBody = body;

		const fn = window.openStationRenderOsSettingsPanel;
		if ( fn ) {
			fn( this, body );
			return;
		}

		// The window's own spinner has already gone: the native-window
		// render callback that got us here returned synchronously, so
		// `markWindowContentReady()` fired while THIS bundle is still in
		// flight. Without an affordance of its own the panel is an empty
		// window body — and on a rejection it was an empty window body
		// permanently, with nothing but a console line to say why.
		const loader = showInlineLoader( body, {
			label: __( 'Loading preferences…' ),
		} );

		void loadOsSettingsPanelBundle(
			this.config.osSettingsPanelBundleUrl ?? '',
		)
			.then( ( render ) => {
				loader.done();
				if ( ! body.isConnected ) {
					return;
				}
				render( this, body );
			} )
			.catch( ( err ) => {
				loader.fail(
					__( 'Preferences could not be loaded.' ),
					// Genuinely re-fetches: `loadOsSettingsPanelBundle`
					// drops both the rejected promise and the dead
					// `<script>` before rejecting.
					() => this.renderPanel( body ),
				);
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] OpenStation Preferences panel failed to load:',
						err,
					);
				}
			} );
	}
}

