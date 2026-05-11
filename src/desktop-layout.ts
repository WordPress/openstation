/**
 * Desktop-layout dispatcher.
 *
 * Owns the dock(s) and any synthesized desktop icons across the three
 * top-level layouts the user can pick in OS Settings → Appearance:
 *
 * - **Classic** — two `Dock` instances. The bottom dock holds plugin
 *   menus (`!isCore`). A side dock on the left edge holds core admin
 *   menus (`isCore`). Default for new installs.
 * - **Unified** — a single bottom `Dock` instance with every menu
 *   sharing one rail. (Pre-0.18.0 default; one-click away.)
 * - **Spatial** — a single bottom `Dock` instance with plugin menus
 *   only. Core menus are synthesized into desktop-icon entries and
 *   handed to `renderDesktopIcons` so they appear on the wallpaper.
 *
 * Two surfaces drive this module:
 *
 * 1. `setLayout( layout )` — full rebuild. Tears down current docks,
 *    creates new ones for the new layout, re-attaches the OS Settings
 *    system tile to the bottom rail, repaints desktop icons.
 * 2. `applyDockItems( items )` / `applyDesktopIcons( serverIcons )` —
 *    update paths used by the live menu-refresh pipeline. Same item
 *    list comes in; the dispatcher partitions it by `isCore` and pushes
 *    the right slice to each rail (and re-synthesizes core icons on
 *    the wallpaper for Spatial).
 *
 * Lives separate from `desktop.ts` so the partitioning logic is
 * testable without booting the whole shell.
 *
 * @since 0.18.0
 */

import type {
	DesktopIconServerEntry,
	DockItemConfig,
} from './types';
import { Dock, type DockItem, type SystemDockItem } from './dock';
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
import type { DesktopLayoutId } from './settings/types';
import { doAction, HOOKS } from './hooks';

/**
 * Where a system tile prefers to live. `'core'` follows the rail
 * that holds core admin menus (side bar in Classic, primary rail
 * elsewhere); `'plugin'` always lands on the primary rail with
 * plugin menus. Defaults to `'plugin'` so plugin-registered native-
 * window tiles continue to sit alongside other plugin entries.
 */
export type SystemTileAffinity = 'core' | 'plugin';

/** External wiring the dispatcher needs from the shell boot path. */
export interface LayoutDispatcherDeps {
	/** Outermost shell root — receives `data-desktop-mode-layout`. */
	shellRoot: HTMLElement;
	/**
	 * `.desktop-mode-shell__body` flex row that hosts the side dock and
	 * the desktop area. The side dock (Classic) is inserted as the
	 * first child here so its CSS `order: -1` paints it on the left.
	 */
	shellBody: HTMLElement;
	/** Existing `#desktop-mode-dock` element from the PHP shell template. */
	bottomDockEl: HTMLElement;
	desktopArea: HTMLElement;
	windowManager: WindowManager;
	adminUrl: string;
	/**
	 * Repaint the desktop-icons grid with a (possibly augmented) list.
	 * The dispatcher hands the union of server-registered icons +
	 * synthesized core menu icons (Spatial only).
	 */
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;
}

/**
 * Public surface mirrored on the shell so the menu-refresh pipeline
 * and other shell modules don't have to reach for the underlying
 * `Dock` references directly.
 */
export interface LayoutDispatcher {
	/** Currently-active layout. Mirrors `state.desktopLayout`. */
	getLayout(): DesktopLayoutId;
	/** Bottom dock instance. Always present once `setLayout` has run. */
	getPrimary(): Dock | null;
	/** Side (left) dock instance. Non-null only in Classic. */
	getSide(): Dock | null;
	/**
	 * Switch to a new layout. Tears down existing docks (and any
	 * synthesized side-dock element), creates fresh ones, re-attaches
	 * the OS Settings tile, repaints the wallpaper-icon grid.
	 *
	 * Idempotent: passing the current layout is a no-op. Plugins that
	 * cache `wp.desktop.dock` should listen for `desktop-mode-layout-
	 * changed` on `document` and refresh their reference.
	 */
	setLayout( layout: DesktopLayoutId ): void;
	/**
	 * Replace the dock-items list across whichever rails are live.
	 * Items with `isCore === true` route to the side dock in Classic
	 * and to the wallpaper-icon grid in Spatial; all other layouts
	 * push every item to the single bottom rail.
	 */
	applyDockItems( items: DockItem[] ): void;
	/**
	 * Replace the server-registered desktop-icons list. Stored so the
	 * dispatcher can re-emit a merged list (server icons + synthesized
	 * core icons) on every Spatial repaint.
	 */
	applyDesktopIcons( serverIcons: DesktopIconServerEntry[] | undefined ): void;
	/**
	 * Append a JS-owned "system" tile. The tile is tracked so it
	 * survives layout changes — every rebuild re-attaches the
	 * tracked set in registration order. Calling twice with the same
	 * id replaces the previous tile (idempotent).
	 *
	 * `affinity` controls which rail the tile lives on:
	 *
	 * - `'plugin'` *(default)* — always lands on the primary (bottom)
	 *   dock alongside plugin admin menus. Used by plugin-registered
	 *   native-window tiles.
	 * - `'core'` — lands on the side dock when one exists (Classic
	 *   layout, alongside core admin menus); falls back to the primary
	 *   dock in Unified and Spatial where there is no side rail. Used
	 *   by shell-owned affordances like OS Settings.
	 */
	appendSystemTile(
		item: SystemDockItem,
		affinity?: SystemTileAffinity,
	): void;
	/** Remove a previously-appended system tile by id. */
	removeSystemTile( id: string ): void;
	/**
	 * Snapshot of every system tile registered across both rails.
	 * Read-only entry view ({ id, title, icon, affinity }) — use
	 * {@link getSystemTile} to fetch the underlying `SystemDockItem`
	 * with its `onOpen` / `isOpen` callbacks.
	 *
	 * @since 0.18.0
	 */
	listSystemTiles(): Array< {
		id: string;
		title: string;
		icon: string;
		affinity: SystemTileAffinity;
	} >;
	/**
	 * Look up a system tile by id. Returns the underlying
	 * `SystemDockItem` so callers can invoke `onOpen()` directly.
	 * Returns `null` for unknown ids.
	 *
	 * @since 0.18.0
	 */
	getSystemTile( id: string ): SystemDockItem | null;
	/**
	 * Snapshot of the complete admin-menu list — the same data the
	 * dispatcher partitions across rails based on layout. Use this
	 * when a custom rail renderer needs the full picture (Classic
	 * layout's primary rail only sees `!isCore` items via
	 * mount-deps; this returns every item).
	 *
	 * @since 0.18.0
	 */
	getMenuItems(): DockItem[];
	/** Tear down all docks. Called on shell unload (or in tests). */
	destroy(): void;
}

const SIDE_DOCK_ID = 'desktop-mode-side-dock';

/**
 * Convert a core menu item into the icon-entry shape `renderDesktopIcons`
 * expects. Spatial mode renders these on the wallpaper in place of the
 * left side bar that Classic gives core menus.
 */
function coreItemToIconEntry(
	item: DockItem,
	index: number,
): DesktopIconServerEntry {
	return {
		id: `dock-core:${ item.id }`,
		title: item.title,
		icon: item.icon,
		window: '',
		url: item.url,
		// Synthesized icons render after server-registered ones; the
		// large offset leaves headroom for plugin authors who set
		// explicit `position` values.
		position: 1000 + index,
	};
}

export function createLayoutDispatcher(
	deps: LayoutDispatcherDeps,
	initialLayout: DesktopLayoutId,
	initialDockItems: DockItem[],
	initialServerIcons: DesktopIconServerEntry[] | undefined,
): LayoutDispatcher {
	let layout: DesktopLayoutId = initialLayout;
	let items: DockItem[] = initialDockItems;
	let serverIcons: DesktopIconServerEntry[] = initialServerIcons ?? [];
	// Two-tier storage: controllers drive every live update (built
	// from `renderer.mount()`), and the unwrapped Dock instances are
	// kept alongside ONLY when the active renderer is the built-in
	// `'default'`. The Dock references back the public `wp.desktop.dock`
	// / `wp.desktop.sideDock` API surface unchanged; custom-renderer
	// controllers expose null there. Plugin authors who want renderer-
	// agnostic access reach for the controller via the dispatcher.
	let primary: DockRailController | null = null;
	let side: DockRailController | null = null;
	let primaryDock: Dock | null = null;
	let sideDock: Dock | null = null;
	let sideDockEl: HTMLElement | null = null;
	// System tiles tracked here so they survive layout rebuilds. The
	// shell adds the OS Settings tile right after construction; native-
	// window registration adds plugin-owned tiles. Iteration is in
	// insertion order so re-attach matches the original visual order.
	// Each entry remembers its affinity so a `'core'` tile can route
	// to the side dock in Classic and to primary in Unified/Spatial.
	const systemTiles = new Map<
		string,
		{ item: SystemDockItem; affinity: SystemTileAffinity }
	>();

	const railFor = (
		affinity: SystemTileAffinity,
	): DockRailController | null => {
		if ( affinity === 'core' && side ) {
			return side;
		}
		return primary;
	};

	const ensureSideDockEl = (): HTMLElement => {
		const existing = document.getElementById(
			SIDE_DOCK_ID,
		) as HTMLElement | null;
		if ( existing ) {
			return existing;
		}
		const el = document.createElement( 'nav' );
		el.id = SIDE_DOCK_ID;
		el.className = 'desktop-mode-dock';
		el.setAttribute( 'role', 'toolbar' );
		el.setAttribute( 'aria-label', 'Core admin navigation' );
		// Insert as the first child of `.desktop-mode-shell__body` so
		// the existing `order: -1` left-placement CSS paints it on
		// the leading edge regardless of source order in the markup.
		deps.shellBody.insertBefore( el, deps.shellBody.firstChild );
		return el;
	};

	const removeSideDockEl = (): void => {
		if ( sideDockEl && sideDockEl.parentNode ) {
			sideDockEl.parentNode.removeChild( sideDockEl );
		}
		sideDockEl = null;
	};

	const partition = (): { core: DockItem[]; plugin: DockItem[] } => {
		const core: DockItem[] = [];
		const plugin: DockItem[] = [];
		for ( const item of items ) {
			if ( item.isCore ) {
				core.push( item );
			} else {
				plugin.push( item );
			}
		}
		return { core, plugin };
	};

	const repaintIcons = (): void => {
		if ( layout !== 'spatial' ) {
			deps.renderIcons( serverIcons );
			return;
		}
		// Spatial owns the wallpaper as the "core surface": only
		// synthesized core menu icons render here. Plugin admin
		// menus already live in the bottom dock; rendering plugin-
		// registered desktop icons on top would duplicate every
		// plugin that ships both a top-level menu and a desktop
		// shortcut. Plugin authors who want a Spatial-mode wallpaper
		// presence can hook a filter in a follow-up if it comes up.
		const { core } = partition();
		const synthesized = core.map( coreItemToIconEntry );
		deps.renderIcons( synthesized );
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
		railItems: DockItem[],
		orientation: 'left' | 'right' | 'bottom',
	): DockRailMountDeps => ( {
		container,
		items: railItems,
		// `fullMenu` is the complete admin-menu list. Renderers that
		// want to ignore the layout's partitioning (e.g., paint
		// every menu item in one ring regardless of `isCore`) read
		// this instead of `items`. Snapshot per-mount so a renderer
		// holding the array sees a stable list; live updates flow
		// through `replaceItems`.
		fullMenu: items.slice(),
		// Same idea for system tiles — OS Settings, plugin-owned
		// native-window launchers, etc. Lets a renderer apply
		// uniform treatment across menu + system cohorts in one
		// pass. Live updates flow through `appendSystemItem` /
		// `removeSystemItem`.
		fullSystemTiles: Array.from( systemTiles.values() ).map(
			( entry ) => entry.item,
		),
		orientation,
		windowManager: deps.windowManager,
		adminUrl: deps.adminUrl,
		// `openItem` / `openSubmenuPick` / `openSystemItem` /
		// `requestSubmenu` are routing callbacks for custom
		// renderers. They mirror exactly what the default renderer
		// (`Dock.openPage` / `Dock.openSubmenuPick`) does internally
		// — same `deriveWindowId(url, adminUrl)` call, same window-
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
				multi: !! item.multi,
			} );
		},
		openSubmenuPick: ( item, sub ) => {
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
				multi: !! item.multi,
			} );
		},
		openSystemItem: ( item ) => item.onOpen(),
	} );

	const buildDocksForCurrentLayout = (): void => {
		tearDownDocks();
		const { core, plugin } = partition();

		if ( layout === 'classic' ) {
			sideDockEl = ensureSideDockEl();
			side = mountRail(
				buildMountDeps( sideDockEl, core, 'left' ),
			);
			sideDock = unwrapDefaultDock( side );
			primary = mountRail(
				buildMountDeps( deps.bottomDockEl, plugin, 'bottom' ),
			);
			primaryDock = unwrapDefaultDock( primary );
		} else if ( layout === 'unified' ) {
			removeSideDockEl();
			primary = mountRail(
				buildMountDeps( deps.bottomDockEl, items, 'bottom' ),
			);
			primaryDock = unwrapDefaultDock( primary );
		} else {
			// Spatial — bottom dock holds plugins; core items are
			// emitted as wallpaper icons by `repaintIcons()` below.
			removeSideDockEl();
			primary = mountRail(
				buildMountDeps( deps.bottomDockEl, plugin, 'bottom' ),
			);
			primaryDock = unwrapDefaultDock( primary );
		}

		// Re-attach every tracked system tile to the rebuilt rails
		// according to its registered affinity, in registration order
		// so the visual order survives the rebuild.
		for ( const entry of systemTiles.values() ) {
			railFor( entry.affinity )?.appendSystemItem( entry.item );
		}
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
			deps.shellRoot.setAttribute( 'data-desktop-mode-layout', next );
			buildDocksForCurrentLayout();
			repaintIcons();
			document.dispatchEvent(
				new CustomEvent( 'desktop-mode-layout-changed', {
					detail: {
						layout: next,
						primary: primaryDock,
						side: sideDock,
					},
				} ),
			);
		},
		applyDockItems: ( nextItems: DockItem[] ): void => {
			items = nextItems;
			const { core, plugin } = partition();
			if ( layout === 'classic' ) {
				side?.replaceItems( core );
				primary?.replaceItems( plugin );
			} else if ( layout === 'unified' ) {
				primary?.replaceItems( items );
			} else {
				primary?.replaceItems( plugin );
			}
			repaintIcons();
		},
		applyDesktopIcons: (
			next: DesktopIconServerEntry[] | undefined,
		): void => {
			serverIcons = next ?? [];
			repaintIcons();
		},
		appendSystemTile: (
			item: SystemDockItem,
			affinity: SystemTileAffinity = 'plugin',
		): void => {
			systemTiles.set( item.id, { item, affinity } );
			railFor( affinity )?.appendSystemItem( item );
		},
		removeSystemTile: ( id: string ): void => {
			const entry = systemTiles.get( id );
			if ( ! entry ) {
				return;
			}
			systemTiles.delete( id );
			// Remove from whichever rail currently hosts it. Idempotent
			// `removeSystemItem` lets us call both without side effects
			// when the tile lives on only one of them.
			railFor( entry.affinity )?.removeSystemItem( id );
		},
		listSystemTiles: () =>
			Array.from( systemTiles.values() ).map( ( entry ) => ( {
				id: entry.item.id,
				title: entry.item.title,
				icon: entry.item.icon,
				affinity: entry.affinity,
			} ) ),
		getSystemTile: ( id: string ): SystemDockItem | null =>
			systemTiles.get( id )?.item ?? null,
		getMenuItems: () => items.slice(),
		destroy: (): void => {
			tearDownDocks();
			removeSideDockEl();
		},
	};

	// Initial paint — set the shell attribute, build the docks, and
	// emit the icon list now so the user lands on a fully-rendered
	// shell before the first frame.
	deps.shellRoot.setAttribute( 'data-desktop-mode-layout', layout );
	buildDocksForCurrentLayout();
	repaintIcons();

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
		repaintIcons();
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-layout-changed', {
				detail: {
					layout,
					primary: primaryDock,
					side: sideDock,
				},
			} ),
		);
	} );

	return dispatcher;
}

/** Internal export for unit tests that need to inspect the synthesizer. */
export const _testing = {
	coreItemToIconEntry,
	SIDE_DOCK_ID,
};

// `DockItemConfig` is re-exported only because TypeScript needs the
// import resolution for downstream `.d.ts` callers.
export type { DockItemConfig };
