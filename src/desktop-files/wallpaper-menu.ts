/**
 * Desktop Mode — Wallpaper context menu (CMO).
 *
 * Clicking empty wallpaper used to call `manager.toggleShowDesktop()`
 * directly. Phase 4 replaces that with a small floating menu —
 * the desktop-OS equivalent of the right-click "Create folder /
 * Show desktop / OS Settings / Wallpapers" affordance.
 *
 * Plugins extend the menu via the `desktop-mode.wallpaper-context-menu`
 * filter (JS) or the `desktop_mode_wallpaper_context_menu_items`
 * filter (PHP, carried in the shell payload as
 * `serverWallpaperMenuItems`). Both lists are merged at click time.
 *
 * @since 0.9.0
 */

import { applyFilters, doAction } from '../hooks';
// Side-effect import: registers `<wpd-context-menu>` +
// `<wpd-context-menu-option>` so the menu DOM upgrades.
import { openWithShellOverlays } from '../shell-overlays/loader';
import { attachDismissable } from './dismissable';

/** Public shape of a menu item. Plugins build these via the filter. */
export interface WallpaperMenuItem {
	/** Stable id; useful for tests + telemetry. */
	id: string;
	/** Visible label. */
	label: string;
	/** Optional dashicon class (e.g. `'dashicons-portfolio'`). */
	icon?: string;
	/** Sort order — lower wins. Default 100. */
	sort?: number;
	/** Whether the item should render as disabled. */
	disabled?: boolean;
	/**
	 * Optional non-clickable section heading. Renders as a small
	 * uppercase label between groups of items. Headings ignore
	 * `onClick` and `icon`. Use `id` for test selectors.
	 */
	heading?: boolean;
	/**
	 * Optional submenu items. When present, the item renders with
	 * a trailing chevron and opens a flyout on hover/focus to the
	 * right (left in RTL). The parent's `onClick` is not invoked
	 * when `children` is non-empty — the flyout takes over.
	 */
	children?: WallpaperMenuItem[];
	/**
	 * Render a leading check mark on the option (radio-style — used
	 * for the active Sort By order). Cosmetic; doesn't change the
	 * click path.
	 */
	checked?: boolean;
	/** Click handler. Receives the event for `preventDefault` etc. */
	onClick: ( e: MouseEvent ) => void | Promise< void >;
}

/** Server-shipped item shape. PHP can preload basic items here. */
export interface ServerWallpaperMenuItem {
	id: string;
	label: string;
	icon?: string;
	sort?: number;
	disabled?: boolean;
	/** Optional callback id resolved on the JS side. Plugins ship a JS handler under the same id. */
	callbackId?: string;
}

const MENU_CLASS = 'desktop-mode-wallpaper-menu';

let activeMenu: HTMLElement | null = null;

export interface OpenWallpaperMenuOptions {
	/**
	 * Element whose clicks should NOT auto-close the menu. The
	 * wallpaper-click toggle path passes the desktop area here so
	 * a second click on the wallpaper can run the toggle handler
	 * (close-and-don't-reopen) instead of being eaten by the
	 * outside-click dismisser.
	 */
	excludeOutsideTarget?: HTMLElement;
}

/** Whether a wallpaper context menu is currently mounted. */
export function isWallpaperMenuOpen(): boolean {
	return activeMenu !== null;
}

/**
 * Generation counter to drop superseded openWallpaperMenu calls
 * that come in while the shell-overlays bundle is still loading
 * (only relevant on the first menu open before the post-first-
 * paint preload has landed).
 */
let openGeneration = 0;

/**
 * Build and show the menu at viewport coordinates `{ x, y }`.
 * The menu is dismissed on outside click or on Escape.
 *
 * Construction is deferred behind the shell-overlays loader so
 * the `<wpd-context-menu>` class ships in the lazy bundle.
 */
export function openWallpaperMenu(
	host: HTMLElement,
	pos: { x: number; y: number },
	items: WallpaperMenuItem[],
	options: OpenWallpaperMenuOptions = {},
): void {
	closeWallpaperMenu();
	const myGen = ++openGeneration;
	openWithShellOverlays(
		() => myGen === openGeneration,
		() => openWallpaperMenuImmediate( host, pos, items, options ),
	);
}

function openWallpaperMenuImmediate(
	host: HTMLElement,
	pos: { x: number; y: number },
	items: WallpaperMenuItem[],
	options: OpenWallpaperMenuOptions = {},
): void {
	if ( items.length === 0 ) {
		return;
	}

	items = items.slice().sort( ( a, b ) => {
		const sa = typeof a.sort === 'number' ? a.sort : 100;
		const sb = typeof b.sort === 'number' ? b.sort : 100;
		if ( sa !== sb ) {
			return sa - sb;
		}
		return a.label.localeCompare( b.label );
	} );

	// Use the framework's `<wpd-context-menu>` component for the
	// host so styling + roles come from the shared primitive.
	const menu = document.createElement( 'wpd-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( MENU_CLASS );
	menu.style.left = `${ pos.x }px`;
	menu.style.top = `${ pos.y }px`;

	const itemById = new Map< string, WallpaperMenuItem >();
	let activeFlyout: HTMLElement | null = null;
	let activeFlyoutParent: WallpaperMenuItem | null = null;
	const closeActiveFlyout = (): void => {
		if ( activeFlyout ) {
			activeFlyout.remove();
			activeFlyout = null;
			activeFlyoutParent = null;
		}
	};

	for ( const item of items ) {
		itemById.set( item.id, item );
		const opt = document.createElement( 'wpd-context-menu-option' );
		opt.dataset.menuItemId = item.id;
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
		const hasChildren = Array.isArray( item.children ) && item.children.length > 0;
		if ( hasChildren ) {
			opt.setAttribute( 'has-children', '' );
		}
		opt.textContent = item.label;
		opt.addEventListener( 'mouseenter', () => {
			if ( hasChildren ) {
				openFlyout( item, opt );
				return;
			}
			closeActiveFlyout();
		} );
		menu.appendChild( opt );
	}

	// One delegated `wpd-context-menu-pick` listener handles every
	// option in the parent menu (and its flyout — events bubble).
	menu.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;
		const item = itemById.get( detail.id ) ?? null;
		if ( ! item ) {
			return;
		}
		if ( Array.isArray( item.children ) && item.children.length > 0 ) {
			// Toggle the flyout; clicking the parent doesn't dismiss the menu.
			e.stopPropagation();
			if ( activeFlyoutParent && activeFlyoutParent.id === item.id ) {
				closeActiveFlyout();
				return;
			}
			const anchor = menu.querySelector< HTMLElement >(
				`[data-menu-item-id="${ item.id }"]`,
			);
			if ( anchor ) {
				openFlyout( item, anchor );
			}
			return;
		}
		closeWallpaperMenu();
		void item.onClick( new MouseEvent( 'click' ) );
	} );

	function openFlyout( parent: WallpaperMenuItem, anchor: HTMLElement ): void {
		closeActiveFlyout();
		const fly = document.createElement( 'wpd-context-menu' );
		fly.setAttribute( 'open', '' );
		fly.classList.add( MENU_CLASS, `${ MENU_CLASS }--flyout` );
		( fly as HTMLElement ).dataset.parentId = parent.id;

		const sortedKids = ( parent.children ?? [] ).slice().sort( ( a, b ) => {
			const sa = typeof a.sort === 'number' ? a.sort : 100;
			const sb = typeof b.sort === 'number' ? b.sort : 100;
			if ( sa !== sb ) {
				return sa - sb;
			}
			return a.label.localeCompare( b.label );
		} );

		for ( const child of sortedKids ) {
			const kopt = document.createElement( 'wpd-context-menu-option' );
			kopt.dataset.menuItemId = child.id;
			kopt.setAttribute( 'value', child.id );
			if ( child.icon ) {
				kopt.setAttribute( 'icon', sanitizeClass( child.icon ) );
			}
			if ( child.disabled ) {
				kopt.setAttribute( 'disabled', '' );
			}
			if ( child.checked ) {
				kopt.setAttribute( 'checked', '' );
			}
			kopt.textContent = child.label;
			kopt.addEventListener( 'wpd-context-menu-pick', ( e: Event ) => {
				e.stopPropagation();
				closeWallpaperMenu();
				void child.onClick( new MouseEvent( 'click' ) );
			} );
			fly.appendChild( kopt );
		}
		document.body.appendChild( fly );
		activeFlyout = fly;
		activeFlyoutParent = parent;
		positionFlyout( fly, anchor );
	}

	function positionFlyout( fly: HTMLElement, anchor: HTMLElement ): void {
		const ar = anchor.getBoundingClientRect();
		// Default: open to the right, top-aligned with anchor.
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

	host.appendChild( menu );
	activeMenu = menu;

	// Clamp to viewport so a click near the edge doesn't open
	// half-off-screen.
	const rect = menu.getBoundingClientRect();
	if ( rect.right > window.innerWidth ) {
		menu.style.left = `${ Math.max( 0, window.innerWidth - rect.width - 8 ) }px`;
	}
	if ( rect.bottom > window.innerHeight ) {
		menu.style.top = `${ Math.max( 0, window.innerHeight - rect.height - 8 ) }px`;
	}

	const detach = attachDismissable( menu, {
		close: () => closeWallpaperMenu(),
		siblingSelectors: [ `.${ MENU_CLASS }--flyout` ],
		excludeOutsideTarget: options.excludeOutsideTarget,
	} );
	menu.addEventListener( 'wallpaper-menu-closed', detach );

	doAction( 'desktop-mode.wallpaper-menu.opened', { items: items.map( ( i ) => i.id ) } );
}

/** Close the active menu (no-op when nothing is open). */
export function closeWallpaperMenu(): void {
	if ( ! activeMenu ) {
		return;
	}
	// Sweep any floating flyouts owned by this menu.
	document
		.querySelectorAll( `.${ MENU_CLASS }--flyout` )
		.forEach( ( el ) => el.remove() );
	activeMenu.dispatchEvent( new CustomEvent( 'wallpaper-menu-closed' ) );
	activeMenu.remove();
	activeMenu = null;
	doAction( 'desktop-mode.wallpaper-menu.closed', {} );
}

/**
 * Build the merged item list — built-ins ⊕ server items ⊕
 * filter — and run it through the filter so plugins can reorder,
 * hide, or splice in extras.
 */
export function buildMenuItems( deps: WallpaperMenuDeps ): WallpaperMenuItem[] {
	const builtIn: WallpaperMenuItem[] = [
		{
			id: 'create-folder',
			label: deps.labels.createFolder,
			icon: 'dashicons-portfolio',
			sort: 10,
			onClick: () => deps.createFolder(),
		},
		{
			id: 'new-url',
			label: deps.labels.newUrl,
			icon: 'dashicons-admin-links',
			sort: 12,
			onClick: () => deps.createUrl(),
		},
		{
			id: 'sort-by',
			label: deps.labels.sortHeading,
			icon: 'dashicons-sort',
			sort: 16,
			onClick: () => undefined,
			children: [
				{
					id: 'sort-name-asc',
					label: deps.labels.sortNameAsc,
					sort: 10,
					checked: deps.currentSortMode === 'name-asc',
					onClick: () => deps.sortIcons( 'name-asc' ),
				},
				{
					id: 'sort-name-desc',
					label: deps.labels.sortNameDesc,
					sort: 20,
					checked: deps.currentSortMode === 'name-desc',
					onClick: () => deps.sortIcons( 'name-desc' ),
				},
				{
					id: 'sort-date-desc',
					label: deps.labels.sortDateDesc,
					sort: 30,
					checked: deps.currentSortMode === 'date-desc',
					onClick: () => deps.sortIcons( 'date-desc' ),
				},
				{
					id: 'sort-date-asc',
					label: deps.labels.sortDateAsc,
					sort: 40,
					checked: deps.currentSortMode === 'date-asc',
					onClick: () => deps.sortIcons( 'date-asc' ),
				},
			],
		},
		...( deps.includeShowDesktop === false
			? []
			: [
					{
						id: 'show-desktop',
						label: deps.labels.showDesktop,
						icon: 'dashicons-desktop',
						sort: 20,
						onClick: () => deps.toggleShowDesktop(),
					} as WallpaperMenuItem,
			] ),
		{
			id: 'os-settings',
			label: deps.labels.osSettings,
			icon: 'dashicons-admin-generic',
			sort: 30,
			onClick: () => deps.openOsSettings(),
		},
		{
			id: 'wallpapers',
			label: deps.labels.wallpapers,
			icon: 'dashicons-format-image',
			sort: 40,
			onClick: () => deps.openWallpapers(),
		},
	];

	const serverItems: WallpaperMenuItem[] = ( deps.serverItems ?? [] ).map( ( s ) =>
		serverItemToMenuItem( s, deps ),
	);

	const merged = [ ...builtIn, ...serverItems ];
	const filtered = applyFilters< WallpaperMenuItem[], [] >(
		'desktop-mode.wallpaper-context-menu',
		merged,
	);
	return Array.isArray( filtered ) ? filtered : merged;
}

function serverItemToMenuItem(
	server: ServerWallpaperMenuItem,
	deps: WallpaperMenuDeps,
): WallpaperMenuItem {
	return {
		id: server.id,
		label: server.label,
		icon: server.icon,
		sort: server.sort,
		disabled: server.disabled,
		onClick: () => {
			if ( server.callbackId ) {
				const cb = deps.serverCallbacks?.[ server.callbackId ];
				if ( typeof cb === 'function' ) {
					return cb();
				}
			}
			// Plugins that didn't ship a JS callback fall through to
			// a doAction so they can subscribe in their own bundle.
			doAction( 'desktop-mode.wallpaper-context-menu.activated', {
				id: server.id,
				callbackId: server.callbackId ?? '',
			} );
		},
	};
}

export type SortMode = 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc';

export interface WallpaperMenuDeps {
	createFolder: () => void;
	createUrl: () => void;
	toggleShowDesktop: () => void;
	openOsSettings: () => void;
	openWallpapers: () => void;
	sortIcons: ( mode: SortMode ) => void;
	/**
	 * Currently-active sort mode, or `null` when the desktop is in
	 * free-placement mode (the user has dragged tiles manually). The
	 * matching Sort By submenu entry renders with a leading check
	 * so users see at a glance which order is auto-arranging.
	 */
	currentSortMode?: SortMode | null;
	/**
	 * Whether to render the built-in "Show desktop" entry. When `false`,
	 * the caller has wired the wallpaper's left-click to drive the same
	 * toggle (macOS-style) and the menu entry would be redundant.
	 * Default `true`.
	 */
	includeShowDesktop?: boolean;
	labels: {
		createFolder: string;
		showDesktop: string;
		osSettings: string;
		wallpapers: string;
		sortHeading: string;
		sortNameAsc: string;
		sortNameDesc: string;
		sortDateAsc: string;
		sortDateDesc: string;
		newUrl: string;
	};
	serverItems?: ServerWallpaperMenuItem[];
	serverCallbacks?: Record< string, () => void | Promise< void > >;
}

function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
