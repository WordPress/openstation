/**
 * OpenStation Preferences — the client view of the Preferences app.
 *
 * The 1:1 rebuild of the legacy panel bundle, which it replaced
 * whole: the same sidebar, search, pages, sections, wallpaper editor
 * island, image picker, theme grid, component reference and journal.
 * What the framework absorbed: the lazy-bundle loader and its retry
 * affordance (the app's script is a window companion), the per-section
 * `paint()` closures and registry-subscription teardown observers
 * (the view is a function of the settings; `mounted()` subscribes
 * once and returns one teardown), the REST clients and their nonce
 * plumbing (`ctx.fetch`), the confirm dialogs (`os-confirm`), and the
 * save-failure re-render (the store notifies, the app repaints).
 *
 * The settings themselves are NOT app state. They are the shell's,
 * applied before the first paint and written by more than this
 * window, so the app edits them through the same public API a
 * third-party tab uses — `wp.os.getOsSettings()` in, `updateOsSettings()`
 * out, `subscribeOsSettings()` to repaint (see `parts/store.ts`). The
 * declared state is the page; everything else the window remembers
 * between paints is client-only, in `ctx.ui()`.
 *
 * @public
 */

import { __, defineApp, html } from '@openstation/app';
import * as wallpapers from '../../src/wallpapers/registry';
import { hydrateAll } from '../../src/wallpapers/lazy';
import { subscribeDockRailRenderers } from '../../src/dock-rail';
import { subscribeUnfocusEffects } from '../../src/effects/registry';
import { subscribeWindowReveals } from '../../src/reveals/registry';
import { subscribeWindowLinkRenderers } from '../../src/window-links/renderer-registry';
import { ensureWindowLinkVisuals } from '../../src/window-links/ensure-visuals';
import { subscribeDesktopThemes } from '../../src/desktop-themes/registry';
import { subscribeSettingsTabs } from '../../src/settings/registry';
import { registerCustomGradient } from '../../src/settings/wallpaper-defs';
import { osIcon } from '../../src/ui/icons';
import { createWallpaperPreviewManager } from '../../src/wallpapers/preview-manager';
import { renderGradientEditor, syncEditor, teardownEditor } from './parts/wallpaper';
import { syncLibrary } from './parts/custom-image';
import { syncShellMirrors } from './parts/features';
import { afterComponentsRender } from './parts/components';
import { ensureAboutLoaded } from './parts/about';
import {
	buildSearchIndex,
	mountRegistryTabs,
	navGroup,
	pageRows,
	type PageRow,
} from './parts/pages';
import { APP_ID, reset, settings, subscribe } from './parts/store';
import { uiOf, type AppData, type AppState, type Ctx, type UiState } from './parts/types';

/** The default page, and where an unknown deep link lands. */
const DEFAULT_TAB = 'appearance';

/** A row's sidebar glyph — one node per row, made once. */
function glyph( ui: UiState, row: PageRow ): SVGSVGElement | unknown {
	if ( ! row.icon ) {
		// Third-party tabs have no glyph to render: the registry has
		// no icon field. The spacer keeps their label on the same
		// line as every other label.
		return html`<span class="os-settings__nav-glyph-blank" aria-hidden="true"></span>`;
	}
	let node = ui.glyphs.get( row.id );
	if ( ! node ) {
		node = row.icon();
		ui.glyphs.set( row.id, node );
	}
	return node;
}

/**
 * The search field, the strip and the panes are SIBLINGS, and that is
 * a hard constraint rather than a layout preference: `<os-tabs>` finds
 * the panes it drives by looking for `os-tabpanel` children of its
 * own parent, so wrapping the strip in a sidebar div puts every pane
 * out of its reach. The column is assembled by the grid in
 * `os-settings.css` instead.
 */
function frame( ctx: Ctx ) {
	const s = settings();
	const ui = uiOf( ctx );
	const rows = pageRows( ctx );
	const active = rows.some( ( r ) => r.id === ctx.state.tab ) ? ctx.state.tab : DEFAULT_TAB;
	const { query, index } = ui.search;
	const matches = ( row: PageRow ): boolean =>
		query === '' || ( index?.get( row.id ) ?? '' ).includes( query );
	let visible = 0;
	const onSearch = ( e: Event ): void => {
		// Built on first use, not at render: the panes have to be in
		// the DOM, and most sessions never type in this field at all.
		ui.search.index ??= buildSearchIndex( ctx.root, rows );
		ui.search.query = ( e.target as HTMLInputElement ).value.trim().toLowerCase();
		ctx.repaint();
	};
	return html`
		<div class="os-settings">
			<div class="os-settings__search">
				<label class="os-settings__search-field">
					${ glyph( ui, { id: '__search', order: 0, label: '', icon: () => osIcon( 'search', { size: null } ), panel: () => html`` } ) }
					<input
						type="search"
						class="os-settings__search-input"
						placeholder=${ __( 'Search settings' ) }
						aria-label=${ __( 'Search settings' ) }
						aria-controls="os-settings-nav"
						@input=${ onSearch }
					/>
				</label>
			</div>
			<os-tabs
				id="os-settings-nav"
				orientation="vertical"
				value=${ active }
				label=${ __( 'Settings sections' ) }
				os-bind="tab"
			>
				${ rows.map( ( r, i ) => {
					// The first row of a band opens a new group. Compared
					// against the PREVIOUS row rather than counted, so a
					// band with nothing in it leaves no orphan gap behind.
					const startsGroup = i > 0 && navGroup( r.order ) !== navGroup( rows[ i - 1 ].order );
					const hit = matches( r );
					if ( hit ) {
						visible++;
					}
					return html`<os-tab
						value=${ r.id }
						data-group-start=${ startsGroup ? 'true' : null }
						data-search-hidden=${ hit ? null : 'true' }
					>${ glyph( ui, r ) }${ r.label }</os-tab>`;
				} ) }
			</os-tabs>
			<p class="os-settings__search-empty" ?hidden=${ query === '' || visible > 0 }>
				${ __( 'No settings match that.' ) }
			</p>
			${ /*
			 * The same pages as a picker, for a container too narrow for
			 * a column of them (a phone). Only one of the two is ever
			 * shown — `os-settings.css` swaps them at the width — and both
			 * write the same state, so the strip above still drives the
			 * panes after a pick here.
			 */ '' }
			<os-select
				class="os-settings__page-select"
				label=${ __( 'Settings section' ) }
				value=${ active }
				os-bind="tab"
			>
				${ rows.map( ( r ) => html`<os-option value=${ r.id }>${ r.label }</os-option>` ) }
			</os-select>
			<os-panel class="os-settings__footer">
				<os-button variant="ghost" @click=${ reset }>${ __( 'Reset to defaults' ) }</os-button>
			</os-panel>
			${ rows.map(
				( r ) => html`<os-tabpanel for=${ r.id }>
					<os-panel padding=${ r.padding ?? null }>${ r.panel( s, ctx ) }</os-panel>
				</os-tabpanel>`,
			) }
		</div>
	`;
}

export default defineApp< AppState, AppData >( APP_ID, {
	local: {
		// `wp.os.openOsSettings( { tabId } )` on an already-open window:
		// the shell tells the session which page to show.
		tab: ( state, args ) => {
			const value = String( args.value ?? '' );
			if ( value !== '' ) {
				state.tab = value;
			}
		},
	},

	view: frame,

	mounted: ( ctx ) => {
		const ui = uiOf( ctx );
		// Splice the inline editor onto the custom gradient's def. The
		// shell registered it without one so the colour and range
		// fields never reach the boot bundle; "late registrations win".
		registerCustomGradient( settings, renderGradientEditor );
		ui.previews = createWallpaperPreviewManager( ctx.root );
		// Pull in the bundles for every wallpaper still registered as a
		// metadata-only stub: live tile previews, the inline editor and
		// the settings dialog all live on the real def. Not awaited —
		// each def that lands wakes the registry subscription below.
		void hydrateAll();
		// The built-in window-link renderer registers as a side effect
		// of the visuals bundle, which the shell only fetches once two
		// windows relate; until then the Windows page's dropdown would
		// show a blank for the value actually in force.
		void ensureWindowLinkVisuals().catch( () => undefined );

		const repaint = (): void => ctx.repaint();
		const offs = [
			// Any settings change, whoever made it — this window, the
			// right-click menu, `wp.os.updateOsSettings()`, the rollback
			// after a failed save.
			subscribe( repaint ),
			wallpapers.subscribe( repaint ),
			subscribeDockRailRenderers( repaint ),
			subscribeUnfocusEffects( repaint ),
			subscribeWindowReveals( repaint ),
			subscribeWindowLinkRenderers( repaint ),
			subscribeDesktopThemes( repaint ),
			subscribeSettingsTabs( repaint ),
		];
		return () => {
			for ( const off of offs ) {
				off();
			}
			teardownEditor( ctx );
			ui.previews?.dispose();
			ui.previews = null;
		};
	},

	updated: ( ctx ) => {
		// The islands the renderer does not paint: the selected
		// wallpaper's editor, the live tile previews, the media library
		// on first sight, the registry tabs, the component example, the
		// journal on first sight, and the page config's AI mirrors.
		syncEditor( ctx );
		uiOf( ctx ).previews?.sync();
		syncLibrary( ctx );
		mountRegistryTabs( ctx, pageRows( ctx ) );
		afterComponentsRender( ctx );
		ensureAboutLoaded( ctx );
		syncShellMirrors( ctx );
	},
} );
