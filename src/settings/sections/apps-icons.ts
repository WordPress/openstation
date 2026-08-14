/**
 * Apps & Plugins section — per-item placement preferences.
 *
 * Lists every dock item + desktop icon registered in this admin (the
 * dispatcher's view via `getMenuItems()` and `openStationConfig.
 * desktopIcons`). For each row the user picks where the item should
 * appear: on the dock, on the wallpaper, on both surfaces, or
 * nowhere. The choice writes to `state.itemVisibility` and the layout
 * dispatcher's settings subscription refreshes the rails live.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { renderIcon } from '../../icon';
import { slotForTileId } from '../../desktop-themes/slots';
import type { ItemVisibility, SettingsCtx } from '../types';
import type { OsSettingsSnapshot } from '../registry';
import {
	listPlaceableItems,
	type PlaceableSystemTile,
} from '../item-placement';
import type { DesktopConfig } from '../../types';
import type { DockItem } from '../../dock';

/** Read the live dock item list — prefer the live shell API when present. */
function readDockItems(): DockItem[] {
	const api = ( window as unknown as {
		wp?: { os?: { getMenuItems?: () => DockItem[] } };
	} ).wp?.os;
	if ( api && typeof api.getMenuItems === 'function' ) {
		return api.getMenuItems();
	}
	// Fallback: the server-shipped list from the boot payload.
	const cfg = ( window as unknown as { openStationConfig?: DesktopConfig } )
		.openStationConfig;
	const raw = cfg?.dockItems ?? [];
	return raw.map( ( i ) => ( {
		id: i.id,
		title: i.title,
		icon: i.icon,
		url: i.url,
		badge: i.badge,
		submenu: i.submenu,
		multi: i.multi,
		isCore: i.isCore,
	} ) );
}

/**
 * Read the system tiles that opted into this list.
 *
 * Shell-owned affordances attached straight to a rail — Mio's
 * toggle is the shipped example. They carry no server-side icon entry,
 * so they only reach this tab through the live API.
 */
function readSystemTiles(): PlaceableSystemTile[] {
	const api = ( window as unknown as {
		wp?: { os?: { listSystemTiles?: () => PlaceableSystemTile[] } };
	} ).wp?.os;
	return typeof api?.listSystemTiles === 'function'
		? api.listSystemTiles()
		: [];
}

function readDesktopIcons(): import( '../../types' ).DesktopIconServerEntry[] {
	const cfg = ( window as unknown as { openStationConfig?: DesktopConfig } )
		.openStationConfig;
	return cfg?.desktopIcons ?? [];
}

interface PlacementOption {
	id: ItemVisibility;
	label: string;
}

/**
 * Available placement options. Same set for every row — both rails
 * support synthesis now: dock-native items are projected onto the
 * wallpaper as synthetic shortcut placements via the files-layer
 * sync, and desktop-native icons are synthesized as dock tiles by
 * the layout dispatcher.
 */
function getPlacementOptions(): PlacementOption[] {
	return [
		{ id: 'desktop', label: __( 'On the desktop' ) },
		{ id: 'dock', label: __( 'On the dock' ) },
		{ id: 'both', label: __( 'On both' ) },
		{ id: 'hidden', label: __( 'Hidden' ) },
	];
}

/**
 * Options for a row that can only ever live on the dock.
 *
 * System tiles carry no server-side icon entry for the wallpaper grid
 * to synthesize from, so offering "on the desktop" would read as a
 * placement and behave as a disappearance.
 */
function getDockOnlyOptions(): PlacementOption[] {
	return [
		{ id: 'dock', label: __( 'On the dock' ) },
		{ id: 'hidden', label: __( 'Hidden' ) },
	];
}

export function buildAppsIconsSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const setPlacement = ( id: string, placement: ItemVisibility ): void => {
		const next = { ...ctx.state.itemVisibility };
		next[ id ] = placement;
		ctx.state.itemVisibility = next;
		ctx.save();
		paint();
	};

	const onPlacementChange =
		( id: string ) =>
			( e: Event ): void => {
				const detail = ( e as CustomEvent ).detail as { value?: string };
				const next = detail?.value;
				if (
					next === 'both' ||
					next === 'dock' ||
					next === 'desktop' ||
					next === 'hidden'
				) {
					setPlacement( id, next );
				}
			};

	const paint = (
		visibility: Record< string, ItemVisibility > = ctx.state
			.itemVisibility,
	): void => {
		const dockItems = readDockItems();
		const desktopIcons = readDesktopIcons();
		const rows = listPlaceableItems(
			dockItems,
			desktopIcons,
			visibility,
			readSystemTiles(),
		);

		render(
			html`
				<!--
					No heading. The page title above already says
					"Apps & Plugins", and <os-section> omits an empty
					heading entirely rather than opening with a blank line.
				-->
				<os-section
					heading=""
					description=${ __(
						'Choose where each app shortcut shows up — on the dock, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly to the running shell.',
					) }
				>
					${ rows.length === 0
						? html`<os-empty-state
								heading=${ __( 'No apps registered yet' ) }
								description=${ __(
									'Plugins and the admin menu will appear here once they’re registered.',
								) }
							></os-empty-state>`
						: html`<div class="os-apps-icons__list">
								${ rows.map(
									( row ) =>
										html`<div
											class="os-apps-icons__row"
											data-item-id=${ row.id }
										>
											<div class="os-apps-icons__identity">
												${ renderIcon( row.icon, {
													title: row.title,
													className:
														'os-apps-icons__icon',
													// Preview the themed
													// icon so this list
													// matches the dock.
													slot: slotForTileId(
														row.id,
													),
												} ) }
												<div class="os-apps-icons__title">
													${ row.title }
												</div>
											</div>
											<os-select
												label=${ __( 'Show in' ) }
												value=${ row.placement }
												@os-pick=${ onPlacementChange( row.id ) }
											>
												${ ( row.dockOnly
													? getDockOnlyOptions()
													: getPlacementOptions()
												).map(
													( o ) =>
														html`<os-option
															value=${ o.id }
															>${ o.label }</os-option
														>`,
												) }
											</os-select>
										</div>`,
								) }
							</div>` }
				</os-section>
			`,
			wrapper,
		);
	};

	paint();

	// Repaint when an EXTERNAL writer (the right-click visibility menu,
	// or any other OS-settings consumer) mutates itemVisibility, so a
	// row's <os-select> never shows a stale placement while this tab is
	// open. Self-unsubscribes once the panel is torn down (the wrapper
	// is no longer in the DOM), mirroring the wallpaper section's
	// registry.subscribe pattern so listeners don't pile up across
	// repeated settings-window opens.
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
			paint( snapshot.itemVisibility );
		} );
	}

	return wrapper;
}
