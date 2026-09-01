/**
 * Desktop-layout dispatcher.
 *
 * Owns the rails across the two layouts the user can pick in
 * OpenStation Preferences → Appearance:
 *
 * - **Unified** — one dock on the edge `dockPlacement` names, holding
 *   all three zones: WordPress's own admin menus, then apps, then
 *   OpenStation's controls.
 * - **Split** (stored as `classic`) — a sidebar on the left holding
 *   WordPress's admin menus and nothing else, plus the dock holding
 *   the other two zones.
 *
 * The dispatcher does not decide any of that. It collects the four
 * registration paths into a flat {@link NavItem} list, hands them to
 * {@link computeNav} along with the user's preferences and the set of
 * open windows, and paints the answer. Every rule about where a thing
 * shows up lives in `src/nav/`, which is why the sidebar and the dock
 * can no longer disagree about one.
 *
 * Lives separate from `desktop.ts` so it is testable without booting
 * the whole shell.
 */

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

/** External wiring the dispatcher needs from the shell boot path. */
export interface LayoutDispatcherDeps {
	/** Outermost shell root — receives `data-os-layout`. */
	shellRoot: HTMLElement;
	/**
	 * `.os-shell__body` flex row that hosts the sidebar and the
	 * desktop area. The sidebar is inserted as the first child here so
	 * its CSS `order: -1` paints it on the leading edge.
	 */
	shellBody: HTMLElement;
	/**
	 * Existing `#os-dock` element from the PHP shell template. Hosts
	 * the dock on whichever edge is in play — the name is historical,
	 * `bottom` is only its default placement.
	 */
	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
	windowManager: WindowManager;
	adminUrl: string;
	/** Repaint the desktop-icons grid. */
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;
	/**
	 * Read the user's navigation preferences. Consulted on every
	 * repaint so a settings change lands without the call site having
	 * to thread the snapshot through.
	 */
	getSettings?: () => Pick< OsSettingsState, 'navPlacement' | 'navOrder' >;
}

/**
 * Public surface mirrored on the shell so the menu-refresh pipeline
 * and other shell modules don't reach for the underlying `Dock`
 * references directly.
 */
export interface LayoutDispatcher {
	/** Currently-active layout. Mirrors `state.desktopLayout`. */
	getLayout(): DesktopLayoutId;
	/** Dock instance. Always present once `setLayout` has run. */
	getPrimary(): Dock | null;
	/** Sidebar instance. Non-null only in the split layout. */
	getSide(): Dock | null;
	/**
	 * Switch layouts. Tears down existing rails (and any synthesized
	 * sidebar element), creates fresh ones, repaints the wallpaper.
	 *
	 * Idempotent. Plugins that cache `wp.os.dock` should listen for
	 * `os-layout-changed` on `document` and refresh their reference.
	 */
	setLayout( layout: DesktopLayoutId ): void;
	/**
	 * The edge the dock sits on. Mirrors `state.dockPlacement`
	 * whatever the layout is — the split layout keeps the user's pick
	 * stored without acting on it, so switching back lands on the edge
	 * they chose rather than resetting to the bottom.
	 */
	getDockPlacement(): DockPlacementId;
	/**
	 * Move the dock to another edge. Same full rebuild as
	 * `setLayout` — the placement is passed to the renderer at
	 * `mount()` time, so a rail cannot be re-oriented without one.
	 *
	 * A no-op in the split layout beyond storing the value: its
	 * sidebar already owns the left edge, and honouring the pick would
	 * stack both rails on top of each other.
	 */
	setDockPlacement( placement: DockPlacementId ): void;
	/** Replace the admin-menu list. */
	applyDockItems( items: DockItem[] ): void;
	/** Replace the server-registered desktop-icons list. */
	applyDesktopIcons( serverIcons: DesktopIconServerEntry[] | undefined ): void;
	/**
	 * Append a JS-owned system tile — a native window's launcher, or
	 * one of the shell's own affordances. The tile is tracked so it
	 * survives layout changes.
	 *
	 * Where it lands is not this call's decision: the tile's
	 * {@link SystemDockItem.navKind} says what it IS, and the
	 * navigation model takes it from there. Calling twice with the
	 * same id replaces the previous tile.
	 */
	appendSystemTile( item: SystemDockItem ): void;
	/** Remove a previously-appended system tile by id. */
	removeSystemTile( id: string ): void;
	/**
	 * Snapshot of every registered system tile. Read-only entry view —
	 * use {@link getSystemTile} to fetch the underlying
	 * `SystemDockItem` with its `onOpen` / `isOpen` callbacks.
	 */
	listSystemTiles(): Array< {
		id: string;
		title: string;
		icon: string;
		navKind: 'core' | 'app' | 'control';
		/** Whether the tile opts into the Navigation preferences list. */
		placeable: boolean;
		locked: boolean;
	} >;
	/**
	 * Look up a system tile by id. Returns the underlying
	 * `SystemDockItem` so callers can invoke `onOpen()` directly.
	 * Returns `null` for unknown ids.
	 */
	getSystemTile( id: string ): SystemDockItem | null;
	/**
	 * Snapshot of the complete admin-menu list — every item, whatever
	 * rail it is painted on. Custom rail renderers that want to ignore
	 * the layout's partitioning read this.
	 */
	getMenuItems(): DockItem[];
	/**
	 * Every navigable thing the shell knows about, whatever surface it
	 * is currently on. What OpenStation Preferences → Navigation lists.
	 */
	getNavItems(): NavItem[];
	/**
	 * The current computed navigation — which zone holds what, which
	 * rail an item is on, and which tiles are present only because
	 * their window is open. What the right-click menu reads to label
	 * itself.
	 */
	getNav(): NavResult;
	/** Repaint every rail and the wallpaper from current state. */
	refresh(): void;
	/** Tear down all rails. Called on shell unload (or in tests). */
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
	// Named for the setting rather than shortened to `placement`: this
	// file also calls an item's rail-vs-desktop visibility a placement,
	// and the two are unrelated.
	let dockPlacement: DockPlacementId = initialPlacement;
	let menuItems: DockItem[] = initialDockItems;
	let serverIcons: DesktopIconServerEntry[] = initialServerIcons ?? [];
	// Two-tier storage: controllers drive every live update (built
	// from `renderer.mount()`), and the unwrapped Dock instances are
	// kept alongside ONLY when the active renderer is the built-in
	// `'default'`. The Dock references back the public `wp.os.dock`
	// / `wp.os.sideDock` API surface unchanged; custom-renderer
	// controllers expose null there.
	let primary: DockRailController | null = null;
	let side: DockRailController | null = null;
	let primaryDock: Dock | null = null;
	let sideDock: Dock | null = null;
	let sideDockEl: HTMLElement | null = null;
	// System tiles tracked here so they survive layout rebuilds, in
	// insertion order.
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

	/**
	 * Windows open on the active desktop, one entry per app rather
	 * than per instance. Read fresh rather than cached: the answer
	 * changes on every open and close.
	 */
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
				// A native window renders into the body; only an iframe
				// window is an admin page. `url` is not the signal —
				// the shell defaults an absent native url to `#<id>`,
				// so every window has one.
				fromAdminUrl: true !== win.config.native,
			} );
		}
		return out;
	};

	/**
	 * The window-manager key an admin menu opens under.
	 *
	 * Menus whose URL a native window has claimed (the Posts window
	 * under `nativePostsEnabled`, and its siblings) open under the
	 * native id rather than the derived one, so the running indicator
	 * has to ask the same question the tile's click does. Resolved
	 * here rather than inside `src/nav/`, which has no business
	 * knowing about the remap layer.
	 */
	const resolveMenuWindowId = ( item: DockItem ): string => {
		if ( item.windowId ) {
			return item.windowId;
		}
		return (
			resolveNativeUrlRemap( item.url ) ??
			deriveWindowId( item.url, deps.adminUrl )
		);
	};

	/** Recompute the navigation from current state. */
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
				placement: settings.navPlacement,
				order: settings.navOrder,
			},
			layout,
			openWindows: openWindows(),
		} );
	};

	/**
	 * A rail entry for one nav item.
	 *
	 * An item backed by a system tile paints as one, because the tile
	 * carries the `onOpen` / `isOpen` callbacks the rail needs. An item
	 * backed only by a registered desktop icon has no tile, so one is
	 * built from the icon — carrying `windowId` forward, without which
	 * the active dot and hover-peek would look up `deriveWindowId('')`
	 * and match nothing.
	 */
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

	/**
	 * A wallpaper icon for one nav item. Items registered as icons
	 * keep their own entry — position, `pinned`, and all — and only a
	 * menu or a tile the user promoted needs one synthesized.
	 */
	/**
	 * Whether the wallpaper-icon grid can open this item.
	 *
	 * That grid opens a window id or a url and knows nothing else, so
	 * a tile whose only opener is its own `onOpen` (Mio's toggles the
	 * companion rather than opening anything) would paint an icon that
	 * does nothing. The files layer is the surface that can run it,
	 * through `shortcutSystemTile`, and it is the surface the user
	 * actually sees; the grid is the fallback for shells with no files
	 * layer mounted, and a fallback is better one icon short than one
	 * dead icon long.
	 */
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
			// After every server-registered icon, in nav order.
			position: 2000 + index,
		};
	};

	const toZones = ( zones: Record< string, NavItem[] > ): DockZones => ( {
		core: ( zones.core ?? [] ).map( toDockEntry ),
		apps: ( zones.apps ?? [] ).map( toDockEntry ),
		controls: ( zones.controls ?? [] ).map( toDockEntry ),
	} );

	/**
	 * Push a rail's contents to its controller.
	 *
	 * `setZones` is the one write path for renderers that speak zones
	 * — the built-in one, and any renderer written against the current
	 * contract. Older renderers get the legacy shape: a flat menu list
	 * plus system tiles appended and removed one at a time. They lose
	 * nothing except a plugin menu and an app launcher being able to
	 * share a zone, which their layout had no way to express anyway.
	 */
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

	/** Recompute and repaint every surface. */
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

	/**
	 * Whether a window opening or closing changed which tiles the rail
	 * shows — not merely which dots are lit, which the rails handle
	 * themselves.
	 *
	 * Opening a window is the single most common thing that happens in
	 * the shell, and rebuilding the rail each time would discard hover
	 * state and cancel an in-flight drag. So the listener compares the
	 * ephemeral set and repaints only for the handful of opens and
	 * closes that involve an app with no home on a rail.
	 */
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
		// Insert as the first child of `.os-shell__body` so the
		// existing `order: -1` left-placement CSS paints it on the
		// leading edge regardless of source order in the markup.
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

	/**
	 * Mount the active renderer onto a container. Wrapped in
	 * try/catch with fallback to the built-in `'default'` renderer
	 * — a buggy plugin renderer can't kill the dock.
	 */
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
			// Fall back: if the user's pick crashed, mount the
			// built-in default renderer directly so the rail is
			// never empty. We import the default by name (rather
			// than going through `resolveActive`) because the
			// active id still points at the broken renderer.
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

	/** Build mount-deps for one rail. */
	const buildMountDeps = (
		container: HTMLElement,
		orientation: 'left' | 'right' | 'bottom',
	): DockRailMountDeps => ( {
		container,
		// Rails mount empty: `paint()` fills them through the one write
		// path the moment the mount returns, so there is no second
		// place that decides what a rail holds.
		items: [],
		// `fullMenu` is the complete admin-menu list. Renderers that
		// want to ignore the layout's partitioning (e.g., paint
		// every menu item in one ring regardless of zone) read
		// this instead of `items`. Snapshot per-mount so a renderer
		// holding the array sees a stable list; live updates flow
		// through `replaceItems` / `setZones`.
		fullMenu: menuItems.slice(),
		// Same idea for system tiles — plugin-owned native-window
		// launchers, the shell's own controls. Lets a renderer apply
		// uniform treatment across both cohorts in one pass. Tiles the
		// user hid via Navigation preferences are excluded, matching
		// what the dispatcher paints.
		fullSystemTiles: navItems
			.filter( ( item ) => !! item.tile )
			.filter( ( item ) => railHasItem( item.id ) )
			.map( ( item ) => item.tile as SystemDockItem ),
		orientation,
		windowManager: deps.windowManager,
		adminUrl: deps.adminUrl,
		// `openItem` / `openSubmenuPick` / `openSystemItem` are
		// routing callbacks for custom renderers. They mirror
		// exactly what the default renderer (`Dock.openPage` /
		// `Dock.openSubmenuPick`) does internally — same
		// `deriveWindowId(url, adminUrl)` call, same window-
		// config shape — so a custom renderer addresses the same
		// window with the same id at runtime. Switching renderer
		// mid-session doesn't lose the user's open windows.
		openItem: ( item ) => {
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
			// A plugin's off-site child can't be iframed — hand it to
			// the browser, the same way the constellation row does.
			if ( tryOpenExternalUrl( sub.url ) ) {
				return;
			}
			deps.windowManager.open( {
				id: deriveWindowId( sub.url, deps.adminUrl ),
				baseId: deriveWindowId( item.url, deps.adminUrl ),
				url: sub.url,
				// Pin the synthetic parent tab to the dock landing
				// page, not to the sub-page the user picked. Without
				// this, a submenu-pick (e.g. clicking "Editor" inside
				// Appearance's submenu popover) would open at
				// site-editor.php with no way back to themes.php.
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

	/** Whether the current navigation paints `id` on any rail. */
	const railHasItem = ( id: string ): boolean => {
		for ( const zone of NAV_ZONES ) {
			if ( nav.dock[ zone ].some( ( item ) => item.id === id ) ) {
				return true;
			}
		}
		return nav.sidebar.some( ( item ) => item.id === id );
	};

	/**
	 * Which edge the dock mounts on.
	 *
	 * Unified follows the user's `dockPlacement`. The split layout is
	 * pinned to `'bottom'`: its sidebar already owns the left edge, so
	 * letting the dock move there would stack the two on top of each
	 * other. The pick is remembered either way.
	 */
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

		// Rails mount empty and are filled by the one write path below,
		// so a renderer only ever learns its contents from one place.
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
			// The split layout stores the pick and stops here — see
			// `primaryOrientation()`. Comparing the ORIENTATION rather
			// than the layout id keeps that in one place: when the edge
			// the rail actually mounts on hasn't moved, neither has
			// anything worth tearing down.
			if ( primaryOrientation() === wasHonoured ) {
				return;
			}
			buildDocksForCurrentLayout();
			// Same event as a layout change, and for the same reason:
			// the rails were destroyed and rebuilt, so every cached
			// `wp.os.dock` reference now points at a dead instance.
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

	// Document events rather than the hook bus: these fire for every
	// window regardless of who opened it, which is the point. Never
	// torn down, because the dispatcher outlives every layout rebuild
	// and there is exactly one of it.
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

	// Initial paint — set the shell attribute, build the rails, and
	// emit the icon list now so the user lands on a fully-rendered
	// shell before the first frame.
	deps.shellRoot.setAttribute( 'data-os-layout', layout );
	buildDocksForCurrentLayout();

	// Rebuild the rails when the active rail-renderer flips. The
	// registry notifies on every change (register / unregister /
	// setActive); we only rebuild when the resolved renderer id
	// changes — a plugin registering five renderers in a row only
	// produces one rebuild.
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

// `DockItemConfig` is re-exported only because TypeScript needs the
// import resolution for downstream `.d.ts` callers.
export type { DockItemConfig };
