/**
 * Navigation section — where every registered thing shows up.
 *
 * One `<os-section>` per kind — a heading, a sentence, and a bounded
 * surface, the panel's separator system everywhere else — holding one
 * row per {@link NavItem} with a four-way pick: on a rail, on the
 * desktop, on both, or nowhere. The rail option names the rail the
 * item would actually land on — "Dock" for everything, "Sidebar" for a
 * WordPress admin menu while the split layout is on — so the label
 * never describes a surface the item is not on.
 *
 * The list is the same {@link NavItem} list the rails paint from, so
 * a row cannot claim a default the dock disagrees with.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { renderIcon } from '../../icon';
import { slotForTileId } from '../../desktop-themes/slots';
import type { SettingsCtx } from '../types';
import type { OsSettingsSnapshot } from '../registry';
import {
	railFor,
	resolvePlacement,
	sortByOrder,
	type NavItem,
	type NavKind,
	type NavLayout,
	type NavPlacement,
} from '../../nav';

/**
 * The groups, in the order they are listed. One `<os-section>` each:
 * a heading, a sentence, and a bounded surface, which is the panel's
 * separator system everywhere else.
 */
const GROUPS: ReadonlyArray< {
	kinds: readonly NavKind[];
	heading: string;
	description: string;
} > = [
	{
		kinds: [ 'core' ],
		heading: __( 'WordPress Core' ),
		description: __( 'The admin menus WordPress itself registers.' ),
	},
	// One group, because they are one dock zone: a plugin's admin menu
	// and a plugin's app launcher sit side by side on the rail, and a
	// user reading this list has no reason to care which of the two
	// registration paths put a thing there.
	{
		kinds: [ 'plugin', 'app' ],
		heading: __( 'Plugins & Apps' ),
		description: __( 'Menus from installed plugins and apps.' ),
	},
	{
		kinds: [ 'control' ],
		heading: __( 'OpenStation' ),
		description: __( 'The OpenStation’s own controls.' ),
	},
];

/**
 * Read the live nav items. Falls back to an empty list rather than
 * rebuilding them from the boot payload: a half-built list here would
 * offer rows whose defaults disagree with the rails, which is the
 * failure this whole model exists to remove.
 */
function readNavItems(): NavItem[] {
	const api = ( window as unknown as {
		wp?: { os?: { getNavItems?: () => NavItem[] } };
	} ).wp?.os;
	return typeof api?.getNavItems === 'function' ? api.getNavItems() : [];
}

/**
 * Whether an item gets a row.
 *
 * Admin menus and registered icons always do. A system tile has to opt
 * in: most of them are load-bearing, and the ones that are not say so
 * with `placeable`. Two never appear — Exit, which is the way out of
 * the shell, and a transient tile, which has no launcher to place.
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

export function buildNavigationSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const setPlacement = ( id: string, placement: NavPlacement ): void => {
		ctx.state.navPlacement = {
			...ctx.state.navPlacement,
			[ id ]: placement,
		};
		ctx.save();
		paint();
	};

	const onPlacementChange =
		( id: string ) =>
			( e: Event ): void => {
				const detail = ( e as CustomEvent ).detail as {
					value?: string;
				};
				const next = detail?.value;
				if (
					next === 'both' ||
					next === 'rail' ||
					next === 'desktop' ||
					next === 'hidden'
				) {
					setPlacement( id, next );
				}
			};

	/**
	 * The page's opening sentence.
	 *
	 * It names the rails the user is actually looking at, so it has to
	 * follow the layout — and it lives in the section rather than in
	 * the page header because this is the node that repaints when the
	 * layout changes in the Appearance tab next door.
	 */
	const leadFor = ( layout: NavLayout ): string =>
		'classic' === layout
			? __(
				'Choose where each menu shows up: on the dock/sidebar, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
			)
			: __(
				'Choose where each menu shows up: on the dock, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly.',
			);

	/**
	 * The four options for one row. Only the first label varies:
	 * the rail a WordPress menu would land on is the sidebar while the
	 * split layout is on.
	 */
	const optionsFor = (
		kind: NavKind,
		layout: NavLayout,
	): Array< { id: NavPlacement; label: string } > => {
		const rail =
			'sidebar' === railFor( kind, layout )
				? __( 'In the sidebar' )
				: __( 'On the dock' );
		return [
			{ id: 'rail', label: rail },
			{ id: 'desktop', label: __( 'On the desktop' ) },
			{ id: 'both', label: __( 'On both' ) },
			{ id: 'hidden', label: __( 'Hidden' ) },
		];
	};

	const paint = (
		placement: Record< string, NavPlacement > = ctx.state.navPlacement,
		layout: NavLayout = ctx.state.desktopLayout,
	): void => {
		const items = readNavItems().filter( isListed );
		// The rail's own baseline order, not alphabetical. For the two
		// menu groups that IS the admin menu's order (Dashboard, Posts,
		// Media, Pages, …), the order the user already knows these
		// menus in; for the controls it is the sequence they sit in on
		// the dock. Sorting by title would put Appearance above
		// Dashboard and teach nothing.
		const groups = GROUPS.map( ( group ) => ( {
			...group,
			rows: sortByOrder(
				items.filter( ( item ) =>
					group.kinds.includes( item.kind ),
				),
			),
		} ) ).filter( ( group ) => group.rows.length > 0 );

		render(
			html`
				<p class="os-settings__page-description os-nav-settings__lead">
					${ leadFor( layout ) }
				</p>
				${ groups.length === 0
					? html`<os-empty-state
							heading=${ __( 'Nothing registered yet' ) }
							description=${ __(
								'Plugins and the admin menu will appear here once they’re registered.',
							) }
						></os-empty-state>`
					: groups.map(
							( group ) => html`
								<os-section
									class="os-nav-settings"
									heading=${ group.heading }
									description=${ group.description }
								>
									${ group.rows.map( ( row ) =>
										renderRow( row, placement, layout ),
									) }
								</os-section>
							`,
						) }
			`,
			wrapper,
		);
	};

	const renderRow = (
		item: NavItem,
		placement: Record< string, NavPlacement >,
		layout: NavLayout,
	) => html`<div class="os-nav-settings__row" data-item-id=${ item.id }>
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
			value=${ resolvePlacement( item, placement ) }
			@os-pick=${ onPlacementChange( item.id ) }
		>
			${ optionsFor( item.kind, layout ).map(
				( o ) =>
					html`<os-option value=${ o.id }>${ o.label }</os-option>`,
			) }
		</os-select>
	</div>`;

	paint();

	// Repaint when an EXTERNAL writer (the right-click menu, or any
	// other OS-settings consumer) moves an item, so a row never shows a
	// stale placement while this tab is open. Self-unsubscribes once
	// the panel is torn down.
	const openStation = ( window as unknown as {
		wp?: {
			os?: {
				subscribeOsSettings?: (
					cb: ( snapshot: OsSettingsSnapshot ) => void,
				) => () => void;
			};
		};
	} ).wp?.os;
	if ( openStation?.subscribeOsSettings ) {
		const unsubscribe = openStation.subscribeOsSettings( ( snapshot ) => {
			if ( ! wrapper.isConnected ) {
				unsubscribe();
				return;
			}
			paint( snapshot.navPlacement, snapshot.desktopLayout );
		} );
	}

	return wrapper;
}
