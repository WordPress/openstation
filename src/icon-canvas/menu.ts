/**
 * Desktop Mode — generic icon-canvas context menu.
 *
 * Any window that mounts an icon grid can call
 * {@link attachIconCanvasMenu} to get the same right-click /
 * background-click context menu the wallpaper offers — currently
 * the **Sort By** submenu (name / date, asc / desc), with room for
 * plugins to add more entries via the
 * `desktop-mode.icon-canvas.menu` JS filter.
 *
 * The helper deliberately stays small: it doesn't know how the
 * canvas stores its tiles or how it persists positions. It just
 * forwards a `sort` event to the caller. The caller (e.g. the
 * **My WordPress** folder window) provides a closure that re-orders
 * its tiles however it wants — REST writeback, localStorage, or a
 * pure DOM reflow are all valid strategies.
 *
 * **Bundle hygiene.** This module reaches the `<wpd-context-menu>`
 * web component via `document.createElement` — the tag is already
 * defined by the always-loaded main desktop bundle. We deliberately
 * avoid importing the wallpaper menu's helper directly because that
 * pulls in the entire files-layer dependency tree (~20KB).
 *
 * @public
 */

import { applyFilters } from '../hooks';
import { __ } from '../i18n';
import { openWithShellOverlays } from '../shell-overlays/loader';

export type SortMode = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc';

export interface IconCanvasMenuItem {
	id: string;
	label: string;
	icon?: string;
	sort?: number;
	disabled?: boolean;
	heading?: boolean;
	children?: IconCanvasMenuItem[];
	onClick?: () => void;
}

export interface IconCanvasMenuDeps {
	/**
	 * Stable scope id for this canvas (e.g. `'my-wordpress:posts'`).
	 * Forwarded to the JS filter so plugins can target a specific
	 * surface.
	 */
	scope: string;
	/**
	 * Called when the user picks a Sort By entry. The implementation
	 * decides how to reorder + persist.
	 */
	onSort: ( mode: SortMode ) => void;
	/**
	 * Optional extra menu items to merge in alongside the built-in
	 * Sort By entry. Useful for surfaces that want a "Refresh" or
	 * "New folder" entry without subscribing to the JS filter.
	 */
	extraItems?: IconCanvasMenuItem[];
	/**
	 * Whether to also open the menu on a primary (left) click on
	 * the canvas background — matches the wallpaper's UX. Defaults
	 * to `true`. Set `false` for surfaces where bg clicks should
	 * mean something else (e.g. clear selection).
	 */
	openOnBackgroundClick?: boolean;
}

interface AttachedHandle {
	dispose: () => void;
}

const MENU_CLASS = 'desktop-mode-icon-canvas-menu';

let activeMenu: HTMLElement | null = null;
let activeFlyout: HTMLElement | null = null;
/**
 * The canvas that opened the active menu. The outside-click
 * dismisser ignores clicks on this element so the canvas's own
 * click handler can run the toggle (open → close → open) instead
 * of the dismisser eating the second click. Mirrors the wallpaper
 * pattern (`openWallpaperMenu`'s `excludeOutsideTarget`).
 */
let activeCanvas: HTMLElement | null = null;
let outsideHandler: ( ( e: MouseEvent ) => void ) | null = null;
let escHandler: ( ( e: KeyboardEvent ) => void ) | null = null;

/**
 * Wire a canvas element to open the standard icon-canvas context
 * menu on right-click (and, by default, on a primary click on the
 * background — matches the wallpaper's UX).
 *
 * Tile-targeted clicks (anything inside `.desktop-mode-file-tile`)
 * are ignored so per-tile menus keep working unchanged.
 */
export function attachIconCanvasMenu(
	canvas: HTMLElement,
	deps: IconCanvasMenuDeps,
): AttachedHandle {
	const openOnBg = deps.openOnBackgroundClick !== false;

	// `openOnBackgroundClick` was the legacy left-click toggle; we
	// keep the parameter for API stability but no longer wire a
	// left-click handler — the CMO is right-click only now.
	void openOnBg;

	const onContextMenu = ( e: MouseEvent ) => {
		if ( isInsideTile( e.target ) || isInsideMenu( e.target ) ) {
			return;
		}
		// Suppress the native browser context menu and surface ours.
		e.preventDefault();
		toggle( e.clientX, e.clientY );
	};

	let toggleGen = 0;
	const toggle = ( x: number, y: number ) => {
		// Cycle: open → close → open. If the menu is already open
		// from THIS canvas, the right-click closes it and we stop.
		// If it's open from a different canvas, close that one
		// first and reopen anchored here.
		if ( activeCanvas === canvas && activeMenu ) {
			closeMenu();
			return;
		}
		const items = buildItems( deps );
		const filtered = applyFilters< IconCanvasMenuItem[], [ string ] >(
			'desktop-mode.icon-canvas.menu',
			items,
			deps.scope,
		);
		const finalItems = Array.isArray( filtered ) ? filtered : items;
		// Lazy-load the `<wpd-context-menu>` class from the shell-
		// overlays bundle before constructing. In steady state the
		// bundle is preloaded after first paint so this resolves
		// immediately; the generation check just drops a stale
		// right-click that fires while a later one is in flight.
		const myGen = ++toggleGen;
		openWithShellOverlays(
			() => myGen === toggleGen,
			() => openMenu( finalItems, { x, y }, canvas ),
		);
	};

	canvas.addEventListener( 'contextmenu', onContextMenu );

	return {
		dispose: () => {
			canvas.removeEventListener( 'contextmenu', onContextMenu );
			closeMenu();
		},
	};
}

function isInsideTile( target: EventTarget | null ): boolean {
	if ( ! ( target instanceof Element ) ) {
		return false;
	}
	return target.closest( '.desktop-mode-file-tile' ) !== null;
}

function isInsideMenu( target: EventTarget | null ): boolean {
	if ( ! ( target instanceof Element ) ) {
		return false;
	}
	return target.closest( `.${ MENU_CLASS }` ) !== null;
}

function buildItems( deps: IconCanvasMenuDeps ): IconCanvasMenuItem[] {
	const sortItem: IconCanvasMenuItem = {
		id: 'sort-by',
		label: __( 'Sort by', 'desktop-mode' ),
		icon: 'dashicons-sort',
		sort: 10,
		children: [
			{
				id: 'sort-name-asc',
				label: __( 'Name (A → Z)', 'desktop-mode' ),
				sort: 10,
				onClick: () => deps.onSort( 'name-asc' ),
			},
			{
				id: 'sort-name-desc',
				label: __( 'Name (Z → A)', 'desktop-mode' ),
				sort: 20,
				onClick: () => deps.onSort( 'name-desc' ),
			},
			{
				id: 'sort-date-desc',
				label: __( 'Newest first', 'desktop-mode' ),
				sort: 30,
				onClick: () => deps.onSort( 'date-desc' ),
			},
			{
				id: 'sort-date-asc',
				label: __( 'Oldest first', 'desktop-mode' ),
				sort: 40,
				onClick: () => deps.onSort( 'date-asc' ),
			},
		],
	};
	const items: IconCanvasMenuItem[] = [ sortItem ];
	if ( Array.isArray( deps.extraItems ) ) {
		items.push( ...deps.extraItems );
	}
	return items;
}

function sortItems(
	items: IconCanvasMenuItem[],
): IconCanvasMenuItem[] {
	return items.slice().sort( ( a, b ) => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		if ( sa !== sb ) {
			return sa - sb;
		}
		return a.label.localeCompare( b.label );
	} );
}

function openMenu(
	items: IconCanvasMenuItem[],
	pos: { x: number; y: number },
	canvas: HTMLElement,
): void {
	closeMenu();
	if ( items.length === 0 ) {
		return;
	}
	activeCanvas = canvas;

	const sorted = sortItems( items );
	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( MENU_CLASS );
	( menu as HTMLElement ).style.left = `${ pos.x }px`;
	( menu as HTMLElement ).style.top = `${ pos.y }px`;

	const itemById = new Map< string, IconCanvasMenuItem >();
	for ( const item of sorted ) {
		itemById.set( item.id, item );
		const opt = appendOption( menu, item );
		if ( hasChildren( item ) ) {
			opt.addEventListener( 'mouseenter', () => {
				openFlyout( item, opt );
			} );
		}
	}

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		const item = itemById.get( detail.id );
		if ( ! item ) {
			return;
		}
		if ( hasChildren( item ) ) {
			e.stopPropagation();
			const anchor = menu.querySelector< HTMLElement >(
				`[data-menu-item-id="${ item.id }"]`,
			);
			if ( anchor ) {
				openFlyout( item, anchor );
			}
			return;
		}
		closeMenu();
		item.onClick?.();
	} );

	document.body.appendChild( menu );
	activeMenu = menu;
	clampToViewport( menu );

	// Outside-click + Escape dismiss. We attach the dismissers
	// asynchronously so the click that opened the menu doesn't
	// instantly close it when it bubbles up.
	queueMicrotask( () => {
		outsideHandler = ( e: MouseEvent ) => {
			if ( isInsideMenu( e.target ) ) {
				return;
			}
			// Any click outside the menu closes it — including
			// clicks on the canvas's own background. Right-click
			// reopens via the `contextmenu` handler above; left-
			// clicking the bg should always dismiss.
			closeMenu();
		};
		escHandler = ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' ) {
				closeMenu();
			}
		};
		document.addEventListener( 'mousedown', outsideHandler );
		document.addEventListener( 'keydown', escHandler );
	} );
}

function appendOption(
	host: HTMLElement,
	item: IconCanvasMenuItem,
): HTMLElement {
	const opt = document.createElement( 'wpd-context-menu-option' );
	( opt as HTMLElement ).dataset.menuItemId = item.id;
	opt.setAttribute( 'value', item.id );
	if ( item.heading ) {
		opt.setAttribute( 'heading', '' );
	}
	if ( item.disabled ) {
		opt.setAttribute( 'disabled', '' );
	}
	if ( item.icon ) {
		opt.setAttribute( 'icon', sanitizeClass( item.icon ) );
	}
	if ( hasChildren( item ) ) {
		opt.setAttribute( 'has-children', '' );
	}
	opt.textContent = item.label;
	host.appendChild( opt );
	return opt as HTMLElement;
}

function openFlyout( parent: IconCanvasMenuItem, anchor: HTMLElement ): void {
	closeFlyout();
	if ( ! hasChildren( parent ) ) {
		return;
	}
	const fly = document.createElement( 'wpd-context-menu' );
	fly.setAttribute( 'open', '' );
	fly.classList.add( MENU_CLASS, `${ MENU_CLASS }--flyout` );
	const childById = new Map< string, IconCanvasMenuItem >();
	for ( const child of sortItems( parent.children ?? [] ) ) {
		childById.set( child.id, child );
		appendOption( fly, child );
	}
	fly.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		const child = childById.get( detail.id );
		if ( ! child ) {
			return;
		}
		e.stopPropagation();
		closeMenu();
		child.onClick?.();
	} );
	document.body.appendChild( fly );
	activeFlyout = fly;
	positionFlyout( fly, anchor );
}

function positionFlyout( fly: HTMLElement, anchor: HTMLElement ): void {
	const ar = anchor.getBoundingClientRect();
	fly.style.position = 'fixed';
	fly.style.left = `${ ar.right }px`;
	fly.style.top = `${ ar.top }px`;
	const fr = fly.getBoundingClientRect();
	if ( fr.right > window.innerWidth ) {
		fly.style.left = `${ Math.max( 0, ar.left - fr.width ) }px`;
	}
	if ( fr.bottom > window.innerHeight ) {
		fly.style.top = `${ Math.max( 0, window.innerHeight - fr.height - 8 ) }px`;
	}
}

function clampToViewport( menu: HTMLElement ): void {
	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 0, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max( 0, window.innerHeight - rect.height - 8 ) }px`;
	}
}

function hasChildren( item: IconCanvasMenuItem ): boolean {
	return Array.isArray( item.children ) && item.children.length > 0;
}

function closeFlyout(): void {
	if ( activeFlyout ) {
		activeFlyout.remove();
		activeFlyout = null;
	}
}

function closeMenu(): void {
	closeFlyout();
	if ( activeMenu ) {
		activeMenu.remove();
		activeMenu = null;
	}
	activeCanvas = null;
	if ( outsideHandler ) {
		document.removeEventListener( 'mousedown', outsideHandler );
		outsideHandler = null;
	}
	if ( escHandler ) {
		document.removeEventListener( 'keydown', escHandler );
		escHandler = null;
	}
}

function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
