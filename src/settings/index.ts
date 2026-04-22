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
import { buildDockSizeSection } from './sections/dock-size';
import { buildExtendedSection } from './sections/extended';
import {
	buildWallpaperSection,
	registerCustomGradient,
	registerCustomImageIfPresent,
	teardownEditor,
} from './sections/wallpaper';

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
		// server-declared default id (via `wp_desktop_default_wallpaper`)
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
	}

	public save(): void {
		saveState( this.state );
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

		render(
			html`
				<p class="wp-desktop-os-settings__intro">
					${ __(
		'Personalize your desktop. Changes apply instantly and are saved to this browser.',
	) }
				</p>
				<wpd-tabs value="appearance" label=${ __( 'Settings sections' ) }>
					<wpd-tab value="appearance"
						>${ __( 'Appearance' ) }</wpd-tab
					>
					<wpd-tab value="ai">${ __( 'AI Settings' ) }</wpd-tab>
					${ this.config.isAdmin
		? html`<wpd-tab value="extended">${ __( 'Extended Options' ) }</wpd-tab>`
		: html`` }
				</wpd-tabs>
				<wpd-tabpanel for="appearance">
					${ buildWallpaperSection( this, body ) }
					${ buildAccentSection( this ) }
					${ buildDockSizeSection( this ) }
				</wpd-tabpanel>
				<wpd-tabpanel for="ai">
					${ buildAiSection( this ) }
				</wpd-tabpanel>
				${ this.config.isAdmin
		? html`<wpd-tabpanel for="extended">
							${ buildExtendedSection( this ) }
						</wpd-tabpanel>`
		: html`` }
				<div class="wp-desktop-os-settings__footer">
					<wpd-button variant="ghost" @click=${ onReset }
						>${ __( 'Reset to defaults' ) }</wpd-button
					>
				</div>
			`,
			body,
		);
	}
}
