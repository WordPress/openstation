/**
 * Apps & Icons section — per-item placement preferences.
 *
 * Lists every dock item + desktop icon registered in this admin (the
 * dispatcher's view via `getMenuItems()` and `desktopModeConfig.
 * desktopIcons`). For each row the user picks where the item should
 * appear: on the dock, on the wallpaper, on both surfaces, or
 * nowhere. The choice writes to `state.itemVisibility` and the layout
 * dispatcher's settings subscription refreshes the rails live.
 *
 * @since 0.25.0
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { renderIcon } from '../../icon';
import type { ItemVisibility, SettingsCtx } from '../types';
import { listPlaceableItems } from '../item-placement';
import type { DesktopConfig } from '../../types';
import type { DockItem } from '../../dock';

/** Read the live dock item list — prefer the live shell API when present. */
function readDockItems(): DockItem[] {
	const api = ( window as unknown as {
		wp?: { desktop?: { getMenuItems?: () => DockItem[] } };
	} ).wp?.desktop;
	if ( api && typeof api.getMenuItems === 'function' ) {
		return api.getMenuItems();
	}
	// Fallback: the server-shipped list from the boot payload.
	const cfg = ( window as unknown as { desktopModeConfig?: DesktopConfig } )
		.desktopModeConfig;
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

function readDesktopIcons(): import( '../../types' ).DesktopIconServerEntry[] {
	const cfg = ( window as unknown as { desktopModeConfig?: DesktopConfig } )
		.desktopModeConfig;
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

	const paint = (): void => {
		const dockItems = readDockItems();
		const desktopIcons = readDesktopIcons();
		const rows = listPlaceableItems(
			dockItems,
			desktopIcons,
			ctx.state.itemVisibility,
		);

		render(
			html`
				<wpd-section
					heading=${ __( 'Apps & Icons' ) }
					description=${ __(
						'Choose where each app shortcut shows up — on the dock, on the desktop wallpaper, both, or hidden entirely. Changes apply instantly to the running shell.',
					) }
				>
					${ rows.length === 0
						? html`<wpd-empty-state
								heading=${ __( 'No apps registered yet' ) }
								description=${ __(
									'Plugins and the admin menu will appear here once they’re registered.',
								) }
							></wpd-empty-state>`
						: html`<div class="desktop-mode-apps-icons__list">
								${ rows.map(
									( row ) =>
										html`<div
											class="desktop-mode-apps-icons__row"
											data-item-id=${ row.id }
										>
											<div class="desktop-mode-apps-icons__identity">
												${ renderIcon( row.icon, {
													title: row.title,
													className:
														'desktop-mode-apps-icons__icon',
												} ) }
												<div class="desktop-mode-apps-icons__title">
													${ row.title }
												</div>
											</div>
											<wpd-select
												label=${ __( 'Show in' ) }
												value=${ row.placement }
												@wpd-pick=${ onPlacementChange( row.id ) }
											>
												${ getPlacementOptions().map(
													( o ) =>
														html`<wpd-option
															value=${ o.id }
															>${ o.label }</wpd-option
														>`,
												) }
											</wpd-select>
										</div>`,
								) }
							</div>` }
				</wpd-section>
			`,
			wrapper,
		);
	};

	paint();
	return wrapper;
}
