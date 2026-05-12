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
 * As of 0.6.0, wallpapers are registry-driven: built-in presets live in
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
 * The 1,400-line monolith was split in 0.6.1 into this folder:
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
 *
 * @since 0.5.0
 */

import { __ } from '../i18n';
import { html, render } from '../ui/core';
// Side-effect imports — register only the <wpd-*> tags this panel
// actually uses, so the main bundle doesn't drag in components that
// only appear inside lazily-loaded window bundles (category-picker,
// multiselect, tag-input, form, log, flyout, …). Each leaf import
// runs the corresponding `customElements.define()` exactly once.
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-checkbox-label/wpd-checkbox-label';
import '../ui/components/wpd-color-field/wpd-color-field';
import '../ui/components/wpd-empty-state/wpd-empty-state';
import '../ui/components/wpd-panel/wpd-panel';
import '../ui/components/wpd-range-field/wpd-range-field';
import '../ui/components/wpd-section/wpd-section';
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-select/wpd-select';
import '../ui/components/wpd-swatch/wpd-swatch';
import '../ui/components/wpd-swatch-grid/wpd-swatch-grid';
import '../ui/components/wpd-tabs/wpd-tabs';
import '../ui/components/wpd-text-field/wpd-text-field';
import type { WallpaperLayer } from '../wallpapers/layer';
import type { WallpaperTeardown } from '../wallpapers/types';
import * as registry from '../wallpapers/registry';
import {
	DEFAULTS,
	DEFAULT_WALLPAPER_ID,
	DOCK_SIZES,
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
import type {
	OsSettingsConfig,
	OsSettingsState,
	SettingsCtx,
} from './types';
import { buildAboutSection } from './sections/about';
import { buildAccentSection } from './sections/accent';
import { buildAiSection } from './sections/ai';
import { buildAppsIconsSection } from './sections/apps-icons';
import { buildDesktopLayoutSection } from './sections/desktop-layout';
import { buildDockSizeSection } from './sections/dock-size';
import { buildExtendedSection } from './sections/extended';
import { buildFeaturesSection } from './sections/features';
import { buildDockRailRendererSection } from './sections/dock-rail-renderer';
import { buildHelpSection } from './sections/help';
import {
	buildWallpaperSection,
	registerCustomGradient,
	registerCustomImageIfPresent,
	teardownEditor,
} from './sections/wallpaper';
import { listSettingsTabs, subscribeSettingsTabs } from './registry';

// eslint-disable-next-line no-duplicate-imports
import type { DesktopSettingsTab, OsSettingsSnapshot } from './registry';
export type { OsSettingsConfig };

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
	 */
	private tabRegistryUnsubscribe: ( () => void ) | null = null;

	/**
	 * Most-recent active settings tab id, captured from
	 * `wpd-tab-change`. Used to keep the user on whatever tab they
	 * picked when a registry mutation forces the panel to re-render
	 * (e.g. when a third-party plugin live-registers a new settings
	 * tab via the chromeless plugins-changed bridge).
	 */
	private activeTabId: string | null = null;

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
			desktopLayout: this.state.desktopLayout,
			dockRailRenderer: this.state.dockRailRenderer,
			ai: { ...this.state.ai },
			nativePostsEnabled: this.state.nativePostsEnabled,
			nativePostsHiddenColumns: this.state.nativePostsHiddenColumns.slice(),
			nativePagesEnabled: this.state.nativePagesEnabled,
			nativeUsersEnabled: this.state.nativeUsersEnabled,
			nativePluginsEnabled: this.state.nativePluginsEnabled,
			nativeCommentsEnabled: this.state.nativeCommentsEnabled,
			itemVisibility: { ...this.state.itemVisibility },
			dockOrder: this.state.dockOrder.slice(),
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
	public renderPanel( body: HTMLElement ): void {
		// Track the body so the save-failure rollback handler can
		// re-render after restoring the last-confirmed state.
		this._lastRenderedBody = body;

		// Tear down any editor mounted by a previous render — closing
		// the OS Settings window doesn't necessarily fire our teardown
		// path, so we do it defensively here.
		teardownEditor( this );

		// Drop any previous registry subscription — we'll resubscribe
		// below. Without this, every re-render leaks a listener.
		if ( this.tabRegistryUnsubscribe ) {
			this.tabRegistryUnsubscribe();
			this.tabRegistryUnsubscribe = null;
		}

		body.classList.add( 'desktop-mode-os-settings' );

		const onReset = (): void => {
			// Preserve the uploaded image so the user doesn't lose
			// their upload just by resetting theme preferences — the
			// image still lives in Media Library, and it's an easy
			// re-pick.
			const preservedImage = this.state.customImage;
			this.state = { ...DEFAULTS, customImage: preservedImage };
			this.save();
			this.apply();
			this.renderPanel( body );
		};

		// Interleave third-party tabs with the built-ins by `order`.
		// Built-in orders match the hardcoded visual sequence so a
		// plugin registering at `order: 15` slots between Appearance
		// and AI Settings.
		const isAdmin = this.config.isAdmin;
		const externalTabs = listSettingsTabs().filter( ( tab ) =>
			isTabVisible( tab, isAdmin ),
		);

		interface TabRow {
			id: string;
			order: number;
			tab: ReturnType< typeof html >;
			panel: ReturnType< typeof html >;
			/** For external tabs — invoked after render to mount content. */
			mount?: ( host: HTMLElement ) => void;
		}

		const rows: TabRow[] = [
			{
				id: 'appearance',
				order: 10,
				tab: html`<wpd-tab value="appearance"
					>${ __( 'Appearance' ) }</wpd-tab
				>`,
				panel: html`<wpd-tabpanel for="appearance">
					<wpd-panel>
						<p class="desktop-mode-os-settings__intro">
							${ __(
								'Personalize your desktop. Changes apply instantly and are saved to this browser.',
							) }
						</p>
						${ buildWallpaperSection( this, body ) }
						${ buildAccentSection( this ) }
						${ buildDesktopLayoutSection( this ) }
						${ buildDockSizeSection( this ) }
						${ buildDockRailRendererSection( this ) }
					</wpd-panel>
				</wpd-tabpanel>`,
			},
			{
				id: 'ai',
				order: 20,
				tab: html`<wpd-tab value="ai">${ __( 'AI Settings' ) }</wpd-tab>`,
				panel: html`<wpd-tabpanel for="ai">
					<wpd-panel>${ buildAiSection( this ) }</wpd-panel>
				</wpd-tabpanel>`,
			},
			{
				id: 'features',
				order: 25,
				tab: html`<wpd-tab value="features"
					>${ __( 'Features' ) }</wpd-tab
				>`,
				panel: html`<wpd-tabpanel for="features">
					<wpd-panel>${ buildFeaturesSection( this ) }</wpd-panel>
				</wpd-tabpanel>`,
			},
			{
				id: 'apps-icons',
				order: 22,
				tab: html`<wpd-tab value="apps-icons"
					>${ __( 'Apps & Icons' ) }</wpd-tab
				>`,
				panel: html`<wpd-tabpanel for="apps-icons">
					<wpd-panel>${ buildAppsIconsSection( this ) }</wpd-panel>
				</wpd-tabpanel>`,
			},
		];

		if ( isAdmin ) {
			rows.push( {
				id: 'extended',
				order: 30,
				tab: html`<wpd-tab value="extended"
					>${ __( 'Extended Options' ) }</wpd-tab
				>`,
				panel: html`<wpd-tabpanel for="extended">
					<wpd-panel>${ buildExtendedSection( this ) }</wpd-panel>
				</wpd-tabpanel>`,
			} );
			rows.push( {
				id: 'help',
				order: 40,
				tab: html`<wpd-tab value="help">${ __( 'Components' ) }</wpd-tab>`,
				panel: html`<wpd-tabpanel for="help">
					<wpd-panel>${ buildHelpSection() }</wpd-panel>
				</wpd-tabpanel>`,
			} );
		}

		// About — credits + the interactive Pixi particle scene. Pinned
		// to the very end of the tab strip with a sentinel order
		// (`Number.MAX_SAFE_INTEGER`) so it stays last regardless of
		// any third-party tabs registered through the settings-tab
		// registry (which default to `order: 100`). The visual moment
		// belongs at the end of the settings tour. Visible to every
		// user, not just admins; `padding="0"` so the dark stage
		// extends to the tabpanel edge without the wpd-panel's
		// default 16px frame.
		rows.push( {
			id: 'about',
			order: Number.MAX_SAFE_INTEGER,
			tab: html`<wpd-tab value="about">${ __( 'About' ) }</wpd-tab>`,
			panel: html`<wpd-tabpanel for="about">
				<wpd-panel padding="0">${ buildAboutSection() }</wpd-panel>
			</wpd-tabpanel>`,
		} );

		for ( const tab of externalTabs ) {
			const tabId = `ext-${ tab.id }`;
			const hostAttr = `wpd-settings-tab-host-${ tab.id }`;
			const tabRef = tab;
			rows.push( {
				id: tabId,
				order: tab.order ?? 100,
				tab: html`<wpd-tab value=${ tabId }>${ tab.label }</wpd-tab>`,
				panel: html`<wpd-tabpanel for=${ tabId }>
					<wpd-panel><div data-host=${ hostAttr }></div></wpd-panel>
				</wpd-tabpanel>`,
				mount: ( rootBody: HTMLElement ): void => {
					const host = rootBody.querySelector< HTMLElement >(
						`[data-host="${ hostAttr }"]`,
					);
					if ( ! host ) {
						return;
					}
					try {
						tabRef.render( host, {
							isAdmin,
							getOsSettings: () => this.getOsSettingsSnapshot(),
							subscribeOsSettings: ( cb ) =>
								this.subscribeOsSettings( cb ),
						} );
					} catch ( err ) {
						if ( typeof console !== 'undefined' ) {
							console.error(
								'[desktop-mode] settings tab render threw:',
								tabRef.id,
								err,
							);
						}
					}
				},
			} );
		}

		rows.sort( ( a, b ) => a.order - b.order );

		// Preserve the active tab across re-renders triggered by the
		// settings-tab registry (e.g. when a third-party plugin live-
		// registers a settings tab via the chromeless bridge and we
		// rebuild the strip in response). Without this, every
		// refreshMenu() snaps the user back to the Appearance tab
		// mid-action.
		//
		// `<wpd-tabs>` keeps the live selected value on the JS property,
		// not the attribute — `getAttribute('value')` would always
		// return the initial value, regardless of what the user picked.
		const previousTabs = body.querySelector( 'wpd-tabs' ) as
			| ( HTMLElement & { value?: string } )
			| null;
		const previousValue =
			this.activeTabId ??
			previousTabs?.value ??
			previousTabs?.getAttribute( 'value' ) ??
			'appearance';
		const activeRowExists = rows.some( ( r ) => r.id === previousValue );
		const initialTab = activeRowExists ? previousValue : 'appearance';

		render(
			html`
				<wpd-tabs value=${ initialTab } label=${ __( 'Settings sections' ) }>
					${ rows.map( ( r ) => r.tab ) }
				</wpd-tabs>
				${ rows.map( ( r ) => r.panel ) }
				<wpd-panel class="desktop-mode-os-settings__footer">
					<wpd-button variant="ghost" @click=${ onReset }
						>${ __( 'Reset to defaults' ) }</wpd-button
					>
				</wpd-panel>
			`,
			body,
		);
		// Save feedback lives on the OS Settings window's title-bar
		// activity dot — the always-on modem light next to the icon.
		// No section-level or footer indicator: one canonical
		// affordance per window, no duplication across the panel.

		// Mount external tab content after the tabpanels are in the
		// DOM so their hosts can be queried.
		for ( const row of rows ) {
			if ( row.mount ) {
				row.mount( body );
			}
		}

		// Track the active tab id so a registry-driven re-render can
		// land the user back on it. Bound on the freshly-rendered
		// `<wpd-tabs>` host — `lit` reuses the DOM node across
		// renders, but the listener idempotently overwrites
		// `activeTabId` so duplicates are harmless.
		const tabsHost = body.querySelector( 'wpd-tabs' );
		if ( tabsHost ) {
			tabsHost.addEventListener( 'wpd-tab-change', ( e: Event ) => {
				const detail = ( e as CustomEvent ).detail as { value?: string };
				if ( detail?.value ) {
					this.activeTabId = detail.value;
				}
			} );
		}
		this.activeTabId = initialTab;

		// Re-render when the registry changes so a plugin that loads
		// *after* the OS Settings window opens (via the server-sync
		// script injection) still gets its tab painted live.
		this.tabRegistryUnsubscribe = subscribeSettingsTabs( () => {
			// Guard against the window being closed between the
			// notification and the re-render: if body is detached,
			// silently drop the subscription.
			if ( ! body.isConnected ) {
				if ( this.tabRegistryUnsubscribe ) {
					this.tabRegistryUnsubscribe();
					this.tabRegistryUnsubscribe = null;
				}
				return;
			}
			this.renderPanel( body );
		} );
	}
}

/**
 * Capability → visibility gate. The shell today collapses capability
 * to a simple admin-or-everyone distinction: `manage_options` requires
 * admin; anything else (including empty) is visible to everyone.
 * Widening to real capability checks is a future expansion.
 */
function isTabVisible( tab: DesktopSettingsTab, isAdmin: boolean ): boolean {
	if ( tab.capability && tab.capability === 'manage_options' ) {
		return isAdmin;
	}
	return true;
}
