/**
 * Live-menu-refresh payload applier.
 *
 * Pure factory extracted from `desktop.ts` so it can be exercised in
 * isolation. Given the parent shell's mutable `config`, the dock
 * instance, and the per-surface sync callbacks, returns a single
 * `applyPayload( payload )` function that mirrors a fresh
 * `desktop-mode-plugins-changed` payload onto the live shell — adding
 * dock tiles, repainting widgets, registering plugin wallpapers,
 * re-rendering wallpaper-shortcut icons, and so on, all without an F5.
 *
 * Owns the contract that lists EVERY payload key the chromeless bridge
 * may emit. Adding a new key here is a documented breaking change for
 * plugin authors who watch live-refresh behaviour.
 *
 * @since 0.5.2
 */
import type { DockItem } from './dock';
import type {
	DesktopCommandScriptServerEntry,
	DesktopCommandServerEntry,
	DesktopConfig,
	DesktopDockRailRendererScriptServerEntry,
	DesktopIconServerEntry,
	DesktopSettingsTabScriptServerEntry,
	DesktopSettingsTabServerEntry,
	DesktopTitleBarButtonScriptServerEntry,
	DesktopGameServerEntry,
	DesktopUnfocusEffectScriptServerEntry,
	DesktopWindowLinkRendererScriptServerEntry,
	DesktopWallpaperServerEntry,
	DesktopWidgetServerEntry,
	DesktopWindowNoticeServerEntry,
	DesktopThemeServerEntry,
	NativeWindowServerEntry,
} from './types';
import { applyServerWindowNotices } from './window-notices-server-sync';
import { applyAdminBarUpdates } from './admin-bar-updates';

/** Shape of every payload key the bridge may carry. */
export interface MenuRefreshPayload {
	dockItems?: unknown;
	nativeWindows?: unknown;
	serverWidgets?: unknown;
	serverWallpapers?: unknown;
	serverCommandScripts?: unknown;
	serverCommands?: unknown;
	serverSettingsTabScripts?: unknown;
	serverSettingsTabs?: unknown;
	serverDockRailRendererScripts?: unknown;
	serverTitleBarButtonScripts?: unknown;
	serverUnfocusEffectScripts?: unknown;
	serverWindowLinkRendererScripts?: unknown;
	serverWindowNotices?: unknown;
	serverGames?: unknown;
	serverDesktopThemes?: unknown;
	desktopIcons?: unknown;
	updateCounts?: unknown;
}

/** Dependencies the applier needs from the shell. */
export interface MenuRefreshDeps {
	/**
	 * Push a fresh dock-items list into whichever rails are live for
	 * the current desktop layout. Routes core/plugin partitioning
	 * through the layout dispatcher rather than reaching for a single
	 * `Dock` instance — necessary because Classic uses two docks and
	 * Spatial pushes core items to the wallpaper instead.
	 *
	 * No-op when the layout dispatcher hasn't been wired (older shell
	 * markup, head-less tests).
	 */
	applyDockItems: ( items: DockItem[] ) => void;
	desktopArea: HTMLElement;
	config: DesktopConfig;
	syncNativeWindows: ( list: NativeWindowServerEntry[] ) => Promise< void >;
	syncServerWidgets: ( list: DesktopWidgetServerEntry[] ) => Promise< void >;
	syncServerWallpapers: (
		list: DesktopWallpaperServerEntry[],
	) => Promise< void >;
	syncServerCommands: (
		scripts: DesktopCommandScriptServerEntry[],
		commands?: DesktopCommandServerEntry[],
	) => Promise< void >;
	syncServerSettingsTabs: (
		scripts: DesktopSettingsTabScriptServerEntry[],
		tabs?: DesktopSettingsTabServerEntry[],
	) => Promise< void >;
	syncServerTitleBarButtons: (
		scripts: DesktopTitleBarButtonScriptServerEntry[],
	) => Promise< void >;
	syncServerUnfocusEffects: (
		scripts: DesktopUnfocusEffectScriptServerEntry[],
	) => Promise< void >;
	syncServerWindowLinkRenderers: (
		scripts: DesktopWindowLinkRendererScriptServerEntry[],
	) => Promise< void >;
	syncServerDockRailRenderers: (
		scripts: DesktopDockRailRendererScriptServerEntry[],
	) => Promise< void >;
	syncServerGames: ( list: DesktopGameServerEntry[] ) => Promise< void >;
	/**
	 * Reconcile the desktop-theme library against a fresh payload.
	 * Synchronous — themes carry no script to load.
	 *
	 * Optional so callers/tests that predate desktop themes keep
	 * working unchanged.
	 */
	syncServerDesktopThemes?: ( list: DesktopThemeServerEntry[] ) => void;
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;
	/**
	 * Re-run the files-layer shortcut reconciliation
	 * (`syncShortcutsWithVisibility`) against the freshly-applied dock
	 * items. Keeps Spatial's synthesized core icons (and ordinary
	 * user-promoted shortcuts) current when a plugin activation or
	 * deactivation changes the core/plugin menu split live, instead of
	 * only refreshing on the next OS Settings change.
	 *
	 * Optional so older callers/tests that don't wire the files layer
	 * keep working unchanged.
	 */
	syncShortcuts?: () => void;
}

/**
 * Public CustomEvent name dispatched on `document` when a registry is
 * mutated by the live-refresh applier. Plugin authors subscribe to
 * react to a peer plugin being activated/deactivated mid-session
 * without paying a page reload — the event detail names the registry
 * and the id-based diff against the prior snapshot.
 *
 * Naming: `desktop-mode-*`, NOT `wp-desktop-*`. The `wp-` prefix is
 * reserved for WordPress Core per plugin reviewer guidelines; all
 * public surface uses the project-owned prefix.
 *
 * @since 0.7.0
 */
export const REGISTRY_CHANGED_EVENT = 'desktop-mode-registry-changed';

/** Shape of the `desktop-mode-registry-changed` event detail. */
export interface RegistryChangedDetail {
	registry:
		| 'dock-items'
		| 'native-windows'
		| 'desktop-icons';
	added: string[];
	removed: string[];
}

function diffIds(
	prev: ReadonlyArray< { id?: unknown } > | undefined,
	next: ReadonlyArray< { id?: unknown } >,
): { added: string[]; removed: string[] } {
	const prevIds = new Set< string >();
	if ( Array.isArray( prev ) ) {
		for ( const item of prev ) {
			if ( item && typeof item.id === 'string' ) {
				prevIds.add( item.id );
			}
		}
	}
	const nextIds = new Set< string >();
	for ( const item of next ) {
		if ( item && typeof item.id === 'string' ) {
			nextIds.add( item.id );
		}
	}
	const added: string[] = [];
	for ( const id of nextIds ) {
		if ( ! prevIds.has( id ) ) {
			added.push( id );
		}
	}
	const removed: string[] = [];
	for ( const id of prevIds ) {
		if ( ! nextIds.has( id ) ) {
			removed.push( id );
		}
	}
	return { added, removed };
}

function emitRegistryChanged(
	registry: RegistryChangedDetail[ 'registry' ],
	prev: ReadonlyArray< { id?: unknown } > | undefined,
	next: ReadonlyArray< { id?: unknown } >,
): void {
	const { added, removed } = diffIds( prev, next );
	if ( added.length === 0 && removed.length === 0 ) {
		return;
	}
	if ( typeof document === 'undefined' ) {
		return;
	}
	const detail: RegistryChangedDetail = { registry, added, removed };
	document.dispatchEvent(
		new CustomEvent( REGISTRY_CHANGED_EVENT, { detail } ),
	);
}

export function createApplyPayload(
	deps: MenuRefreshDeps,
): ( payload: MenuRefreshPayload ) => void {
	const {
		applyDockItems,
		config,
		syncNativeWindows,
		syncServerWidgets,
		syncServerWallpapers,
		syncServerCommands,
		syncServerSettingsTabs,
		syncServerTitleBarButtons,
		syncServerUnfocusEffects,
		syncServerWindowLinkRenderers,
		syncServerDockRailRenderers,
		syncServerGames,
		syncServerDesktopThemes,
		renderIcons,
		syncShortcuts,
	} = deps;

	return function applyPayload( payload: MenuRefreshPayload ): void {
		const dockItems = payload.dockItems;
		const nativeWindows = payload.nativeWindows;
		const serverWidgets = payload.serverWidgets;
		const serverWallpapers = payload.serverWallpapers;
		const serverCommandScripts = payload.serverCommandScripts;
		const serverCommands = payload.serverCommands;
		const serverSettingsTabScripts = payload.serverSettingsTabScripts;
		const serverSettingsTabs = payload.serverSettingsTabs;
		const serverDockRailRendererScripts = payload.serverDockRailRendererScripts;
		const serverTitleBarButtonScripts = payload.serverTitleBarButtonScripts;
		const serverUnfocusEffectScripts = payload.serverUnfocusEffectScripts;
		const serverWindowLinkRendererScripts =
			payload.serverWindowLinkRendererScripts;
		const serverWindowNotices = payload.serverWindowNotices;
		const serverGames = payload.serverGames;
		const serverDesktopThemes = payload.serverDesktopThemes;
		const desktopIcons = payload.desktopIcons;

		// Guard: an empty `dockItems` list is NEVER legitimate —
		// WordPress Core always ships Dashboard, which lands on the
		// dock by default. An empty response means the server side
		// failed to build the menu (e.g. the `$menu` global wasn't
		// populated in REST context and our bootstrap didn't kick
		// in). Skip the swap entirely rather than wipe the user's
		// sidebar.
		if ( ! Array.isArray( dockItems ) || dockItems.length === 0 ) {
			return;
		}
		const prevDockItems = config.dockItems;
		applyDockItems( dockItems as DesktopConfig[ 'dockItems' ] );
		config.dockItems = dockItems as DesktopConfig[ 'dockItems' ];
		emitRegistryChanged(
			'dock-items',
			prevDockItems as ReadonlyArray< { id?: unknown } > | undefined,
			dockItems as ReadonlyArray< { id?: unknown } >,
		);
		// Re-sync files-layer shortcuts against the new dock-item list —
		// covers Spatial's synthesized core icons and ordinary promoted
		// shortcuts when a plugin activation/deactivation changes which
		// items exist, without waiting for the next OS Settings change.
		syncShortcuts?.();

		// Native-window sync — server registry is the source of
		// truth for plugin-owned native windows. Tiles added
		// server-side (plugin activated via
		// `desktop_mode_register_window`) appear; tiles whose plugin
		// deactivated disappear. All without a shell reload.
		if ( Array.isArray( nativeWindows ) ) {
			const prevNativeWindows = config.nativeWindows;
			void syncNativeWindows(
				nativeWindows as NativeWindowServerEntry[],
			);
			config.nativeWindows =
				nativeWindows as DesktopConfig[ 'nativeWindows' ];
			emitRegistryChanged(
				'native-windows',
				prevNativeWindows as ReadonlyArray< { id?: unknown } > | undefined,
				nativeWindows as ReadonlyArray< { id?: unknown } >,
			);
		}

		// Widget-registry sync — same lifecycle story for the
		// right-column widget layer. Plugins declared via
		// `desktop_mode_register_widget()` show up in the picker
		// without a reload; deactivated plugin widgets disappear.
		if ( Array.isArray( serverWidgets ) ) {
			void syncServerWidgets(
				serverWidgets as DesktopWidgetServerEntry[],
			);
			config.serverWidgets =
				serverWidgets as DesktopConfig[ 'serverWidgets' ];
		}

		// Wallpaper-registry sync — same lifecycle, now for the
		// OS Settings wallpaper picker. New plugin wallpapers
		// surface without a reload; deactivated ones disappear and
		// the active selection falls back to a built-in if it was
		// the one leaving.
		if ( Array.isArray( serverWallpapers ) ) {
			void syncServerWallpapers(
				serverWallpapers as DesktopWallpaperServerEntry[],
			);
			config.serverWallpapers =
				serverWallpapers as DesktopConfig[ 'serverWallpapers' ];
		}

		// Games-registry sync — stub registration only (game scripts
		// load lazily on first launch). New plugin games surface in
		// the Games window without a reload; deactivated ones leave
		// the launcher grid + scoreboard tabs.
		if ( Array.isArray( serverGames ) ) {
			void syncServerGames( serverGames as DesktopGameServerEntry[] );
			config.serverGames =
				serverGames as DesktopConfig[ 'serverGames' ];
		}

		// Desktop-theme library sync — a plugin that registers a
		// theme from code makes it appear in OS Settings → Themes on
		// activation, and lose it on deactivation. If the user was
		// WEARING the departing theme, the sync deactivates locally
		// so the shell doesn't sit on a dead stylesheet.
		if ( Array.isArray( serverDesktopThemes ) ) {
			syncServerDesktopThemes?.(
				serverDesktopThemes as DesktopThemeServerEntry[],
			);
			config.serverDesktopThemes =
				serverDesktopThemes as DesktopConfig[ 'serverDesktopThemes' ];
		}

		// Command-palette sync — loads plugin-contributed command
		// scripts on activation and unregisters owner-tagged commands
		// when a handle leaves the payload. `serverCommandScripts`
		// may be absent on older menu REST responses that haven't
		// been redeployed yet; treat missing as "no change."
		if ( Array.isArray( serverCommandScripts ) ) {
			void syncServerCommands(
				serverCommandScripts as DesktopCommandScriptServerEntry[],
				Array.isArray( serverCommands )
					? ( serverCommands as DesktopCommandServerEntry[] )
					: undefined,
			);
			config.serverCommandScripts =
				serverCommandScripts as DesktopConfig[ 'serverCommandScripts' ];
			if ( Array.isArray( serverCommands ) ) {
				config.serverCommands =
					serverCommands as DesktopConfig[ 'serverCommands' ];
			}
		}

		// Settings-tab sync — mirror of the commands block. Loads
		// plugin-contributed settings-tab scripts on activation and
		// unregisters tabs attributable to a handle that just left
		// the payload.
		if ( Array.isArray( serverSettingsTabScripts ) ) {
			void syncServerSettingsTabs(
				serverSettingsTabScripts as DesktopSettingsTabScriptServerEntry[],
				Array.isArray( serverSettingsTabs )
					? ( serverSettingsTabs as DesktopSettingsTabServerEntry[] )
					: undefined,
			);
			config.serverSettingsTabScripts =
				serverSettingsTabScripts as DesktopConfig[ 'serverSettingsTabScripts' ];
			if ( Array.isArray( serverSettingsTabs ) ) {
				config.serverSettingsTabs =
					serverSettingsTabs as DesktopConfig[ 'serverSettingsTabs' ];
			}
		}

		// Title-bar-button sync — same shape as the commands block.
		if ( Array.isArray( serverTitleBarButtonScripts ) ) {
			void syncServerTitleBarButtons(
				serverTitleBarButtonScripts as DesktopTitleBarButtonScriptServerEntry[],
			);
			config.serverTitleBarButtonScripts =
				serverTitleBarButtonScripts as DesktopConfig[ 'serverTitleBarButtonScripts' ];
		}

		// Unfocus-effect sync — same shape. Loads plugin effect scripts
		// on activation (their `registerUnfocusEffect()` surfaces in
		// OS Settings → Effects and re-runs the engine); owner-tagged
		// sweep on deactivation.
		if ( Array.isArray( serverUnfocusEffectScripts ) ) {
			void syncServerUnfocusEffects(
				serverUnfocusEffectScripts as DesktopUnfocusEffectScriptServerEntry[],
			);
			config.serverUnfocusEffectScripts =
				serverUnfocusEffectScripts as DesktopConfig[ 'serverUnfocusEffectScripts' ];
		}

		// Window-link renderer sync — same shape. Loads plugin renderer
		// scripts on activation (their `registerWindowLinkRenderer()`
		// surfaces in OS Settings → Effects → Window links and the
		// render host remounts if it affects the active pick);
		// owner-tagged sweep on deactivation.
		if ( Array.isArray( serverWindowLinkRendererScripts ) ) {
			void syncServerWindowLinkRenderers(
				serverWindowLinkRendererScripts as DesktopWindowLinkRendererScriptServerEntry[],
			);
			config.serverWindowLinkRendererScripts =
				serverWindowLinkRendererScripts as DesktopConfig[ 'serverWindowLinkRendererScripts' ];
		}

		// Dock rail renderer sync — load plugin renderer scripts on
		// activation, owner-tagged sweep on deactivation. The
		// registry's notify cascade handles repaint of the OS
		// Settings picker AND triggers the layout dispatcher to
		// rebuild rails if the resolved active renderer changed.
		if ( Array.isArray( serverDockRailRendererScripts ) ) {
			void syncServerDockRailRenderers(
				serverDockRailRendererScripts as DesktopDockRailRendererScriptServerEntry[],
			);
			config.serverDockRailRendererScripts =
				serverDockRailRendererScripts as DesktopConfig[ 'serverDockRailRendererScripts' ];
		}

		// Window-notice sync — reconcile declarative notices against
		// the latest server snapshot. Plugin activation adds entries;
		// deactivation removes them (server-owned entries only).
		if ( Array.isArray( serverWindowNotices ) ) {
			applyServerWindowNotices(
				serverWindowNotices as DesktopWindowNoticeServerEntry[],
			);
			config.serverWindowNotices =
				serverWindowNotices as DesktopConfig[ 'serverWindowNotices' ];
		}

		// Desktop-icon sync — re-render the wallpaper shortcut grid
		// on every live menu refresh so a plugin activation adds
		// tiles (and deactivation removes them) without an F5.
		// `renderIcons` clears the prior container before re-rendering,
		// so an empty list legitimately wipes the grid.
		if ( Array.isArray( desktopIcons ) ) {
			const prevDesktopIcons = config.desktopIcons;
			renderIcons( desktopIcons as DesktopIconServerEntry[] );
			config.desktopIcons =
				desktopIcons as DesktopConfig[ 'desktopIcons' ];
			emitRegistryChanged(
				'desktop-icons',
				prevDesktopIcons as ReadonlyArray< { id?: unknown } > | undefined,
				desktopIcons as ReadonlyArray< { id?: unknown } >,
			);
		}

		// Admin-bar "updates" notifier — mirror the aggregate pending-
		// update counts onto Core's `#wp-admin-bar-updates` node (label,
		// screen-reader text, hidden at zero). Without this, the count
		// rendered at shell boot survives every in-window update run
		// until a hard refresh (GH#296). Missing key (older payload)
		// means "no change."
		applyAdminBarUpdates( payload.updateCounts );
	};
}
