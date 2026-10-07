import { applyFilters, doAction } from '../hooks';

import { openWithShellOverlays } from '../shell-overlays/loader';
import { clampToViewport, positionFlyout } from '../ui/util/menu-position';
import { attachDismissable } from './dismissable';

export interface WallpaperMenuContext {
	x: number;
	y: number;
}

export interface WallpaperMenuItem {

	id: string;

	label: string;

	icon?: string;

	sort?: number;

	disabled?: boolean;

	heading?: boolean;

	children?: WallpaperMenuItem[];

	checked?: boolean;

	onClick: ( e: MouseEvent ) => void | Promise< void >;
}

export interface ServerWallpaperMenuItem {
	id: string;
	label: string;
	icon?: string;
	sort?: number;
	disabled?: boolean;

	callbackId?: string;
}

const MENU_CLASS = 'os-wallpaper-menu';

let activeMenu: HTMLElement | null = null;

export interface OpenWallpaperMenuOptions {

	excludeOutsideTarget?: HTMLElement;
}

export function isWallpaperMenuOpen(): boolean {
	return activeMenu !== null;
}

let openGeneration = 0;

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

	const menu = document.createElement( 'os-context-menu' );
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
		const opt = document.createElement( 'os-context-menu-option' );
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

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;
		const item = itemById.get( detail.id ) ?? null;
		if ( ! item ) {
			return;
		}
		if ( Array.isArray( item.children ) && item.children.length > 0 ) {
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
		const fly = document.createElement( 'os-context-menu' );
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
			const kopt = document.createElement( 'os-context-menu-option' );
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
			kopt.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
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

	host.appendChild( menu );
	activeMenu = menu;

	clampToViewport( menu );

	const detach = attachDismissable( menu, {
		close: () => closeWallpaperMenu(),
		siblingSelectors: [ `.${ MENU_CLASS }--flyout` ],
		excludeOutsideTarget: options.excludeOutsideTarget,
	} );
	menu.addEventListener( 'wallpaper-menu-closed', detach );

	doAction( 'os.wallpaper-menu.opened', { items: items.map( ( i ) => i.id ) } );
}

export function closeWallpaperMenu(): void {
	if ( ! activeMenu ) {
		return;
	}

	document
		.querySelectorAll( `.${ MENU_CLASS }--flyout` )
		.forEach( ( el ) => el.remove() );
	activeMenu.dispatchEvent( new CustomEvent( 'wallpaper-menu-closed' ) );
	activeMenu.remove();
	activeMenu = null;
	doAction( 'os.wallpaper-menu.closed', {} );
}

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
			id: 'add-widget',
			label: deps.labels.addWidget,
			icon: 'dashicons-screenoptions',

			sort: 15,
			onClick: () => deps.addWidget(),
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
	];

	const serverItems: WallpaperMenuItem[] = ( deps.serverItems ?? [] ).map( ( s ) =>
		serverItemToMenuItem( s, deps ),
	);

	const merged = [ ...builtIn, ...serverItems ];
	const filtered = applyFilters<
		WallpaperMenuItem[],
		[ WallpaperMenuContext ]
	>( 'os.wallpaper-context-menu', merged, {
		x: deps.position?.x ?? 0,
		y: deps.position?.y ?? 0,
	} );
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

			doAction( 'os.wallpaper-context-menu.activated', {
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

	addWidget: () => void;
	toggleShowDesktop: () => void;
	openOsSettings: () => void;
	sortIcons: ( mode: SortMode ) => void;

	currentSortMode?: SortMode | null;

	includeShowDesktop?: boolean;

	position?: { x: number; y: number };
	labels: {
		createFolder: string;
		showDesktop: string;
		osSettings: string;
		sortHeading: string;
		sortNameAsc: string;
		sortNameDesc: string;
		sortDateAsc: string;
		sortDateDesc: string;
		newUrl: string;
		addWidget: string;
	};
	serverItems?: ServerWallpaperMenuItem[];
	serverCallbacks?: Record< string, () => void | Promise< void > >;
}

function sanitizeClass( raw: string ): string {
	return raw.replace( /[^a-zA-Z0-9_-]/g, '' );
}
