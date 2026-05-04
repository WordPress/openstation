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
 * public `wp.desktop.registerWallpaper()` / `wp-desktop.wallpapers`
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
// Side-effect import — registers every <wpd-*> tag with the
// customElements registry so the sections below can just create the
// tags in JS and trust they'll upgrade on connection.
import '../ui/components';
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
import { loadState, saveState } from './state';
import type {
	OsSettingsConfig,
	OsSettingsState,
	SettingsCtx,
} from './types';
import { buildAccentSection } from './sections/accent';
import { buildAiSection } from './sections/ai';
import { buildDesktopLayoutSection } from './sections/desktop-layout';
import { buildDockSizeSection } from './sections/dock-size';
import { buildExtendedSection } from './sections/extended';
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
			ai: { ...this.state.ai },
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

	constructor( config: OsSettingsConfig, layer: WallpaperLayer ) {
		this.config = config;
		this.layer = layer;
		this.state = loadState();

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
		const shell = document.getElementById( 'wp-desktop-shell' );
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
		// siblings of #wp-desktop-shell — specifically the WordPress
		// admin bar, which needs --wp-desktop-dock-width to size its
		// leftmost (W-logo) slot in visual alignment with the dock
		// below it. Shell-scoped variables cascade to shell children
		// only; :root-scoped variables cascade everywhere.
		const root = document.documentElement;
		root.style.setProperty( '--wp-admin-theme-color', accent.value );
		root.style.setProperty( '--wp-desktop-dock-width', `${ dockSize.width }px` );
		root.style.setProperty( '--wp-desktop-dock-icon-size', `${ dockSize.icon }px` );

		// Desktop layout is driven by an attribute on the shell root;
		// the layout dispatcher (desktop.ts) reads it on init and on
		// every settings change to rebuild the dock(s) and (in spatial
		// mode) the synthesized desktop icons. Written here so every
		// apply() is the single source of truth — no matter how the
		// state got to this point (init from localStorage, picker
		// change, reset).
		shell.setAttribute(
			'data-wp-desktop-layout',
			this.state.desktopLayout,
		);
	}

	public save(): void {
		saveState( this.state );
		if ( this.osSettingsListeners.size > 0 ) {
			const snapshot = this.getOsSettingsSnapshot();
			const listeners = Array.from( this.osSettingsListeners );
			for ( const cb of listeners ) {
				try {
					cb( snapshot );
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[wp-desktop-mode] os-settings listener threw:',
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

		body.classList.add( 'wp-desktop-os-settings' );

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
						<p class="wp-desktop-os-settings__intro">
							${ __(
								'Personalize your desktop. Changes apply instantly and are saved to this browser.',
							) }
						</p>
						${ buildWallpaperSection( this, body ) }
						${ buildAccentSection( this ) }
						${ buildDesktopLayoutSection( this ) }
						${ buildDockSizeSection( this ) }
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
								'[wp-desktop-mode] settings tab render threw:',
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
				<wpd-panel class="wp-desktop-os-settings__footer">
					<wpd-button variant="ghost" @click=${ onReset }
						>${ __( 'Reset to defaults' ) }</wpd-button
					>
				</wpd-panel>
			`,
			body,
		);

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
