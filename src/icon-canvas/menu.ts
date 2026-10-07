import { applyFilters } from '../hooks';
import { __ } from '../i18n';
import { openWithShellOverlays } from '../shell-overlays/loader';
import { clampToViewport, positionFlyout } from '../ui/util/menu-position';

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

	scope: string;

	onSort: ( mode: SortMode ) => void;

	extraItems?: IconCanvasMenuItem[];

	openOnBackgroundClick?: boolean;
}

interface AttachedHandle {
	dispose: () => void;
}

const MENU_CLASS = 'os-icon-canvas-menu';

let activeMenu: HTMLElement | null = null;
let activeFlyout: HTMLElement | null = null;

let activeCanvas: HTMLElement | null = null;
let outsideHandler: ( ( e: MouseEvent ) => void ) | null = null;
let escHandler: ( ( e: KeyboardEvent ) => void ) | null = null;

export function attachIconCanvasMenu(
	canvas: HTMLElement,
	deps: IconCanvasMenuDeps,
): AttachedHandle {
	const openOnBg = deps.openOnBackgroundClick !== false;

	void openOnBg;

	const onContextMenu = ( e: MouseEvent ) => {
		if ( isInsideTile( e.target ) || isInsideMenu( e.target ) ) {
			return;
		}

		e.preventDefault();
		toggle( e.clientX, e.clientY );
	};

	let toggleGen = 0;
	const toggle = ( x: number, y: number ) => {
		if ( activeCanvas === canvas && activeMenu ) {
			closeMenu();
			return;
		}
		const items = buildItems( deps );
		const filtered = applyFilters< IconCanvasMenuItem[], [ string ] >(
			'os.icon-canvas.menu',
			items,
			deps.scope,
		);
		const finalItems = Array.isArray( filtered ) ? filtered : items;

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
	return target.closest( '.os-file-tile' ) !== null;
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
	const menu = document.createElement( 'os-context-menu' );
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

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
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

	queueMicrotask( () => {
		outsideHandler = ( e: MouseEvent ) => {
			if ( isInsideMenu( e.target ) ) {
				return;
			}

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
	const opt = document.createElement( 'os-context-menu-option' );
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
	const fly = document.createElement( 'os-context-menu' );
	fly.setAttribute( 'open', '' );
	fly.classList.add( MENU_CLASS, `${ MENU_CLASS }--flyout` );
	const childById = new Map< string, IconCanvasMenuItem >();
	for ( const child of sortItems( parent.children ?? [] ) ) {
		childById.set( child.id, child );
		appendOption( fly, child );
	}
	fly.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
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
