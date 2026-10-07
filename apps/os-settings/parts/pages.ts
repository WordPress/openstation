import { __, html, type TemplateResult } from '@openstation/app';
import {
	listSettingsTabs,
	type DesktopSettingsTab,
} from '../../../src/settings/registry';
import type { OsSettingsState } from '../../../src/settings/types';
import { renderAppearance } from './appearance';
import { wallpaperSection } from './wallpaper';
import { renderWindows } from './windows';
import { renderFeatures } from './features';
import { renderThemes } from './themes';
import { renderNavigation } from './navigation';
import { renderMobile } from './mobile';
import { renderComponents } from './components';
import { renderAboutPage } from './about';
import { NAV_ICONS, registryNavIcon } from './nav-icons';
import { settings, subscribe } from './store';
import { uiOf, type Ctx } from './types';

export interface PageRow {
	id: string;
	order: number;
	label: string;

	icon?: () => SVGSVGElement;
	panel: ( s: OsSettingsState, ctx: Ctx ) => TemplateResult;

	padding?: string;

	tab?: DesktopSettingsTab;
}

export const tabHostAttr = ( id: string ): string => `os-settings-tab-host-${ id }`;

export function pageHeader( title: string, description = '' ): TemplateResult {
	return html`
		<header class="os-settings__page-header">
			<h2 class="os-settings__page-title">${ title }</h2>
			${ description ? html`<p class="os-settings__page-description">${ description }</p>` : '' }
		</header>
	`;
}

function isTabVisible( tab: DesktopSettingsTab, isAdmin: boolean ): boolean {
	return tab.capability === 'manage_options' ? isAdmin : true;
}

export function navGroup( order: number ): number {
	if ( order < 20 ) {
		return 1;
	}
	return order < 40 ? 2 : 3;
}

export function pageRows( ctx: Ctx ): PageRow[] {
	const isAdmin = ctx.data.isAdmin;
	const rows: PageRow[] = [
		{
			id: 'appearance',
			order: 10,
			label: __( 'Appearance' ),
			icon: NAV_ICONS.appearance,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Appearance' ),
				__( 'Personalize your desktop. Changes apply instantly and are saved to this browser.' ),
			) }${ renderAppearance( s, wallpaperSection( s, c ), c ) }`,
		},
		{

			id: 'themes',
			order: 12,
			label: __( 'Themes' ),
			icon: NAV_ICONS.themes,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Themes' ),
				__( 'A desktop theme repaints every token at once. A coarser version of what Appearance does one control at a time.' ),
			) }${ renderThemes( s, c ) }`,
		},
		{
			id: 'windows',
			order: 18,
			label: __( 'Windows' ),
			icon: NAV_ICONS.windows,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Windows' ),
				__( 'How windows look, how they arrive, and how they behave when they are not the one you are using.' ),
			) }${ renderWindows( s, c ) }`,
		},
		{

			id: 'navigation',
			order: 22,
			label: __( 'Navigation' ),
			icon: NAV_ICONS.navigation,
			panel: ( s, c ) => html`${ pageHeader( __( 'Navigation' ) ) }${ renderNavigation( s, c ) }`,
		},
		{

			id: 'mobile',
			order: 24,
			label: __( 'Mobile' ),
			icon: NAV_ICONS.mobile,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Mobile' ),
				__( 'On a phone the desktop becomes a home screen, one full-screen app at a time, and a tab bar. Choose when that happens and what the bar holds.' ),
			) }${ renderMobile( s, c ) }`,
		},
		{
			id: 'features',
			order: 30,
			label: __( 'Features' ),
			icon: NAV_ICONS.features,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Features' ),
				__( 'The assistant, developer tools, and beta features for your account, plus site-wide Extended options for administrators.' ),
			) }${ renderFeatures( s, c ) }`,
		},
	];
	if ( isAdmin ) {
		rows.push( {
			id: 'help',
			order: 40,
			label: __( 'Components' ),
			icon: NAV_ICONS.help,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Components' ),
				__( 'Every <os-*> web component shipped by this plugin, with its props, slots, and a live example.' ),
			) }${ renderComponents( s, c ) }`,
		} );
	}

	rows.push( {
		id: 'about',
		order: Number.MAX_SAFE_INTEGER,
		label: __( 'About' ),
		icon: NAV_ICONS.about,
		padding: '0',
		panel: renderAboutPage,
	} );
	for ( const tab of listSettingsTabs() ) {
		if ( ! isTabVisible( tab, isAdmin ) ) {
			continue;
		}
		rows.push( {
			id: `ext-${ tab.id }`,
			order: tab.order ?? 100,
			label: tab.label,
			icon: registryNavIcon( tab.id, tab.icon ),
			tab,
			panel: () => html`<div data-host=${ tabHostAttr( tab.id ) }></div>`,
		} );
	}
	rows.sort( ( a, b ) => a.order - b.order );
	return rows;
}

export function mountRegistryTabs( ctx: Ctx, rows: PageRow[] ): void {
	const ui = uiOf( ctx );
	for ( const row of rows ) {
		const tab = row.tab;
		if ( ! tab ) {
			continue;
		}
		const host = ctx.root.querySelector< HTMLElement >( `[data-host="${ tabHostAttr( tab.id ) }"]` );
		if ( ! host || ui.mountedTabs.get( host ) === tab ) {
			continue;
		}
		ui.mountedTabs.set( host, tab );
		try {
			tab.render( host, {
				isAdmin: ctx.data.isAdmin,
				getOsSettings: settings,
				subscribeOsSettings: subscribe,
			} );
		} catch ( err ) {
			console.error( '[openstation] settings tab render threw:', tab.id, err );
		}
	}
}

const TEXT_ATTRIBUTES = [ 'heading', 'description', 'label', 'aria-label', 'placeholder' ] as const;

export function buildSearchIndex( root: HTMLElement, rows: PageRow[] ): Map< string, string > {
	const index = new Map< string, string >();
	for ( const row of rows ) {
		const pane = root.querySelector( `os-tabpanel[for="${ row.id }"]` );
		const parts: string[] = [ row.label, pane?.textContent ?? '' ];
		for ( const el of Array.from( pane?.querySelectorAll( '[heading],[description],[label],[aria-label],[placeholder]' ) ?? [] ) ) {
			for ( const attr of TEXT_ATTRIBUTES ) {
				parts.push( el.getAttribute( attr ) ?? '' );
			}
		}
		index.set( row.id, parts.join( ' ' ).replace( /\s+/g, ' ' ).toLowerCase() );
	}
	return index;
}
