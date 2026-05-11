/**
 * Right-click context menu for hiding / moving a dock tile or
 * desktop icon. Mutates the user's `itemVisibility` map via the
 * public `wp.desktop.updateOsSettings` writer; the layout dispatcher's
 * settings subscription handles the live re-paint.
 *
 * Two callers:
 *
 * - `Dock` — attaches a `contextmenu` listener per tile, passes
 *   `surface: 'dock'`. Menu options: "Hide from dock", "Show on
 *   desktop instead", "Hide everywhere".
 * - `renderDesktopIcons` — attaches per icon, passes
 *   `surface: 'desktop'`. Menu options: "Hide from desktop", "Move
 *   to dock", "Hide everywhere".
 *
 * The `id` passed in is the **rail-prefixed** id as it appears in
 * the DOM (`'dock:<x>'` / `'desktop:<x>'` for synthesized tiles).
 * The handler reduces it to the canonical id via
 * {@link canonicalItemId} before writing the override, so the
 * visibility map is always keyed by the registered item id.
 *
 * @since 0.25.0
 */

import { __ } from './i18n';
import './ui/components/wpd-context-menu/wpd-context-menu';
import { canonicalItemId } from './settings/item-placement';
import type { ItemVisibility } from './settings/types';
import type { OsSettingsSnapshot } from './settings/registry';

interface WpDesktopShim {
	getOsSettings?: () => OsSettingsSnapshot;
	updateOsSettings?: (
		patch: Partial< OsSettingsSnapshot >,
		opts?: { windowId?: string },
	) => void;
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
}

function getApi(): WpDesktopShim | null {
	const w = window as unknown as { wp?: { desktop?: WpDesktopShim } };
	return w.wp?.desktop ?? null;
}

let activeMenu: HTMLElement | null = null;

function closeMenu(): void {
	if ( activeMenu ) {
		activeMenu.remove();
		activeMenu = null;
	}
}

function writeVisibility(
	canonicalId: string,
	placement: ItemVisibility,
): void {
	const api = getApi();
	if ( ! api?.getOsSettings || ! api?.updateOsSettings ) {
		return;
	}
	const snap = api.getOsSettings();
	const next = { ...snap.itemVisibility };
	if ( placement === 'both' ) {
		delete next[ canonicalId ];
	} else {
		next[ canonicalId ] = placement;
	}
	api.updateOsSettings( { itemVisibility: next } );
}

export interface OpenItemVisibilityMenuOpts {
	/** Viewport coordinates the user right-clicked at. */
	x: number;
	y: number;
	/** Item id as it appears in the DOM (may be rail-prefixed). */
	id: string;
	/** Display title — used in the OS Settings shortcut option. */
	title: string;
	/** Which surface the user right-clicked on. */
	surface: 'dock' | 'desktop';
}

/**
 * Open the visibility menu next to the user's cursor. Idempotent —
 * a second call closes the previous menu before opening a fresh one.
 */
export function openItemVisibilityMenu(
	opts: OpenItemVisibilityMenuOpts,
): void {
	closeMenu();

	const canonical = canonicalItemId( opts.id );

	type MenuOption = {
		id: string;
		label: string;
		icon?: string;
		danger?: boolean;
		onPick: () => void;
	};

	const options: MenuOption[] = [];

	if ( opts.surface === 'dock' ) {
		options.push( {
			id: 'hide-from-dock',
			label: __( 'Hide from dock' ),
			icon: 'dashicons-hidden',
			onPick: () => writeVisibility( canonical, 'desktop' ),
		} );
		options.push( {
			id: 'show-on-desktop-too',
			label: __( 'Also show on desktop' ),
			icon: 'dashicons-desktop',
			onPick: () => writeVisibility( canonical, 'both' ),
		} );
	} else {
		options.push( {
			id: 'hide-from-desktop',
			label: __( 'Hide from desktop' ),
			icon: 'dashicons-hidden',
			onPick: () => writeVisibility( canonical, 'dock' ),
		} );
		options.push( {
			id: 'show-on-dock-too',
			label: __( 'Also show on dock' ),
			icon: 'dashicons-menu',
			onPick: () => writeVisibility( canonical, 'both' ),
		} );
	}
	options.push( {
		id: 'hide-everywhere',
		label: __( 'Hide everywhere' ),
		icon: 'dashicons-no',
		danger: true,
		onPick: () => writeVisibility( canonical, 'hidden' ),
	} );

	options.push( {
		id: 'open-settings',
		label: __( 'Apps & Icons settings…' ),
		icon: 'dashicons-admin-generic',
		onPick: () => {
			const api = getApi();
			api?.openOsSettings?.( { tabId: 'apps-icons' } );
		},
	} );

	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'desktop-mode-item-visibility-menu' );
	( menu as HTMLElement ).dataset.itemId = opts.id;
	menu.style.position = 'fixed';
	// Off-screen first so we can measure size before placement.
	menu.style.left = '-9999px';
	menu.style.top = '-9999px';
	menu.style.visibility = 'hidden';
	menu.style.zIndex = '10000';

	const byId = new Map< string, MenuOption >();
	for ( const opt of options ) {
		byId.set( opt.id, opt );
		const node = document.createElement( 'wpd-context-menu-option' );
		node.setAttribute( 'value', opt.id );
		if ( opt.icon ) {
			node.setAttribute( 'icon', opt.icon );
		}
		if ( opt.danger ) {
			node.setAttribute( 'danger', '' );
		}
		node.textContent = opt.label;
		menu.appendChild( node );
	}

	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;
		const opt = byId.get( detail?.id );
		closeMenu();
		try {
			opt?.onPick();
		} catch {
			/* swallow — bad opener shouldn't crash the shell */
		}
	} );

	document.body.appendChild( menu );
	activeMenu = menu;

	// Measure now that the menu is in the DOM, then position it.
	//
	// Dock right-clicks ALWAYS anchor the menu's bottom edge at the
	// cursor (i.e., the menu opens upward). The dock hugs a viewport
	// edge — bottom for the taskbar, left/right for side docks — so
	// anchoring below the cursor reliably pushes the menu off-
	// screen. Desktop-icon right-clicks default to opening below
	// the cursor (natural OS-style menu) and only flip up when
	// they would overflow the viewport.
	const rect = menu.getBoundingClientRect();
	const margin = 8;
	let left = opts.x;
	let top: number;
	if ( opts.surface === 'dock' ) {
		top = Math.max( margin, opts.y - rect.height - margin );
	} else {
		top = opts.y;
		if ( top + rect.height + margin > window.innerHeight ) {
			top = Math.max( margin, opts.y - rect.height );
		}
	}
	if ( left + rect.width + margin > window.innerWidth ) {
		left = Math.max( margin, opts.x - rect.width );
	}
	menu.style.left = `${ left }px`;
	menu.style.top = `${ top }px`;
	menu.style.visibility = '';

	// Outside-click + Escape dismisser.
	const onOutside = ( ev: MouseEvent ): void => {
		if ( ! activeMenu ) {
			return;
		}
		if ( ! activeMenu.contains( ev.target as Node ) ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	document.addEventListener( 'mousedown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
}
