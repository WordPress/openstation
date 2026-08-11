/**
 * Desktop-layout dispatcher.
 *
 * Owns the dock(s) and any synthesized desktop icons across the three
 * top-level layouts the user can pick in OS Settings → Appearance:
 *
 * - **Unified** — a single `Dock` instance with every menu sharing one
 *   rail, on the edge the user's `dockPlacement` names. Default for
 *   new installs: one navigation surface, so nothing has to be learned
 *   twice.
 * - **Classic** — two `Dock` instances. The bottom dock holds plugin
 *   menus (`!isCore`). A side dock on the left edge holds core admin
 *   menus (`isCore`).
 * - **Spatial** — a single `Dock` instance with plugin menus only.
 *   Core menus are synthesized into desktop-icon entries and handed to
 *   `renderDesktopIcons` so they appear on the wallpaper.
 * - **OpenStation** — a single bottom `Dock` instance holding every
 *   menu, but *re-sorted* so the WordPress core cluster leads and the
 *   plugin cluster follows. That sort is what makes the rail's single
 *   core→plugin divider deterministic: `Dock.render()` drops its
 *   `--group` separator at the first `isCore === false` tile, so any
 *   interleaved order (a user drag, a plugin's `dockOrder` filter)
 *   would otherwise scatter the boundary or lose it entirely. Desktop
 *   icons behave exactly as they do in Classic/Unified: the wallpaper
 *   stays available, it just isn't load-bearing. Bottom-only, unlike
 *   Unified and Spatial — see `primaryOrientation()`.
 *
 * Three surfaces drive this module:
 *
 * 1. `setLayout( layout )` — full rebuild. Tears down current docks,
 *    creates new ones for the new layout, re-attaches the OS Settings
 *    system tile to the primary rail, repaints desktop icons.
 * 2. `setDockPlacement( placement )` — same full rebuild for the edge
 *    the single rail lives on. A no-op in Classic, whose two rails are
 *    the layout's own decision.
 * 3. `applyDockItems( items )` / `applyDesktopIcons( serverIcons )` —
 *    update paths used by the live menu-refresh pipeline. Same item
 *    list comes in; the dispatcher partitions it by `isCore` and pushes
 *    the right slice to each rail (and re-synthesizes core icons on
 *    the wallpaper for Spatial).
 *
 * Lives separate from `desktop.ts` so the partitioning logic is
 * testable without booting the whole shell.
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
import type {
	DesktopLayoutId,
	DockPlacementId,
	OsSettingsState,
} from './settings/types';
import {
	applyDesktopPlacement,
	applyDockPlacement,
} from './settings/item-placement';
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
	/** Outermost shell root — receives `data-os-layout`. */
	shellRoot: HTMLElement;
	/**
	 * `.os-shell__body` flex row that hosts the side dock and
	 * the desktop area. The side dock (Classic) is inserted as the
	 * first child here so its CSS `order: -1` paints it on the left.
	 */
	shellBody: HTMLElement;
	/**
	 * Existing `#os-dock` element from the PHP shell template. Hosts the
	 * primary rail on whichever edge is in play — the name is
	 * historical, `bottom` is only its default placement.
	 */
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
	/**
	 * Read the current OS-settings snapshot. The dispatcher consults
	 * this on every partition / repaint so the user's
	 * `itemVisibility` + `dockOrder` overrides take effect without
	 * the call site having to thread settings through.
	 */
	getSettings?: () => Pick<
		OsSettingsState,
		'itemVisibility' | 'dockOrder'
	>;
}

/**
 * Public surface mirrored on the shell so the menu-refresh pipeline
 * and other shell modules don't have to reach for the underlying
 * `Dock` references directly.
 */
export interface LayoutDispatcher {
	/** Currently-active layout. Mirrors `state.desktopLayout`. */
	getLayout(): DesktopLayoutId;
	/** Primary dock instance. Always present once `setLayout` has run. */
	getPrimary(): Dock | null;
	/** Side (left) dock instance. Non-null only in Classic. */
	getSide(): Dock | null;
	/**
	 * Switch to a new layout. Tears down existing docks (and any
	 * synthesized side-dock element), creates fresh ones, re-attaches
	 * the OS Settings tile, repaints the wallpaper-icon grid.
	 *
	 * Idempotent: passing the current layout is a no-op. Plugins that
	 * cache `wp.os.dock` should listen for `os-layout-
	 * changed` on `document` and refresh their reference.
	 */
	setLayout( layout: DesktopLayoutId ): void;
	/**
	 * The edge the single rail sits on. Mirrors `state.dockPlacement`
	 * whatever the layout is — Classic keeps the user's pick stored
	 * without acting on it, so switching back to a one-rail layout
	 * lands on the edge they chose rather than resetting to the bottom.
	 */
	getDockPlacement(): DockPlacementId;
	/**
	 * Move the single rail to another edge. Same full rebuild as
	 * `setLayout` — the placement is passed to the renderer at
	 * `mount()` time, so a rail cannot be re-oriented without one.
	 *
	 * Idempotent, and a no-op in Classic beyond storing the value:
	 * that layout's two rails (side bar + bottom dock) are the layout
	 * itself, and honouring the pick would stack both on one edge.
	 */
	setDockPlacement( placement: DockPlacementId ): void;
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
	 */
	listSystemTiles(): Array< {
		id: string;
		title: string;
		icon: string;
		affinity: SystemTileAffinity;
		/** Whether the tile opts into the Apps & Icons list. */
		placeable: boolean;
	} >;
	/**
	 * Look up a system tile by id. Returns the underlying
	 * `SystemDockItem` so callers can invoke `onOpen()` directly.
	 * Returns `null` for unknown ids.
	 */
	getSystemTile( id: string ): SystemDockItem | null;
	/**
	 * Snapshot of the complete admin-menu list — the same data the
	 * dispatcher partitions across rails based on layout. Use this
	 * when a custom rail renderer needs the full picture (Classic
	 * layout's primary rail only sees `!isCore` items via
	 * mount-deps; this returns every item).
	 */
	getMenuItems(): DockItem[];
	/**
	 * Re-apply the current OS-settings placement preferences to every
	 * rail. Called when `itemVisibility` or `dockOrder` changes — both
	 * the dock contents and the desktop-icons grid may shift.
	 */
	refresh(): void;
	/** Tear down all docks. Called on shell unload (or in tests). */
	destroy(): void;
}

const SIDE_DOCK_ID = 'os-side-dock';

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
	initialPlacement: DockPlacementId = 'bottom',
): LayoutDispatcher {
	let layout: DesktopLayoutId = initialLayout;
	// Named for the setting rather than shortened to `placement`: this
	// file also calls an item's dock-vs-desktop visibility a placement,
	// and the two are unrelated.
	let dockPlacement: DockPlacementId = initialPlacement;
	let items: DockItem[] = initialDockItems;
	let serverIcons: DesktopIconServerEntry[] = initialServerIcons ?? [];
	// Two-tier storage: controllers drive every live update (built
	// from `renderer.mount()`), and the unwrapped Dock instances are
	// kept alongside ONLY when the active renderer is the built-in
	// `'default'`. The Dock references back the public `wp.os.dock`
	// / `wp.os.sideDock` API surface unchanged; custom-renderer
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
	// Ids of tracked system tiles currently attached to a live rail.
	// A tile the user hid via OS Settings → Apps & Icons stays tracked
	// (so flipping the setting back restores it) but detached.
	const attachedSystemTiles = new Set< string >();

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
		el.className = 'os-dock';
		el.setAttribute( 'role', 'toolbar' );
		el.setAttribute( 'aria-label', 'Core admin navigation' );
		// Insert as the first child of `.os-shell__body` so
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

	/**
	 * Effective dock-item list after applying the user's visibility +
	 * ordering preferences. Reads server icons so desktop-only items
	 * the user has promoted to the dock get synthesized into tiles.
	 */
	const readSettings = (): Pick<
		OsSettingsState,
		'itemVisibility' | 'dockOrder'
	> => deps.getSettings?.() ?? { itemVisibility: {}, dockOrder: [] };

	/**
	 * Whether a system tile is allowed on the dock under the user's
	 * current Apps & Icons overrides. Native windows registered with
	 * `placement: 'dock'` land on the rails as system tiles rather
	 * than menu items, so `applyDockPlacement` never filters them —
	 * resolve the override here instead.
	 *
	 * The override is read from the desktop icon targeting the tile's
	 * window when one exists (the Apps & Icons tab keys its rows by
	 * icon id), falling back to the tile's own id. No override means
	 * the tile stays on its native dock rail.
	 */
	const isSystemTileDockVisible = ( tileId: string ): boolean => {
		const visibility = readSettings().itemVisibility;
		let override = visibility[ tileId ];
		for ( const icon of serverIcons ) {
			if ( icon.window === tileId && visibility[ icon.id ] ) {
				override = visibility[ icon.id ];
				break;
			}
		}
		if ( ! override ) {
			return true;
		}
		return override === 'dock' || override === 'both';
	};

	/**
	 * Bring rail attachment in line with the visibility map for every
	 * tracked system tile: attach tiles the user unhid, detach tiles
	 * the user hid. Idempotent — called from `refresh()` on every
	 * settings save and from `applyDesktopIcons()` when the icon →
	 * window mapping the overrides key off changes.
	 */
	const reconcileSystemTiles = (): void => {
		for ( const [ id, entry ] of systemTiles ) {
			const shouldShow = isSystemTileDockVisible( id );
			const isAttached = attachedSystemTiles.has( id );
			if ( shouldShow && ! isAttached ) {
				railFor( entry.affinity )?.appendSystemItem( entry.item );
				attachedSystemTiles.add( id );
			} else if ( ! shouldShow && isAttached ) {
				railFor( entry.affinity )?.removeSystemItem( id );
				attachedSystemTiles.delete( id );
			}
		}
	};

	const effectiveDockItems = (): DockItem[] => {
		// System tile ids match the native-window ids the framework
		// has already mounted on the dock (Recycle Bin's
		// `placement: 'taskbar'` registration is the canonical
		// example). Pass them through so applyDockPlacement skips
		// synthesizing a duplicate when the user picks "Both" for
		// an icon whose native window is already on the dock.
		const dockedNativeWindows = new Set< string >();
		for ( const entry of systemTiles.values() ) {
			dockedNativeWindows.add( entry.item.id );
		}
		return applyDockPlacement(
			items,
			serverIcons,
			readSettings(),
			dockedNativeWindows,
		);
	};

	const partition = (): { core: DockItem[]; plugin: DockItem[] } => {
		const effective = effectiveDockItems();
		const core: DockItem[] = [];
		const plugin: DockItem[] = [];
		for ( const item of effective ) {
			if ( item.isCore ) {
				core.push( item );
			} else {
				plugin.push( item );
			}
		}
		return { core, plugin };
	};

	/**
	 * The OpenStation rail: every menu on one bottom dock, core
	 * cluster first, plugin cluster second.
	 *
	 * The re-sort is deliberate and is the whole reason the layout's
	 * divider works. `Dock` inserts its `--group` separator at the
	 * first tile whose `isCore` is `false`, so it only produces one
	 * clean boundary when the list is already grouped. `partition()`
	 * preserves each item's relative order inside its own cluster, so
	 * a user's drag-to-reorder still holds — it just can't drag a
	 * plugin into the middle of WordPress.
	 */
	const openStationRailItems = (): DockItem[] => {
		const { core, plugin } = partition();
		return [ ...core, ...plugin ];
	};

	const repaintIcons = (): void => {
		const settings = readSettings();
		if ( layout !== 'spatial' ) {
			// Apply visibility to the wallpaper grid — items the user
			// promoted to the desktop get synthesized; native desktop
			// icons hidden / dock-only are filtered out.
			deps.renderIcons(
				applyDesktopPlacement( serverIcons, items, settings.itemVisibility ),
			);
			return;
		}
		// Spatial owns the wallpaper as the "core surface": synthesized
		// core menu icons render here. Server-registered PLUGIN desktop
		// icons with no override are deliberately suppressed — their
		// admin menu lives in the bottom dock, and duplicating them on
		// the wallpaper would create two paths to the same screen.
		//
		// NOTE: on shells where the files layer is mounted (0.9.0+),
		// `.os-icons` — the container `deps.renderIcons()`
		// paints into — is hidden by CSS (see `desktop-files.css`'s
		// `:has(...)` rule), since the files layer is the actual
		// visible wallpaper surface. The synthesis below still runs
		// (and matters for shells without a files layer), but the
		// user-visible equivalent for Spatial's core icons is produced
		// separately by `syncShortcutsWithVisibility()` in
		// `settings/desktop-shortcuts-sync.ts`, which pushes the same
		// core items into the files store as shortcut placements.
		//
		// Two classes of server icon MUST survive the Spatial layout,
		// or the layout choice silently eats them:
		//   1. Framework-owned `pinned` icons (e.g. My WordPress). These
		//      are not plugin menus and have no dock equivalent;
		//      suppressing them made the icon vanish from the wallpaper
		//      with the ONLY recovery being "move it to the dock" via
		//      OS Settings.
		//   2. Icons the user EXPLICITLY moved to the desktop / both in
		//      OS Settings → Apps & Icons. Without this the picker's
		//      "On the desktop" choice silently no-ops in Spatial.
		// Dock-native items the user promoted are appended separately
		// below (they have no serverIcons entry).
		const { core } = partition();
		const synthesized = core.map( coreItemToIconEntry );
		const keptServerIcons = serverIcons.filter( ( icon ) => {
			const override = settings.itemVisibility[ icon.id ];
			if ( override ) {
				return override === 'desktop' || override === 'both';
			}
			return Boolean( icon.pinned );
		} );
		const explicitlyPromoted: DesktopIconServerEntry[] = [];
		let synthIndex = 0;
		for ( const item of items ) {
			const placement = settings.itemVisibility[ item.id ];
			if ( placement === 'desktop' || placement === 'both' ) {
				explicitlyPromoted.push( {
					id: `dock:${ item.id }`,
					title: item.title,
					icon: item.icon,
					window: '',
					url: item.url || '',
					position: 2000 + synthIndex++,
				} );
			}
		}
		deps.renderIcons( [
			...synthesized,
			...keptServerIcons,
			...explicitlyPromoted,
		] );
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
		// `removeSystemItem`. Tiles hidden via Apps & Icons are
		// excluded, matching what the dispatcher attaches below.
		fullSystemTiles: Array.from( systemTiles.values() )
			.filter( ( entry ) => isSystemTileDockVisible( entry.item.id ) )
			.map( ( entry ) => entry.item ),
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

	/**
	 * Which edge the primary rail mounts on.
	 *
	 * Unified and Spatial follow the user's `dockPlacement`. Two layouts
	 * are pinned to `'bottom'`, for different reasons:
	 *
	 *   - **Classic** — its side bar already owns the left edge, so
	 *     letting the plugin rail move there would stack the two on top
	 *     of each other.
	 *   - **OpenStation** — the layout is drawn for a horizontal rail.
	 *     Its stylesheet is scoped to
	 *     `[data-os-dock-placement="bottom"]` and its
	 *     constellation flyout fans upward out of a tile, so a vertical
	 *     rail would lose the skin and keep geometry built for an edge
	 *     it is no longer on.
	 *
	 * The pick is remembered either way — switching to Unified or
	 * Spatial later lands on the edge the user chose.
	 */
	const primaryOrientation = (): DockPlacementId =>
		layout === 'classic' || layout === 'openstation'
			? 'bottom'
			: dockPlacement;

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
				buildMountDeps(
					deps.bottomDockEl,
					effectiveDockItems(),
					primaryOrientation(),
				),
			);
			primaryDock = unwrapDefaultDock( primary );
		} else if ( layout === 'openstation' ) {
			removeSideDockEl();
			primary = mountRail(
				buildMountDeps(
					deps.bottomDockEl,
					openStationRailItems(),
					primaryOrientation(),
				),
			);
			primaryDock = unwrapDefaultDock( primary );
		} else {
			// Spatial — the rail holds plugins; core items are
			// emitted as wallpaper icons by `repaintIcons()` below.
			removeSideDockEl();
			primary = mountRail(
				buildMountDeps(
					deps.bottomDockEl,
					plugin,
					primaryOrientation(),
				),
			);
			primaryDock = unwrapDefaultDock( primary );
		}

		// Re-attach every tracked system tile to the rebuilt rails
		// according to its registered affinity, in registration order
		// so the visual order survives the rebuild. Tiles hidden via
		// Apps & Icons stay tracked but detached.
		attachedSystemTiles.clear();
		for ( const [ id, entry ] of systemTiles ) {
			if ( ! isSystemTileDockVisible( id ) ) {
				continue;
			}
			railFor( entry.affinity )?.appendSystemItem( entry.item );
			attachedSystemTiles.add( id );
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
			deps.shellRoot.setAttribute( 'data-os-layout', next );
			buildDocksForCurrentLayout();
			repaintIcons();
			document.dispatchEvent(
				new CustomEvent( 'os-layout-changed', {
					detail: {
						layout: next,
						placement: primaryOrientation(),
						primary: primaryDock,
						side: sideDock,
					},
				} ),
			);
		},
		getDockPlacement: () => dockPlacement,
		setDockPlacement: ( next: DockPlacementId ): void => {
			if ( next === dockPlacement ) {
				return;
			}
			const wasHonoured = primaryOrientation();
			dockPlacement = next;
			// Classic stores the pick and stops here — see
			// `primaryOrientation()`. Comparing the ORIENTATION rather
			// than the layout id keeps that in one place: when the edge
			// the rail actually mounts on hasn't moved, neither has
			// anything worth tearing down.
			if ( primaryOrientation() === wasHonoured ) {
				return;
			}
			buildDocksForCurrentLayout();
			repaintIcons();
			// Same event as a layout change, and for the same reason:
			// the rails were destroyed and rebuilt, so every cached
			// `wp.os.dock` reference now points at a dead instance.
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
		},
		applyDockItems: ( nextItems: DockItem[] ): void => {
			items = nextItems;
			const { core, plugin } = partition();
			if ( layout === 'classic' ) {
				side?.replaceItems( core );
				primary?.replaceItems( plugin );
			} else if ( layout === 'unified' ) {
				primary?.replaceItems( effectiveDockItems() );
			} else if ( layout === 'openstation' ) {
				primary?.replaceItems( [ ...core, ...plugin ] );
			} else {
				primary?.replaceItems( plugin );
			}
			repaintIcons();
		},
		applyDesktopIcons: (
			next: DesktopIconServerEntry[] | undefined,
		): void => {
			serverIcons = next ?? [];
			// The icon → window mapping that Apps & Icons overrides
			// key off may have changed — re-check every system tile.
			reconcileSystemTiles();
			repaintIcons();
		},
		appendSystemTile: (
			item: SystemDockItem,
			affinity: SystemTileAffinity = 'plugin',
		): void => {
			systemTiles.set( item.id, { item, affinity } );
			// Respect a pre-existing Apps & Icons override — a native
			// window the user hid must not resurface on the dock when
			// its plugin re-registers the tile (boot, plugins-changed
			// sync). The tile stays tracked so unhiding restores it.
			if ( ! isSystemTileDockVisible( item.id ) ) {
				return;
			}
			railFor( affinity )?.appendSystemItem( item );
			attachedSystemTiles.add( item.id );
		},
		removeSystemTile: ( id: string ): void => {
			const entry = systemTiles.get( id );
			if ( ! entry ) {
				return;
			}
			systemTiles.delete( id );
			attachedSystemTiles.delete( id );
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
				placeable: entry.item.placeable === true,
			} ) ),
		getSystemTile: ( id: string ): SystemDockItem | null =>
			systemTiles.get( id )?.item ?? null,
		getMenuItems: () => items.slice(),
		refresh: (): void => {
			const { core, plugin } = partition();
			if ( layout === 'classic' ) {
				side?.replaceItems( core );
				primary?.replaceItems( plugin );
			} else if ( layout === 'unified' ) {
				primary?.replaceItems( effectiveDockItems() );
			} else if ( layout === 'openstation' ) {
				primary?.replaceItems( [ ...core, ...plugin ] );
			} else {
				primary?.replaceItems( plugin );
			}
			// Apply the (possibly changed) visibility overrides to the
			// system-tile cohort too — a native window's dock tile
			// hidden / restored via Apps & Icons lands live here.
			reconcileSystemTiles();
			repaintIcons();
		},
		destroy: (): void => {
			tearDownDocks();
			removeSideDockEl();
		},
	};

	// Initial paint — set the shell attribute, build the docks, and
	// emit the icon list now so the user lands on a fully-rendered
	// shell before the first frame.
	deps.shellRoot.setAttribute( 'data-os-layout', layout );
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
			new CustomEvent( 'os-layout-changed', {
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
