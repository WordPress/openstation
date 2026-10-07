import type { DockItem } from './dock';
import { hydrateScriptDeps } from './script-dep-payloads';
import type {
	DesktopCommandScriptServerEntry,
	DesktopCommandServerEntry,
	DesktopConfig,
	DesktopDockRailRendererScriptServerEntry,
	DesktopIconServerEntry,
	DesktopSettingsTabScriptServerEntry,
	DesktopSettingsTabServerEntry,
	DesktopTitleBarButtonScriptServerEntry,
	DesktopWindowActionScriptServerEntry,
	DesktopGameServerEntry,
	DesktopUnfocusEffectScriptServerEntry,
	DesktopWindowLinkRendererScriptServerEntry,
	DesktopWallpaperServerEntry,
	DesktopWidgetServerEntry,
	DesktopWindowNoticeServerEntry,
	DesktopThemeServerEntry,
	NativeWindowScriptData,
	NativeWindowServerEntry,
	NativeWindowWireEntry,
	MultisiteConfig,
} from './types';
import { hydrateServerEntries } from './native-windows';
import { applyServerWindowNotices } from './window-notices-server-sync';
import { applyAdminBarUpdates } from './admin-bar-updates';

export interface MenuRefreshPayload {
	dockItems?: unknown;
	nativeWindows?: unknown;
	nativeWindowScriptData?: unknown;
	serverWidgets?: unknown;
	serverWallpapers?: unknown;
	serverCommandScripts?: unknown;
	serverCommands?: unknown;
	serverSettingsTabScripts?: unknown;
	serverSettingsTabs?: unknown;
	serverDockRailRendererScripts?: unknown;
	serverTitleBarButtonScripts?: unknown;
	serverWindowActionScripts?: unknown;
	serverUnfocusEffectScripts?: unknown;
	serverWindowLinkRendererScripts?: unknown;
	serverWindowNotices?: unknown;
	serverGames?: unknown;
	serverDesktopThemes?: unknown;
	desktopIcons?: unknown;

	scriptDepPayloads?: unknown;
	updateCounts?: unknown;

	multisite?: unknown;
}

export interface MenuRefreshDeps {

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
	syncServerWindowActions: (
		scripts: DesktopWindowActionScriptServerEntry[],
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

	applyMultisite?: ( block: MultisiteConfig | null ) => void;

	syncServerDesktopThemes?: ( list: DesktopThemeServerEntry[] ) => void;
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;

	applyDesktopIcons?: ( icons: DesktopIconServerEntry[] | undefined ) => void;

	refreshRootPlacements?: ( addedIconIds: string[] ) => void;

	syncShortcuts?: () => void;

	syncWindowSubmenus?: () => void;
}

export const REGISTRY_CHANGED_EVENT = 'os-registry-changed';

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
		syncServerWindowActions,
		syncServerUnfocusEffects,
		syncServerWindowLinkRenderers,
		syncServerDockRailRenderers,
		syncServerGames,
		syncServerDesktopThemes,
		renderIcons,
		applyDesktopIcons,
		refreshRootPlacements,
		syncShortcuts,
		syncWindowSubmenus,
		applyMultisite,
	} = deps;

	const harvestedIcons = new Map< string, string >();

	const iconIds = (
		list: ReadonlyArray< { id?: unknown } > | undefined,
	): string[] => ( list ?? [] ).map( ( icon ) => String( icon?.id ?? '' ) );

	const iconIdSet = (
		list: ReadonlyArray< { id?: unknown } > | undefined,
	): string => iconIds( list ).sort().join( '\n' );

	return function applyPayload( payload: MenuRefreshPayload ): void {
		hydrateScriptDeps( payload );

		if ( payload.scriptDepPayloads && typeof payload.scriptDepPayloads === 'object' ) {
			config.scriptDepPayloads = {
				...config.scriptDepPayloads,
				...( payload.scriptDepPayloads as DesktopConfig[ 'scriptDepPayloads' ] ),
			};
		}
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
		const serverWindowActionScripts = payload.serverWindowActionScripts;
		const serverUnfocusEffectScripts = payload.serverUnfocusEffectScripts;
		const serverWindowLinkRendererScripts =
			payload.serverWindowLinkRendererScripts;
		const serverWindowNotices = payload.serverWindowNotices;
		const serverGames = payload.serverGames;
		const serverDesktopThemes = payload.serverDesktopThemes;
		const desktopIcons = payload.desktopIcons;

		if ( ! Array.isArray( dockItems ) || dockItems.length === 0 ) {
			return;
		}
		for ( const item of dockItems as Array< { url?: unknown; icon?: unknown } > ) {
			if ( ! item || typeof item.url !== 'string' || typeof item.icon !== 'string' ) {
				continue;
			}
			if ( item.icon.startsWith( 'url(' ) ) {
				harvestedIcons.set( item.url, item.icon );
			} else if ( item.icon === 'dashicons-admin-generic' && harvestedIcons.has( item.url ) ) {
				item.icon = harvestedIcons.get( item.url );
			}
		}
		const prevDockItems = config.dockItems;
		applyDockItems( dockItems as DesktopConfig[ 'dockItems' ] );
		config.dockItems = dockItems as DesktopConfig[ 'dockItems' ];
		emitRegistryChanged(
			'dock-items',
			prevDockItems as ReadonlyArray< { id?: unknown } > | undefined,
			dockItems as ReadonlyArray< { id?: unknown } >,
		);

		syncShortcuts?.();
		syncWindowSubmenus?.();

		if ( Array.isArray( nativeWindows ) ) {
			const prevNativeWindows = config.nativeWindows;

			void syncNativeWindows(
				hydrateServerEntries(
					nativeWindows as NativeWindowWireEntry[],
					payload.nativeWindowScriptData as
						| NativeWindowScriptData
						| undefined,
				),
			);
			config.nativeWindows =
				nativeWindows as DesktopConfig[ 'nativeWindows' ];

			if ( payload.nativeWindowScriptData ) {
				config.nativeWindowScriptData =
					payload.nativeWindowScriptData as DesktopConfig[ 'nativeWindowScriptData' ];
			}
			emitRegistryChanged(
				'native-windows',
				prevNativeWindows as ReadonlyArray< { id?: unknown } > | undefined,
				nativeWindows as ReadonlyArray< { id?: unknown } >,
			);
		}

		if ( Array.isArray( serverWidgets ) ) {
			void syncServerWidgets(
				serverWidgets as DesktopWidgetServerEntry[],
			);
			config.serverWidgets =
				serverWidgets as DesktopConfig[ 'serverWidgets' ];
		}

		if ( Array.isArray( serverWallpapers ) ) {
			void syncServerWallpapers(
				serverWallpapers as DesktopWallpaperServerEntry[],
			);
			config.serverWallpapers =
				serverWallpapers as DesktopConfig[ 'serverWallpapers' ];
		}

		if ( Array.isArray( serverGames ) ) {
			void syncServerGames( serverGames as DesktopGameServerEntry[] );
			config.serverGames =
				serverGames as DesktopConfig[ 'serverGames' ];
		}

		if ( Array.isArray( serverDesktopThemes ) ) {
			syncServerDesktopThemes?.(
				serverDesktopThemes as DesktopThemeServerEntry[],
			);
			config.serverDesktopThemes =
				serverDesktopThemes as DesktopConfig[ 'serverDesktopThemes' ];
		}

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

		if ( Array.isArray( serverTitleBarButtonScripts ) ) {
			void syncServerTitleBarButtons(
				serverTitleBarButtonScripts as DesktopTitleBarButtonScriptServerEntry[],
			);
			config.serverTitleBarButtonScripts =
				serverTitleBarButtonScripts as DesktopConfig[ 'serverTitleBarButtonScripts' ];
		}

		if ( Array.isArray( serverWindowActionScripts ) ) {
			void syncServerWindowActions(
				serverWindowActionScripts as DesktopWindowActionScriptServerEntry[],
			);
			config.serverWindowActionScripts =
				serverWindowActionScripts as DesktopConfig[ 'serverWindowActionScripts' ];
		}

		if ( Array.isArray( serverUnfocusEffectScripts ) ) {
			void syncServerUnfocusEffects(
				serverUnfocusEffectScripts as DesktopUnfocusEffectScriptServerEntry[],
			);
			config.serverUnfocusEffectScripts =
				serverUnfocusEffectScripts as DesktopConfig[ 'serverUnfocusEffectScripts' ];
		}

		if ( Array.isArray( serverWindowLinkRendererScripts ) ) {
			void syncServerWindowLinkRenderers(
				serverWindowLinkRendererScripts as DesktopWindowLinkRendererScriptServerEntry[],
			);
			config.serverWindowLinkRendererScripts =
				serverWindowLinkRendererScripts as DesktopConfig[ 'serverWindowLinkRendererScripts' ];
		}

		if ( Array.isArray( serverDockRailRendererScripts ) ) {
			void syncServerDockRailRenderers(
				serverDockRailRendererScripts as DesktopDockRailRendererScriptServerEntry[],
			);
			config.serverDockRailRendererScripts =
				serverDockRailRendererScripts as DesktopConfig[ 'serverDockRailRendererScripts' ];
		}

		if ( Array.isArray( serverWindowNotices ) ) {
			applyServerWindowNotices(
				serverWindowNotices as DesktopWindowNoticeServerEntry[],
			);
			config.serverWindowNotices =
				serverWindowNotices as DesktopConfig[ 'serverWindowNotices' ];
		}

		if ( Array.isArray( desktopIcons ) ) {
			const prevDesktopIcons = config.desktopIcons;
			renderIcons( desktopIcons as DesktopIconServerEntry[] );
			applyDesktopIcons?.( desktopIcons as DesktopIconServerEntry[] );
			syncShortcuts?.();

			if (
				iconIdSet(
					prevDesktopIcons as ReadonlyArray< { id?: unknown } >,
				) !==
				iconIdSet( desktopIcons as ReadonlyArray< { id?: unknown } > )
			) {
				const prevIds = new Set(
					iconIds( prevDesktopIcons as ReadonlyArray< { id?: unknown } > ),
				);
				refreshRootPlacements?.(
					iconIds( desktopIcons as ReadonlyArray< { id?: unknown } > ).filter(
						( id ) => id !== '' && ! prevIds.has( id ),
					),
				);
			}
			config.desktopIcons =
				desktopIcons as DesktopConfig[ 'desktopIcons' ];
			emitRegistryChanged(
				'desktop-icons',
				prevDesktopIcons as ReadonlyArray< { id?: unknown } > | undefined,
				desktopIcons as ReadonlyArray< { id?: unknown } >,
			);
		}

		applyAdminBarUpdates( payload.updateCounts );

		if ( 'multisite' in payload ) {
			applyMultisite?.( ( payload.multisite ?? null ) as MultisiteConfig | null );
		}
	};
}
