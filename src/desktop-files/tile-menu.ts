/**
 * OpenStation — File-tile right-click context menu.
 *
 * Sister of the wallpaper context menu, scoped to a single
 * placement. Built-in items: Open, Delete (or "Delete folder"
 * when the placement is a folder). Plugin authors extend the
 * list via the `os.files.tile-menu` filter.
 *
 * Reuses the wallpaper-menu's CSS (`.os-wallpaper-menu*`)
 * so the two menus look identical.
 */

import { applyFilters, doAction } from '../hooks';
import { openWithShellOverlays } from '../shell-overlays/loader';
import { attachDismissable } from './dismissable';
import type { RestPlacementShape } from './rest';

export interface TileMenuItem {
	id: string;
	label: string;
	icon?: string;
	sort?: number;
	disabled?: boolean;
	danger?: boolean;
	onClick: ( e: MouseEvent ) => void | Promise< void >;
}

const MENU_CLASS = 'os-wallpaper-menu';

let activeMenu: HTMLElement | null = null;

export function isTileMenuOpen(): boolean {
	return activeMenu !== null;
}

export function closeTileMenu(): void {
	if ( ! activeMenu ) {
		return;
	}
	activeMenu.dispatchEvent( new CustomEvent( 'tile-menu-closed' ) );
	activeMenu.remove();
	activeMenu = null;
	doAction( 'os.files.tile-menu.closed', {} );
}

export interface OpenTileMenuOptions {
	placement: RestPlacementShape;
	items: TileMenuItem[];
}

let openGeneration = 0;

/**
 * Open the tile context menu at viewport coordinates.
 *
 * Construction is deferred behind the shell-overlays loader so the
 * `<os-context-menu>` / `<os-context-menu-option>` classes ship
 * in the lazy bundle rather than `desktop.min.js`.
 */
export function openTileMenu(
	pos: { x: number; y: number },
	opts: OpenTileMenuOptions,
): void {
	closeTileMenu();
	const myGen = ++openGeneration;
	openWithShellOverlays(
		() => myGen === openGeneration,
		() => openTileMenuImmediate( pos, opts ),
	);
}

function openTileMenuImmediate(
	pos: { x: number; y: number },
	{ placement, items }: OpenTileMenuOptions,
): void {
	const list = applyFilters< TileMenuItem[], [ RestPlacementShape ] >(
		'os.files.tile-menu',
		items.slice(),
		placement,
	);
	const sorted = ( Array.isArray( list ) ? list : items )
		.slice()
		.sort( ( a, b ) => {
			const sa = typeof a.sort === 'number' ? a.sort : 100;
			const sb = typeof b.sort === 'number' ? b.sort : 100;
			if ( sa !== sb ) {
				return sa - sb;
			}
			return a.label.localeCompare( b.label );
		} );

	if ( sorted.length === 0 ) {
		return;
	}

	const menu = document.createElement( 'os-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( MENU_CLASS );
	( menu as HTMLElement ).dataset.placementId = String( placement.id );
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	const itemById = new Map< string, TileMenuItem >();
	for ( const item of sorted ) {
		itemById.set( item.id, item );
		const opt = document.createElement( 'os-context-menu-option' );
		opt.dataset.menuItemId = item.id;
		opt.setAttribute( 'value', item.id );
		if ( item.danger ) {
			opt.setAttribute( 'danger', '' );
		}
		if ( item.disabled ) {
			opt.setAttribute( 'disabled', '' );
		}
		if ( item.icon ) {
			opt.setAttribute( 'icon', sanitizeClass( item.icon ) );
		}
		opt.textContent = item.label;
		menu.appendChild( opt );
	}

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;
		const item = itemById.get( detail.id );
		if ( ! item ) {
			return;
		}
		closeTileMenu();
		void item.onClick( new MouseEvent( 'click' ) );
	} );

	document.body.appendChild( menu );
	activeMenu = menu;

	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 0, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max( 0, window.innerHeight - rect.height - 8 ) }px`;
	}

	const detach = attachDismissable( menu, {
		close: () => closeTileMenu(),
	} );
	menu.addEventListener( 'tile-menu-closed', detach );

	doAction( 'os.files.tile-menu.opened', {
		placementId: placement.id,
		items: sorted.map( ( i ) => i.id ),
	} );
}

function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
