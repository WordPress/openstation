/**
 * OpenStation — the one context menu.
 *
 * Four surfaces had grown their own near-identical `<os-context-menu>`
 * builder (file tiles, My WordPress entities, users, media). They
 * drifted: one sorted its items and three didn't, two forgot the
 * outside-click dismisser, and only one deferred construction behind
 * the shell-overlays loader. This is that builder, once.
 *
 * Construction is deferred through `openWithShellOverlays` so the
 * `<os-context-menu>` / `<os-context-menu-option>` classes stay in
 * the lazy overlay bundle rather than in `desktop.min.js`. The
 * generation counter makes a second right-click before the bundle
 * lands cancel the first — otherwise two menus race to the DOM.
 */

import { doAction } from '../hooks';
import { attachDismissable } from '../desktop-files/dismissable';
import { openWithShellOverlays } from '../shell-overlays/loader';
/**
 * What the menu needs from an action — the structural subset of
 * `SelectionAction` that has nothing to do with which item type the
 * action came from. Typing the parameter this way lets a caller pass
 * `SelectionAction< Post >[]` or `SelectionAction< User >[]` without
 * a cast through `unknown`; the menu neither knows nor cares.
 *
 * @public
 */
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
	/** Actions to render. Already resolved — this does no filtering. */
	actions: ActionMenuEntry[];
	/** Extra `data-*` pairs for the menu element (diagnostics, tests). */
	dataset?: Record< string, string >;
	/** Extra class on the menu element. */
	className?: string;
	/** Action slug fired as `os.<scope>.menu.opened` / `.closed`. */
	scope?: string;
	/**
	 * Fired once the menu is in the DOM, with the rendered ids.
	 * Surfaces with their own long-standing `doAction` contract pass
	 * one of these to keep firing it verbatim.
	 */
	onOpened?: ( ids: string[] ) => void;
	/** Fired when the menu closes, however it closed. */
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

/**
 * Open a context menu at viewport coordinates.
 *
 * @public
 */
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
		// `os-context-menu-option` reports `detail.id` from
		// `dataset.menuItemId`; the `value` attribute alone lands under
		// `detail.value`, which nothing here reads. Setting only
		// `value` is the silent "the menu item does nothing" bug.
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
				// eslint-disable-next-line no-console
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

	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 0, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max( 0, window.innerHeight - rect.height - 8 ) }px`;
	}

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
