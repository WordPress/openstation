import type { DesktopIconServerEntry, DockItemConfig } from './types';
import {
	Dock,
	type DockEntry,
	type DockItem,
	type DockZones,
	type SystemDockItem,
} from './dock';
import {
	defaultDockRailRenderer,
	resolveActiveDockRailRenderer,
	subscribeDockRailRenderers,
	unwrapDefaultDock,
	type DockRailController,
	type DockRailMountDeps,
} from './dock-rail';
import type { WindowManager } from './window-manager';
import { deriveWindowId } from './utils';
import { resolveNativeUrlRemap } from './native-url-remap';
import { tryOpenExternalUrl } from './external-url';
import { tryNativeUrlRemap } from './native-url-remap';
import type {
	DesktopLayoutId,
	DockPlacementId,
	OsSettingsState,
} from './settings/types';
import {
	buildNavItems,
	computeNav,
	NAV_ZONES,
	type NavItem,
	type NavResult,
	type NavSystemTile,
	type OpenWindow,
} from './nav';
import { doAction, HOOKS } from './hooks';

import type { WorkspaceProfile } from './workspaces/types';
import { workspacePlacements } from './workspaces/visibility';

export interface LayoutDispatcherDeps {

	shellRoot: HTMLElement;

	shellBody: HTMLElement;

	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
	windowManager: WindowManager;
	adminUrl: string;

	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;

	getSettings?: () => Pick< OsSettingsState, 'navPlacement' | 'navOrder' >;

	getWorkspaceProfile?: () => WorkspaceProfile | null;
}

export interface LayoutDispatcher {

	getLayout(): DesktopLayoutId;

	getPrimary(): Dock | null;

	getSide(): Dock | null;

	setLayout( layout: DesktopLayoutId ): void;

	getDockPlacement(): DockPlacementId;

	setDockPlacement( placement: DockPlacementId ): void;

	applyDockItems( items: DockItem[] ): void;

	applyDesktopIcons( serverIcons: DesktopIconServerEntry[] | undefined ): void;

	appendSystemTile( item: SystemDockItem ): void;

	removeSystemTile( id: string ): void;

	listSystemTiles(): Array< {
		id: string;
		title: string;
		icon: string;
		navKind: 'core' | 'app' | 'control';

		placeable: boolean;
		locked: boolean;
	} >;

	getSystemTile( id: string ): SystemDockItem | null;

	getMenuItems(): DockItem[];

	getNavItems(): NavItem[];

	getNav(): NavResult;

	refresh(): void;

	destroy(): void;
}

const SIDE_DOCK_ID = 'os-side-dock';

export function createLayoutDispatcher(
	deps: LayoutDispatcherDeps,
	initialLayout: DesktopLayoutId,
	initialDockItems: DockItem[],
	initialServerIcons: DesktopIconServerEntry[] | undefined,
	initialPlacement: DockPlacementId = 'bottom',
): LayoutDispatcher {
	let layout: DesktopLayoutId = initialLayout;

	let dockPlacement: DockPlacementId = initialPlacement;
	let menuItems: DockItem[] = initialDockItems;
	let serverIcons: DesktopIconServerEntry[] = initialServerIcons ?? [];

	let primary: DockRailController | null = null;
	let side: DockRailController | null = null;
	let primaryDock: Dock | null = null;
	let sideDock: Dock | null = null;
	let sideDockEl: HTMLElement | null = null;

	const systemTiles = new Map< string, SystemDockItem >();

	let navItems: NavItem[] = [];
	let nav: NavResult = computeNav( {
		items: [],
		config: { placement: {}, order: [] },
		layout,
		openWindows: [],
	} );

	const readSettings = (): Pick<
		OsSettingsState,
		'navPlacement' | 'navOrder'
	> => deps.getSettings?.() ?? { navPlacement: {}, navOrder: [] };

	const openWindows = (): OpenWindow[] => {
		const active = deps.windowManager.getActiveDesktopId();
		const out: OpenWindow[] = [];
		const seen = new Set< string >();
		for ( const win of deps.windowManager.getAll() ) {
			if ( ( win.config.desktopId || active ) !== active ) {
				continue;
			}
			const id = win.config.baseId || win.id;
			if ( seen.has( id ) ) {
				continue;
			}
			seen.add( id );
			out.push( {
				id,
				title: win.config.title || id,
				icon: win.config.icon || 'dashicons-admin-generic',

				fromAdminUrl: true !== win.config.native,
			} );
		}
		return out;
	};

	const resolveMenuWindowId = ( item: DockItem ): string => {
		if ( item.windowId ) {
			return item.windowId;
		}
		return (
			resolveNativeUrlRemap( item.url ) ??
			deriveWindowId( item.url, deps.adminUrl )
		);
	};

	const recompute = (): void => {
		const tiles: NavSystemTile[] = [];
		for ( const item of systemTiles.values() ) {
			tiles.push( {
				item,
				kind: item.navKind ?? 'app',
				locked: item.locked,
			} );
		}
		navItems = buildNavItems( {
			menuItems,
			systemTiles: tiles,
			icons: serverIcons,
			resolveMenuWindowId,
		} );
		const settings = readSettings();
		nav = computeNav( {
			items: navItems,
			config: {

				placement: workspacePlacements(
					settings.navPlacement,
					navItems,
					deps.getWorkspaceProfile?.() ?? null,
				),
				order: settings.navOrder,
			},
			layout,
			openWindows: openWindows(),
		} );
	};

	const toDockEntry = ( item: NavItem ): DockEntry => {
		if ( item.tile ) {
			return { type: 'system', item: item.tile };
		}
		if ( item.menu ) {
			return {
				type: 'menu',
				item: item.windowId
					? { ...item.menu, windowId: item.windowId }
					: item.menu,
			};
		}
		return {
			type: 'menu',
			item: {
				id: item.id,
				title: item.title,
				icon: item.icon,
				url: item.entry?.url || '',
				windowId: item.windowId,
				badge: 0,
				submenu: [],
				isCore: false,
			},
		};
	};

	const openableFromIconGrid = ( item: NavItem ): boolean =>
		!! item.entry || !! item.windowId || !! item.menu?.url;

	const toIconEntry = (
		item: NavItem,
		index: number,
	): DesktopIconServerEntry => {
		if ( item.entry ) {
			return item.entry;
		}
		return {
			id: item.id,
			title: item.title,
			icon: item.icon,
			window: item.windowId ?? '',
			url: item.menu?.url || '',

			position: 2000 + index,
		};
	};

	const toZones = ( zones: Record< string, NavItem[] > ): DockZones => ( {
		core: ( zones.core ?? [] ).map( toDockEntry ),
		apps: ( zones.apps ?? [] ).map( toDockEntry ),
		controls: ( zones.controls ?? [] ).map( toDockEntry ),
	} );

	const applyToRail = (
		controller: DockRailController | null,
		zones: DockZones,
		attached: Set< string >,
	): void => {
		if ( ! controller ) {
			return;
		}
		if ( controller.setZones ) {
			controller.setZones( zones );
			attached.clear();
			for ( const zone of NAV_ZONES ) {
				for ( const entry of zones[ zone ] ) {
					if ( 'system' === entry.type ) {
						attached.add( entry.item.id );
					}
				}
			}
			return;
		}
		const menu: DockItem[] = [];
		const wanted = new Set< string >();
		for ( const zone of NAV_ZONES ) {
			for ( const entry of zones[ zone ] ) {
				if ( 'menu' === entry.type ) {
					menu.push( entry.item );
				} else {
					wanted.add( entry.item.id );
				}
			}
		}
		controller.replaceItems( menu );
		for ( const id of Array.from( attached ) ) {
			if ( ! wanted.has( id ) ) {
				controller.removeSystemItem( id );
				attached.delete( id );
			}
		}
		for ( const zone of NAV_ZONES ) {
			for ( const entry of zones[ zone ] ) {
				if ( 'system' === entry.type && ! attached.has( entry.item.id ) ) {
					controller.appendSystemItem( entry.item );
					attached.add( entry.item.id );
				}
			}
		}
	};

	const attachedOnPrimary = new Set< string >();
	const attachedOnSide = new Set< string >();

	const paint = (): void => {
		recompute();
		applyToRail( primary, toZones( nav.dock ), attachedOnPrimary );
		applyToRail(
			side,
			{ core: nav.sidebar.map( toDockEntry ), apps: [], controls: [] },
			attachedOnSide,
		);
		deps.renderIcons(
			nav.desktop.filter( openableFromIconGrid ).map( toIconEntry ),
		);
	};

	const ephemeralSignature = (): string =>
		Array.from( nav.ephemeral ).sort().join( ',' );

	const ensureSideDockEl = (): HTMLElement => {
		const existing = document.getElementById(
			SIDE_DOCK_ID,
		) as HTMLElement | null;
		if ( existing ) {
			return existing;
		}
		const el = document.createElement( 'nav' );
		el.id = SIDE_DOCK_ID;
		el.className = 'os-dock';
		el.setAttribute( 'role', 'toolbar' );
		el.setAttribute( 'aria-label', 'Core admin navigation' );

		deps.shellBody.insertBefore( el, deps.shellBody.firstChild );
		return el;
	};

	const removeSideDockEl = (): void => {
		if ( sideDockEl && sideDockEl.parentNode ) {
			sideDockEl.parentNode.removeChild( sideDockEl );
		}
		sideDockEl = null;
	};

	const tearDownDocks = (): void => {
		if ( primary ) {
			try {
				primary.destroy();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'dock-rail-renderer/destroy',
					error: err,
				} );
			}
			primary = null;
			primaryDock = null;
		}
		if ( side ) {
			try {
				side.destroy();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'dock-rail-renderer/destroy',
					error: err,
				} );
			}
			side = null;
			sideDock = null;
		}
		attachedOnPrimary.clear();
		attachedOnSide.clear();
	};

	const mountRail = (
		mountDeps: DockRailMountDeps,
	): DockRailController | null => {
		const renderer = resolveActiveDockRailRenderer();
		if ( ! renderer ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'dock-rail-renderer',
				message: 'No dock rail renderer is registered.',
			} );
			return null;
		}
		try {
			return renderer.mount( mountDeps );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'dock-rail-renderer/mount',
				rendererId: renderer.id,
				error: err,
			} );

			if ( renderer === defaultDockRailRenderer ) {
				return null;
			}
			try {
				return defaultDockRailRenderer.mount( mountDeps );
			} catch {
				return null;
			}
		}
	};

	const buildMountDeps = (
		container: HTMLElement,
		orientation: 'left' | 'right' | 'bottom',
	): DockRailMountDeps => ( {
		container,

		items: [],

		fullMenu: menuItems.slice(),

		fullSystemTiles: navItems
			.filter( ( item ) => !! item.tile )
			.filter( ( item ) => railHasItem( item.id ) )
			.map( ( item ) => item.tile as SystemDockItem ),
		orientation,
		windowManager: deps.windowManager,
		adminUrl: deps.adminUrl,

		openItem: ( item ) => {
			if ( tryOpenExternalUrl( item.url ) ) {
				return;
			}

			if ( tryNativeUrlRemap( item.url ) ) {
				return;
			}
			const baseId = deriveWindowId( item.url, deps.adminUrl );
			deps.windowManager.open( {
				id: baseId,
				baseId,
				url: item.url,
				parentUrl: item.url,
				title: item.title,
				icon: item.icon.startsWith( 'dashicons-' )
					? item.icon
					: 'dashicons-admin-generic',
				submenu: item.submenu,
				selfLabel: item.selfLabel,
				multi: !! item.multi,
			} );
		},
		openSubmenuPick: ( item, sub ) => {
			if ( tryOpenExternalUrl( sub.url ) ) {
				return;
			}
			if ( tryNativeUrlRemap( sub.url, { newInstance: true } ) ) {
				return;
			}

			void deps.windowManager.openNew( {
				id: deriveWindowId( sub.url, deps.adminUrl ),
				baseId: deriveWindowId( item.url, deps.adminUrl ),
				url: sub.url,

				parentUrl: item.url,
				title: item.title,
				icon: item.icon.startsWith( 'dashicons-' )
					? item.icon
					: 'dashicons-admin-generic',
				submenu: item.submenu,
				selfLabel: item.selfLabel,
				multi: !! item.multi,
			} );
		},
		openSystemItem: ( item ) => item.onOpen(),
	} );

	const railHasItem = ( id: string ): boolean => {
		for ( const zone of NAV_ZONES ) {
			if ( nav.dock[ zone ].some( ( item ) => item.id === id ) ) {
				return true;
			}
		}
		return nav.sidebar.some( ( item ) => item.id === id );
	};

	const primaryOrientation = (): DockPlacementId =>
		layout === 'classic' ? 'bottom' : dockPlacement;

	const buildDocksForCurrentLayout = (): void => {
		tearDownDocks();
		recompute();

		if ( layout === 'classic' ) {
			sideDockEl = ensureSideDockEl();
			side = mountRail( buildMountDeps( sideDockEl, 'left' ) );
			sideDock = unwrapDefaultDock( side );
		} else {
			removeSideDockEl();
		}
		primary = mountRail(
			buildMountDeps( deps.bottomDockEl, primaryOrientation() ),
		);
		primaryDock = unwrapDefaultDock( primary );

		paint();
	};

	const emitLayoutChanged = (): void => {
		document.dispatchEvent(
			new CustomEvent( 'os-layout-changed', {
				detail: {
					layout,
					placement: primaryOrientation(),
					primary: primaryDock,
					side: sideDock,
				},
			} ),
		);
	};

	const dispatcher: LayoutDispatcher = {
		getLayout: () => layout,
		getPrimary: () => primaryDock,
		getSide: () => sideDock,
		setLayout: ( next: DesktopLayoutId ): void => {
			if ( next === layout ) {
				return;
			}
			layout = next;
			deps.shellRoot.setAttribute( 'data-os-layout', next );
			buildDocksForCurrentLayout();
			emitLayoutChanged();
		},
		getDockPlacement: () => dockPlacement,
		setDockPlacement: ( next: DockPlacementId ): void => {
			if ( next === dockPlacement ) {
				return;
			}
			const wasHonoured = primaryOrientation();
			dockPlacement = next;

			if ( primaryOrientation() === wasHonoured ) {
				return;
			}
			buildDocksForCurrentLayout();

			emitLayoutChanged();
		},
		applyDockItems: ( next: DockItem[] ): void => {
			menuItems = next;
			paint();
		},
		applyDesktopIcons: (
			next: DesktopIconServerEntry[] | undefined,
		): void => {
			serverIcons = next ?? [];
			paint();
		},
		appendSystemTile: ( item: SystemDockItem ): void => {
			systemTiles.set( item.id, item );
			paint();
		},
		removeSystemTile: ( id: string ): void => {
			if ( ! systemTiles.delete( id ) ) {
				return;
			}
			paint();
		},
		listSystemTiles: () =>
			Array.from( systemTiles.values() ).map( ( item ) => ( {
				id: item.id,
				title: item.title,
				icon: item.icon,
				navKind: item.navKind ?? 'app',
				placeable: item.placeable === true,
				locked: item.locked === true,
			} ) ),
		getSystemTile: ( id: string ): SystemDockItem | null =>
			systemTiles.get( id ) ?? null,
		getMenuItems: () => menuItems.slice(),
		getNavItems: () => navItems.slice(),
		getNav: () => nav,
		refresh: paint,
		destroy: (): void => {
			tearDownDocks();
			removeSideDockEl();
		},
	};

	for ( const event of [ 'os-window-opened', 'os-window-closed' ] ) {
		document.addEventListener( event, () => {
			const before = ephemeralSignature();
			recompute();
			if ( ephemeralSignature() === before ) {
				return;
			}
			paint();
		} );
	}

	deps.shellRoot.setAttribute( 'data-os-layout', layout );
	buildDocksForCurrentLayout();

	let lastResolvedId = resolveActiveDockRailRenderer()?.id ?? null;
	subscribeDockRailRenderers( () => {
		const nextId = resolveActiveDockRailRenderer()?.id ?? null;
		if ( nextId === lastResolvedId ) {
			return;
		}
		lastResolvedId = nextId;
		buildDocksForCurrentLayout();
		emitLayoutChanged();
	} );

	return dispatcher;
}

export type { DockItemConfig };
