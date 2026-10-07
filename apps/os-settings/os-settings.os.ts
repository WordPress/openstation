import { mountPreferencesMio } from './parts/mio';
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
	mountRegistryTabs,
	navGroup,
	pageRows,
	type PageRow,
} from './parts/pages';
import { highlightSearchMatch, searchSettings } from './parts/search';
import { APP_ID, reset, settings, subscribe } from './parts/store';
import { uiOf, type AppData, type AppState, type Ctx, type UiState } from './parts/types';

const DEFAULT_TAB = 'appearance';

function glyph( ui: UiState, row: PageRow ): SVGSVGElement | unknown {
	if ( ! row.icon ) {
		return html`<span class="os-settings__nav-glyph-blank" aria-hidden="true"></span>`;
	}
	let node = ui.glyphs.get( row.id );
	if ( ! node ) {
		node = row.icon();
		ui.glyphs.set( row.id, node );
	}
	return node;
}

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
		searchSettings( ctx, ( e.target as HTMLInputElement ).value );
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
			${

       '' }
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

		registerCustomGradient( settings, renderGradientEditor );
		ui.previews = createWallpaperPreviewManager( ctx.root );

		void hydrateAll();

		void ensureWindowLinkVisuals().catch( () => undefined );

		const repaint = (): void => ctx.repaint();

		document.addEventListener( 'os-mode-changed', repaint );
		const offs = [
			() => document.removeEventListener( 'os-mode-changed', repaint ),
			mountPreferencesMio( ctx ),

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
		syncEditor( ctx );
		uiOf( ctx ).previews?.sync();
		syncLibrary( ctx );
		mountRegistryTabs( ctx, pageRows( ctx ) );
		afterComponentsRender( ctx );
		ensureAboutLoaded( ctx );
		syncShellMirrors( ctx );
		highlightSearchMatch( ctx );
	},
} );
