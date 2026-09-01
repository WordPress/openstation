/**
 * The pages — the built-in ones in the order the sidebar lists them,
 * interleaved by `order` with every tab a plugin registered through
 * `wp.os.registerSettingsTab()`.
 */

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
import { renderComponents } from './components';
import { renderAboutPage } from './about';
import { NAV_ICONS } from './nav-icons';
import { settings, subscribe } from './store';
import { uiOf, type Ctx } from './types';

export interface PageRow {
	id: string;
	order: number;
	label: string;
	/** The sidebar glyph, when the page has one. */
	icon?: () => SVGSVGElement;
	panel: ( s: OsSettingsState, ctx: Ctx ) => TemplateResult;
	/** `<os-panel padding>` override — About owns its own spacing. */
	padding?: string;
	/** A registry tab; its body is mounted imperatively into the host. */
	tab?: DesktopSettingsTab;
}

/** The host element a registry tab paints into. */
export const tabHostAttr = ( id: string ): string => `os-settings-tab-host-${ id }`;

/**
 * The heading a page opens with, and the sentence under it.
 *
 * The sidebar names the page in 14px Regular, which is enough to pick
 * it and not enough to arrive at it. This is the same word again at
 * the size of a title, plus the one line that says what the page is
 * FOR, which is the thing the nav has no room to say. Rendered by the
 * frame rather than by each section so the pages cannot drift apart.
 */
export function pageHeader( title: string, description = '' ): TemplateResult {
	return html`
		<header class="os-settings__page-header">
			<h2 class="os-settings__page-title">${ title }</h2>
			${ description ? html`<p class="os-settings__page-description">${ description }</p>` : '' }
		</header>
	`;
}

/**
 * Capability → visibility gate. The shell collapses capability to a
 * simple admin-or-everyone distinction: `manage_options` requires
 * admin; anything else (including empty) is visible to everyone.
 */
function isTabVisible( tab: DesktopSettingsTab, isAdmin: boolean ): boolean {
	return tab.capability === 'manage_options' ? isAdmin : true;
}

/**
 * Which band of the sidebar a page belongs to.
 *
 * The nav is three groups separated by a gap and nothing else. The
 * band is derived from `order` rather than declared per row, and that
 * is what makes the grouping survive third-party tabs: the registry
 * has no group field, but a plugin that registers at 15 already means
 * "next to Appearance and Themes". Tabs that take the registry default
 * (100) land in the last group.
 *
 * 1. The desktop itself: Appearance, Themes, Windows.
 * 2. What is running on it: Navigation, Features.
 * 3. The system: Components, About, and anything unplaced.
 */
export function navGroup( order: number ): number {
	if ( order < 20 ) {
		return 1;
	}
	return order < 40 ? 2 : 3;
}

/** The built-in pages plus the registry's, sorted by `order`. */
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
			// Between Appearance and the rest: a desktop theme is a
			// coarser version of what Appearance does, so it reads as
			// the next step, not a separate concern.
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
			// No description: the page's opening sentence names the
			// rails the user is actually looking at, which the split
			// layout changes, so the section owns it.
			id: 'navigation',
			order: 22,
			label: __( 'Navigation' ),
			icon: NAV_ICONS.navigation,
			panel: ( s, c ) => html`${ pageHeader( __( 'Navigation' ) ) }${ renderNavigation( s, c ) }`,
		},
		{
			id: 'features',
			order: 30,
			label: __( 'Features' ),
			icon: NAV_ICONS.features,
			panel: ( s, c ) => html`${ pageHeader(
				__( 'Features' ),
				__( 'The assistant, the developer tools, and the betas. Every switch here affects only your account and takes effect immediately.' ),
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
	// About — pinned to the very end with a sentinel order so it stays
	// last regardless of third-party tabs (which default to 100).
	// Visible to every user; `padding="0"` lets the editorial surface
	// own its spacing without inheriting the generic panel frame.
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
			// The registry has no icon field, but the shell may know its
			// OWN registry-delivered tabs by raw id (File Associations).
			icon: NAV_ICONS[ tab.id ],
			tab,
			panel: () => html`<div data-host=${ tabHostAttr( tab.id ) }></div>`,
		} );
	}
	rows.sort( ( a, b ) => a.order - b.order );
	return rows;
}

/**
 * Paint every registry tab whose host is on screen and not yet
 * painted with THIS registration. The host survives repaints (the
 * renderer diffs in place), so a tab renders once per registration —
 * and again after a re-register, or after a reshaped page remounted
 * its host. Called after every paint.
 */
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
			// eslint-disable-next-line no-console
			console.error( '[openstation] settings tab render threw:', tab.id, err );
		}
	}
}

/**
 * Attributes across the `<os-*>` kit that carry text a person reads.
 * A component renders them inside its own shadow root, so none of
 * them is light-DOM text no matter how prominent it looks on screen —
 * and every section title in the panel is one of them.
 */
const TEXT_ATTRIBUTES = [ 'heading', 'description', 'label', 'placeholder' ] as const;

/**
 * What each page can be found by: built from the rendered panes
 * rather than a hand-kept keyword list, so typing "corners" finds
 * Windows, "galaxy" finds Appearance, "beta" finds Features — none of
 * which is a page name. Every pane is in the DOM from the first paint
 * (toggled with `hidden`, not mounted on demand), so their text is
 * readable without showing anything. Built on first use: most
 * sessions never type in the field.
 */
export function buildSearchIndex( root: HTMLElement, rows: PageRow[] ): Map< string, string > {
	const index = new Map< string, string >();
	for ( const row of rows ) {
		const pane = root.querySelector( `os-tabpanel[for="${ row.id }"]` );
		const parts: string[] = [ row.label, pane?.textContent ?? '' ];
		for ( const el of Array.from( pane?.querySelectorAll( '[heading],[description],[label],[placeholder]' ) ?? [] ) ) {
			for ( const attr of TEXT_ATTRIBUTES ) {
				parts.push( el.getAttribute( attr ) ?? '' );
			}
		}
		index.set( row.id, parts.join( ' ' ).replace( /\s+/g, ' ' ).toLowerCase() );
	}
	return index;
}
