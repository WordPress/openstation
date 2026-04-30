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
import type { WindowManager } from './window-manager';
import type { DesktopLayoutId } from './settings/types';

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
	/** Outermost shell root — receives `data-wp-desktop-layout`. */
	shellRoot: HTMLElement;
	/**
	 * `.wp-desktop-shell__body` flex row that hosts the side dock and
	 * the desktop area. The side dock (Classic) is inserted as the
	 * first child here so its CSS `order: -1` paints it on the left.
	 */
	shellBody: HTMLElement;
	/** Existing `#wp-desktop-dock` element from the PHP shell template. */
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
	 * cache `wp.desktop.dock` should listen for `wp-desktop-layout-
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
	/** Tear down all docks. Called on shell unload (or in tests). */
	destroy(): void;
}

const SIDE_DOCK_ID = 'wp-desktop-side-dock';

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
	let primary: Dock | null = null;
	let side: Dock | null = null;
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

	const railFor = ( affinity: SystemTileAffinity ): Dock | null => {
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
		el.className = 'wp-desktop-dock';
		el.setAttribute( 'role', 'toolbar' );
		el.setAttribute( 'aria-label', 'Core admin navigation' );
		// Insert as the first child of `.wp-desktop-shell__body` so
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
		const { core } = partition();
		const synthesized = core.map( coreItemToIconEntry );
		deps.renderIcons( [ ...serverIcons, ...synthesized ] );
	};

	const tearDownDocks = (): void => {
		if ( primary ) {
			primary.destroy();
			primary = null;
		}
		if ( side ) {
			side.destroy();
			side = null;
		}
	};

	const buildDocksForCurrentLayout = (): void => {
		tearDownDocks();
		const { core, plugin } = partition();

		if ( layout === 'classic' ) {
			sideDockEl = ensureSideDockEl();
			side = new Dock(
				sideDockEl,
				deps.windowManager,
				core,
				deps.adminUrl,
				'left',
			);
			primary = new Dock(
				deps.bottomDockEl,
				deps.windowManager,
				plugin,
				deps.adminUrl,
				'bottom',
			);
		} else if ( layout === 'unified' ) {
			removeSideDockEl();
			primary = new Dock(
				deps.bottomDockEl,
				deps.windowManager,
				items,
				deps.adminUrl,
				'bottom',
			);
		} else {
			// Spatial — bottom dock holds plugins; core items are
			// emitted as wallpaper icons by `repaintIcons()` below.
			removeSideDockEl();
			primary = new Dock(
				deps.bottomDockEl,
				deps.windowManager,
				plugin,
				deps.adminUrl,
				'bottom',
			);
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
		getPrimary: () => primary,
		getSide: () => side,
		setLayout: ( next: DesktopLayoutId ): void => {
			if ( next === layout ) {
				return;
			}
			layout = next;
			deps.shellRoot.setAttribute( 'data-wp-desktop-layout', next );
			buildDocksForCurrentLayout();
			repaintIcons();
			document.dispatchEvent(
				new CustomEvent( 'wp-desktop-layout-changed', {
					detail: { layout: next, primary, side },
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
		destroy: (): void => {
			tearDownDocks();
			removeSideDockEl();
		},
	};

	// Initial paint — set the shell attribute, build the docks, and
	// emit the icon list now so the user lands on a fully-rendered
	// shell before the first frame.
	deps.shellRoot.setAttribute( 'data-wp-desktop-layout', layout );
	buildDocksForCurrentLayout();
	repaintIcons();

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
