import { doAction } from '../hooks';
import { attachDismissable } from '../desktop-files/dismissable';
import { openWithShellOverlays } from '../shell-overlays/loader';
import { clampToViewport } from '../ui/util/menu-position';

export interface ActionMenuEntry {
	id: string;
	label: string;
	icon?: string;
	sort?: number;
	danger?: boolean;
	disabled?: boolean;
	onClick: ( e: MouseEvent ) => void | Promise< void >;
}

const MENU_CLASS = 'os-wallpaper-menu';

let activeMenu: HTMLElement | null = null;
let activeOnClosed: ( () => void ) | null = null;
let openGeneration = 0;

export interface ActionMenuOptions {

	actions: ActionMenuEntry[];

	dataset?: Record< string, string >;

	className?: string;

	scope?: string;

	onOpened?: ( ids: string[] ) => void;

	onClosed?: () => void;
}

export function isActionMenuOpen(): boolean {
	return activeMenu !== null;
}

export function closeActionMenu(): void {
	if ( ! activeMenu ) {
		return;
	}
	const scope = activeMenu.dataset.menuScope ?? 'selection';
	const closed = activeOnClosed;
	activeMenu.dispatchEvent( new CustomEvent( 'tile-menu-closed' ) );
	activeMenu.remove();
	activeMenu = null;
	activeOnClosed = null;
	closed?.();
	doAction( `os.${ scope }.menu.closed`, {} );
}

export function openActionMenu(
	pos: { x: number; y: number },
	opts: ActionMenuOptions,
): void {
	closeActionMenu();
	const myGen = ++openGeneration;
	openWithShellOverlays(
		() => myGen === openGeneration,
		() => openImmediate( pos, opts ),
	);
}

function openImmediate(
	pos: { x: number; y: number },
	{
		actions,
		dataset,
		className,
		scope = 'selection',
		onOpened,
		onClosed,
	}: ActionMenuOptions,
): void {
	if ( actions.length === 0 ) {
		return;
	}

	const menu = document.createElement( 'os-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( MENU_CLASS );
	if ( className ) {
		menu.classList.add( className );
	}
	menu.dataset.menuScope = scope;
	for ( const [ key, value ] of Object.entries( dataset ?? {} ) ) {
		menu.dataset[ key ] = value;
	}
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	const byId = new Map< string, ActionMenuEntry >();
	for ( const action of actions ) {
		byId.set( action.id, action );
		const opt = document.createElement( 'os-context-menu-option' );

		opt.dataset.menuItemId = action.id;
		opt.setAttribute( 'value', action.id );
		if ( action.danger ) {
			opt.setAttribute( 'danger', '' );
		}
		if ( action.disabled ) {
			opt.setAttribute( 'disabled', '' );
		}
		if ( action.icon ) {
			opt.setAttribute( 'icon', sanitizeClass( action.icon ) );
		}
		opt.textContent = action.label;
		menu.appendChild( opt );
	}

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string } > ).detail;
		const action = byId.get( detail.id );
		if ( ! action ) {
			return;
		}
		closeActionMenu();
		void Promise.resolve( action.onClick( new MouseEvent( 'click' ) ) ).catch(
			( err: unknown ) => {
				console.error(
					`[openstation] menu action '${ action.id }' threw:`,
					err,
				);
			},
		);
	} );

	document.body.appendChild( menu );
	activeMenu = menu;
	activeOnClosed = onClosed ?? null;

	clampToViewport( menu );

	const detach = attachDismissable( menu, { close: () => closeActionMenu() } );
	menu.addEventListener( 'tile-menu-closed', detach );

	const ids = actions.map( ( a ) => a.id );
	onOpened?.( ids );
	doAction( `os.${ scope }.menu.opened`, {
		items: ids,
		count: actions.length,
	} );
}

function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
