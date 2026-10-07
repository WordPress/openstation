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

function readNavItems(): NavItem[] {
	const api = ( window as unknown as {
		wp?: { os?: { getNavItems?: () => NavItem[] } };
	} ).wp?.os;
	return typeof api?.getNavItems === 'function' ? api.getNavItems() : [];
}

function isListed( item: NavItem ): boolean {
	if ( item.locked || item.transient ) {
		return false;
	}
	if ( item.menu || item.entry ) {
		return true;
	}
	return item.tile?.placeable === true;
}

const leadFor = ( layout: NavLayout ): string =>
	'classic' === layout
		? __(
			'Choose where each menu shows up: on the dock/sidebar, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
		)
		: __(
			'Choose where each menu shows up: on the dock, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
		);

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
