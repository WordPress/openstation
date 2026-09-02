/**
 * Navigation — where every registered thing shows up.
 *
 * One `<os-section>` per kind — a heading, a sentence, and a bounded
 * surface, the panel's separator system everywhere else — holding one
 * row per {@link NavItem} with a four-way pick: on a rail, on the
 * desktop, on both, or nowhere. The rail option names the rail the
 * item would actually land on — "Dock" for everything, "Sidebar" for
 * a WordPress admin menu while the split layout is on — so the label
 * never describes a surface the item is not on.
 *
 * The list is the same {@link NavItem} list the rails paint from, so
 * a row cannot claim a default the dock disagrees with. Because the
 * app repaints on every settings change, a row never shows a stale
 * placement while an EXTERNAL writer (the right-click menu) moves an
 * item either.
 */

import { __, html } from '@openstation/app';
import { renderIcon } from '../../../src/icon';
import { slotForTileId } from '../../../src/desktop-themes/slots';
import {
	railFor,
	resolvePlacement,
	sortByOrder,
	type NavItem,
	type NavKind,
	type NavLayout,
	type NavPlacement,
} from '../../../src/nav';
import type { OsSettingsState } from '../../../src/settings/types';
import { update } from './store';
import { pickedValue, type Section } from './types';

/**
 * The groups, in the order they are listed. The two menu kinds are
 * one group because they are one dock zone: a plugin's admin menu and
 * a plugin's app launcher sit side by side on the rail.
 */
const GROUPS: ReadonlyArray< {
	kinds: readonly NavKind[];
	heading: () => string;
	description: () => string;
} > = [
	{
		kinds: [ 'core' ],
		heading: () => __( 'WordPress Core' ),
		description: () => __( 'The admin menus WordPress itself registers.' ),
	},
	{
		kinds: [ 'plugin', 'app' ],
		heading: () => __( 'Plugins & Apps' ),
		description: () => __( 'Menus from installed plugins and apps.' ),
	},
	{
		kinds: [ 'control' ],
		heading: () => __( 'OpenStation' ),
		description: () => __( 'The OpenStation’s own controls.' ),
	},
];

/**
 * Read the live nav items. Falls back to an empty list rather than
 * rebuilding them from the boot payload: a half-built list here would
 * offer rows whose defaults disagree with the rails.
 */
function readNavItems(): NavItem[] {
	const api = ( window as unknown as {
		wp?: { os?: { getNavItems?: () => NavItem[] } };
	} ).wp?.os;
	return typeof api?.getNavItems === 'function' ? api.getNavItems() : [];
}

/**
 * Whether an item gets a row. Admin menus and registered icons always
 * do. A system tile has to opt in: most of them are load-bearing, and
 * the ones that are not say so with `placeable`. Two never appear —
 * Exit, which is the way out of the shell, and a transient tile,
 * which has no launcher to place.
 */
function isListed( item: NavItem ): boolean {
	if ( item.locked || item.transient ) {
		return false;
	}
	if ( item.menu || item.entry ) {
		return true;
	}
	return item.tile?.placeable === true;
}

/**
 * The page's opening sentence names the rails the user is actually
 * looking at, so it follows the layout.
 */
const leadFor = ( layout: NavLayout ): string =>
	'classic' === layout
		? __(
			'Choose where each menu shows up: on the dock/sidebar, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
		)
		: __(
			'Choose where each menu shows up: on the dock, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
		);

/** The four options for one row; only the rail label varies. */
const optionsFor = ( kind: NavKind, layout: NavLayout ): Array< { id: NavPlacement; label: string } > => [
	{
		id: 'rail',
		label: 'sidebar' === railFor( kind, layout ) ? __( 'In the sidebar' ) : __( 'On the dock' ),
	},
	{ id: 'desktop', label: __( 'On the desktop' ) },
	{ id: 'both', label: __( 'On both' ) },
	{ id: 'hidden', label: __( 'Hidden' ) },
];

const row = ( item: NavItem, s: OsSettingsState ) => html`<div class="os-nav-settings__row" data-item-id=${ item.id }>
	<div class="os-nav-settings__identity">
		${ renderIcon( item.icon, {
			title: item.title,
			className: 'os-nav-settings__icon',
			// Preview the themed icon so this list matches the rail.
			slot: slotForTileId( item.id ),
		} ) }
		<div class="os-nav-settings__title">${ item.title }</div>
	</div>
	<os-select
		plain
		label=${ item.title }
		value=${ resolvePlacement( item, s.navPlacement ) }
		@os-pick=${ ( e: Event ) => {
			const next = pickedValue( e );
			if ( next === 'both' || next === 'rail' || next === 'desktop' || next === 'hidden' ) {
				update( { navPlacement: { ...s.navPlacement, [ item.id ]: next } } );
			}
		} }
	>
		${ optionsFor( item.kind, s.desktopLayout ).map(
			( o ) => html`<os-option value=${ o.id }>${ o.label }</os-option>`,
		) }
	</os-select>
</div>`;

export const renderNavigation: Section = ( s ) => {
	const items = readNavItems().filter( isListed );
	// The rail's own baseline order, not alphabetical: for the two
	// menu groups that IS the admin menu's order (Dashboard, Posts,
	// Media, Pages, …), the order the user already knows these menus
	// in; for the controls it is the sequence they sit in on the dock.
	const groups = GROUPS.map( ( group ) => ( {
		...group,
		rows: sortByOrder( items.filter( ( item ) => group.kinds.includes( item.kind ) ) ),
	} ) ).filter( ( group ) => group.rows.length > 0 );
	return html`
		<p class="os-settings__page-description os-nav-settings__lead">${ leadFor( s.desktopLayout ) }</p>
		${ groups.length === 0
			? html`<os-empty-state
				heading=${ __( 'Nothing registered yet' ) }
				description=${ __( 'Plugins and the admin menu will appear here once they’re registered.' ) }
			></os-empty-state>`
			: groups.map(
				( group ) => html`
					<os-section class="os-nav-settings" heading=${ group.heading() } description=${ group.description() }>
						${ group.rows.map( ( item ) => row( item, s ) ) }
					</os-section>
				`,
			) }
	`;
};
