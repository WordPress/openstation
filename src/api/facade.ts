import {
	HOOKS,
	doAction,
	isReady,
	rawHooks,
	whenReady,
} from '../hooks';
import {
	applyTileClasses,
	applyTileElement,
	applyTileTooltip,
	dispatchTileRendered,
	isDockElement,
	registerDockSelector,
} from '../dock-helpers';
import { renderIcon } from '../icon';
import { deriveWindowId } from '../utils';
import { announceContentChange, broadcast, subscribe } from '../broadcast';
import { devtools } from '../devtools';
import { showToast } from '../toast';
import { activity } from '../activity';
import { heartbeat } from '../heartbeat';
import { presenceApi } from '../presence';
import { workAreaApi } from '../work-area';
import { selectionApi } from '../selection';
import { createSharedStore } from '../shared-store';
import { osConfirm } from '../os-confirm';
import { loadVendorScript } from '../wallpapers/vendor-loader';
import { collectWallpaperSurfaces } from '../wallpapers/surfaces';
import { renderKeyedList, clearKeyedList } from '../ui/util/keyed-list';
import { createInfiniteList } from '../infinite-list';
import { startOAuth } from '../oauth-relay';
import {
	cloneTemplate,
	onWindow,
} from '../native-windows';
import { repaintLoadingOverlays } from '../window/loading';
import { loadModules, registerModule } from '../modules/registry';
import * as wallpaperRegistry from '../wallpapers/registry';
import * as widgetRegistry from '../widgets/registry';
import {
	listCommands,
	registerCommand,
	unregisterCommand,
} from '../commands';
import {
	listDestructiveAdminActions,
	registerDestructiveAdminAction,
	unregisterDestructiveAdminAction,
} from '../destructive-admin-actions';
import {
	listSettingsTabs,
	registerSettingsTab,
	unregisterSettingsTab,
	type OsSettingsSnapshot,
} from '../settings/registry';
import {
	listDockRailRenderers,
	registerDockRailRenderer,
	unregisterDockRailRenderer,
} from '../dock-rail';
import {
	listTitleBarButtons,
	registerTitleBarButton,
	unregisterTitleBarButton,
} from '../title-bar-buttons/registry';
import {
	listWindowActions,
	registerWindowAction,
	unregisterWindowAction,
} from '../window-actions/registry';
import {
	listUnfocusEffects,
	registerUnfocusEffect,
	unregisterUnfocusEffect,
} from '../effects/registry';
import {
	listWindowReveals,
	registerWindowReveal,
	unregisterWindowReveal,
} from '../reveals/registry';
import { relationsApi } from '../window-links/engine';
import {
	listWindowLinkRenderers,
	registerWindowLinkRenderer,
	unregisterWindowLinkRenderer,
} from '../window-links/renderer-registry';
import {
	listWindowThemes,
	registerWindowTheme,
	unregisterWindowTheme,
} from '../window-chrome/themes/registry';
import {
	listWindowControls,
	registerWindowControl,
	unregisterWindowControl,
} from '../window-chrome/controls/registry';
import {
	listWindowSlots,
	registerWindowSlot,
	unregisterWindowSlot,
} from '../window-chrome/slots/registry';
import {
	dismissWindowNotice,
	listWindowNotices,
	registerWindowNotice,
	undismissWindowNotice,
	unregisterWindowNotice,
} from '../window-notices';
import {
	listWindowChromes,
	registerWindowChrome,
	unregisterWindowChrome,
} from '../window-chrome/chrome/registry';
import {
	listPalettes,
	openPaletteOnly,
	registerPalette,
	unregisterPalette,
} from '../palette-registry';
import {
	getNotificationPermission,
	getPwaState,
	notify as pwaNotify,
	promptInstall,
	requestNotificationPermission,
	subscribePwaState,
	undismissInstallHint,
} from '../pwa';
import { trackedFetch } from '../boot/tracked-fetch';
import { embedAdminPage } from '../native-windows';

import type {
	DesktopDebugWindow,
	OpenStationPublicApi,
} from '../desktop';
import type { WindowManager } from '../window-manager';
import type { Window as DesktopWindow } from '../window';
import type { Dock, SystemDockItem } from '../dock';
import type { LayoutDispatcher } from '../desktop-layout';
import type { OsSettings } from '../settings';
import type { IconsApi } from '../desktop-icons';
import { osIconSetApi } from '../ui/icons';
import type { FilesApi } from '../desktop-files';
import type { WidgetLayer } from '../widgets/layer';
import type { AiAssistantApi } from '../ai-assistant';
import type { DragBridgeApi } from '../drag-bridge';
import type { DragManagerApi } from '../drag';
import type { WindowConnection, ConnectOptions } from '../connection';
import type { WallpaperDef } from '../wallpapers/types';
import type { WallpaperSuspendApi } from '../wallpapers/layer';
import type { MioApi } from '../mio/controller';
import type { OsModeApi } from '../mode';
import type { WorkspacesApi } from '../workspaces/api';
import { gamesApi } from '../games/api';
import { applyDesktopTheme } from '../desktop-themes/apply';
import {
	resolveThemedIcon,
	resolveThemedIconColor,
} from '../desktop-themes/icons';
import {
	ensureFullDesktopThemes,
	getActiveDesktopThemeId,
	listDesktopThemes,
	subscribeDesktopThemes,
} from '../desktop-themes/registry';
import { loadComponents } from '../ui/components/loader';
import { registerNativeUrlRemap } from '../native-url-remap';
import type { NativeWindowDef, DesktopConfig } from '../types';

export const RESERVED_NAMESPACE_KEYS: ReadonlySet< string > = new Set( [
	'windowManager', 'dock', 'sideDock', 'taskbar', 'desktopLayout',
	'dockPlacement', 'icons', 'iconSet',
	'files', 'confirm', 'saveSession', 'hooks', 'HOOKS',
	'isActive', 'registerWallpaper', 'registerWidget', 'widgetLayer', 'widgets',
	'registerSystemTile', 'registerWindow', 'openWindow', 'openNewWindow',
	'cloneTemplate', 'onWindow', 'createInfiniteList', 'startOAuth',
	'repaintLoadingOverlays',
	'loadVendorScript', 'getWallpaperSurfaces', 'wallpaper', 'games', 'mode',
	'deactivationFeedback',
	'registerModule',
	'loadModules', 'whenReady', 'ready', 'isReady', 'setDefaultWindow',
	'refreshMenu', 'config', 'ai', 'dragBridge', 'dragManager', 'registerCommand',
	'unregisterCommand', 'listCommands',
	'registerDestructiveAdminAction', 'unregisterDestructiveAdminAction',
	'listDestructiveAdminActions',
	'registerSettingsTab',
	'unregisterSettingsTab', 'listSettingsTabs',
	'registerDockRailRenderer', 'unregisterDockRailRenderer', 'listDockRailRenderers',
	'openOsSettings', 'getOsSettings', 'subscribeOsSettings', 'updateOsSettings',
	'resetOsSettings',
	'deriveWindowId',
	'listSystemTiles', 'getSystemTile', 'getMenuItems',
	'getNavItems', 'getNav',
	'renderIcon',
	'applyTileClasses', 'applyTileElement', 'applyTileTooltip',
	'dispatchTileRendered',
	'isDockElement', 'registerDockSelector',
	'registerTitleBarButton',
	'unregisterTitleBarButton', 'listTitleBarButtons',
	'registerWindowAction', 'unregisterWindowAction', 'listWindowActions',
	'registerUnfocusEffect', 'unregisterUnfocusEffect', 'listUnfocusEffects',
	'registerWindowReveal', 'unregisterWindowReveal', 'listWindowReveals',
	'relations',
	'registerWindowLinkRenderer', 'unregisterWindowLinkRenderer',
	'listWindowLinkRenderers',
	'registerWindowTheme', 'unregisterWindowTheme', 'listWindowThemes',
	'applyWindowTheme', 'desktopThemes',
	'registerWindowControl', 'unregisterWindowControl', 'listWindowControls',
	'applyWindowControls',
	'registerWindowSlot', 'unregisterWindowSlot', 'listWindowSlots',
	'applyWindowSlot',
	'registerWindowNotice', 'unregisterWindowNotice', 'listWindowNotices',
	'dismissWindowNotice', 'undismissWindowNotice',
	'registerWindowChrome', 'unregisterWindowChrome', 'listWindowChromes',
	'applyWindowChrome',
	'connect', 'getConnection',
	'broadcast', 'subscribe', 'announceContentChange',
	'registerPalette', 'unregisterPalette',
	'listPalettes', 'openPalette', 'devtools', 'createSharedStore',
	'presence', 'workArea', 'selection', 'activity', 'heartbeat', 'showToast',
	'renderKeyedList',
	'clearKeyedList', 'registerNamespace',
	'notify', 'pwa',
	'getWindowConfig', 'getWindowParams', 'debug',
	'registerNativeUrlRemap',
	'fetch',
] );

export interface BuildPublicApiDeps {
	manager: WindowManager;
	dock: Dock | null;
	layoutDispatcher: LayoutDispatcher | null;
	osSettings: OsSettings;
	iconsApi: IconsApi;
	filesApi: FilesApi;
	saveSession: () => void;
	widgetLayer: WidgetLayer | null;
	registerWindow: ( def: NativeWindowDef ) => Promise< DesktopWindow >;
	openWindowById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;
	openNewWindowById: (
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	) => boolean;
	loadWindowScriptById: ( id: string ) => Promise< boolean >;
	prewarmWindowById: ( id: string ) => Promise< boolean >;
	placeSystemTile: ( item: SystemDockItem ) => void;
	setDefaultWindow: ( url: string | null ) => Promise< void >;
	refreshMenu: () => Promise< void >;
	openOsSettings: ( opts?: { tabId?: string } ) => void;
	aiAssistant: AiAssistantApi;
	dragBridge: DragBridgeApi;
	dragManager: DragManagerApi;
	connect: ( targetWindowId: string, opts?: ConnectOptions ) => WindowConnection;
	getConnection: ( connectionId: string ) => WindowConnection | null;
	wallpaperSuspend: WallpaperSuspendApi;
	mio: MioApi;

	mode: OsModeApi;
	workspaces: WorkspacesApi;
	config: DesktopConfig;
}

export function buildPublicApi( deps: BuildPublicApiDeps ): OpenStationPublicApi {
	const {
		manager,
		dock,
		layoutDispatcher,
		osSettings,
		iconsApi,
		filesApi,
		saveSession,
		widgetLayer,
		registerWindow,
		openWindowById,
		openNewWindowById,
		loadWindowScriptById,
		prewarmWindowById,
		placeSystemTile,
		setDefaultWindow,
		refreshMenu,
		openOsSettings,
		aiAssistant,
		dragBridge,
		dragManager,
		connect,
		getConnection,
		wallpaperSuspend,
		mio,
		mode,
		workspaces,
		config,
	} = deps;

	const desktopApi: OpenStationPublicApi = {
		windowManager: manager,
		dock,
		sideDock: layoutDispatcher?.getSide() ?? null,
		desktopLayout: osSettings.getOsSettingsSnapshot().desktopLayout,
		dockPlacement:
			layoutDispatcher?.getDockPlacement() ??
			osSettings.getOsSettingsSnapshot().dockPlacement,
		icons: iconsApi,
		iconSet: osIconSetApi,
		files: filesApi,
		confirm: osConfirm,
		saveSession,
		hooks: rawHooks(),
		HOOKS,
		isActive: () => !! document.getElementById( 'os-shell' ),
		registerWallpaper: ( def: WallpaperDef ) => {
			wallpaperRegistry.register( def );

			osSettings.apply();
		},
		registerWidget: ( def ) => {
			widgetRegistry.register( def );
		},
		widgetLayer,
		widgets: {
			redock: ( id: string ) => {
				widgetLayer?.redock( id );
			},
		},
		loadVendorScript,
		getWallpaperSurfaces: () => collectWallpaperSurfaces( manager ),
		wallpaper: wallpaperSuspend,
		mio,
		mode,
		games: gamesApi,
		registerWindow,
		openWindow: openWindowById,
		openNewWindow: openNewWindowById,

		embedAdminPage,
		loadWindowScript: loadWindowScriptById,
		prewarmWindow: prewarmWindowById,

		loadComponents,
		fetch: ( input, requestInit, opts ) =>
			trackedFetch( manager, input, requestInit, opts ),
		repaintLoadingOverlays,
		cloneTemplate,
		onWindow,
		createInfiniteList,
		startOAuth,
		registerSystemTile: ( item ) => {
			placeSystemTile( item );
			doAction( HOOKS.DOCK_ITEM_APPENDED, { id: item.id } );
		},
		registerModule,
		loadModules,
		whenReady,
		ready: whenReady,
		isReady,
		setDefaultWindow,
		refreshMenu,
		config,
		ai: aiAssistant,
		dragBridge,
		dragManager,
		registerCommand,
		unregisterCommand,
		listCommands,
		registerDestructiveAdminAction,
		unregisterDestructiveAdminAction,
		listDestructiveAdminActions,
		registerSettingsTab,
		unregisterSettingsTab,
		listSettingsTabs,
		registerDockRailRenderer,
		unregisterDockRailRenderer,
		listDockRailRenderers,
		openOsSettings,
		getOsSettings: () => osSettings.getOsSettingsSnapshot(),
		subscribeOsSettings: ( cb: ( snapshot: OsSettingsSnapshot ) => void ) =>
			osSettings.subscribeOsSettings( cb ),
		updateOsSettings: (
			patch: Partial< OsSettingsSnapshot >,
			opts: { windowId?: string } = {},
		) => {
			osSettings.update( patch, opts );

			if ( patch.navPlacement || patch.navOrder ) {
				layoutDispatcher?.refresh();
			}
		},
		resetOsSettings: ( opts: { windowId?: string } = {} ) => {
			osSettings.reset( opts );
			layoutDispatcher?.refresh();
		},
		deriveWindowId: ( url: string, overrideAdminUrl?: string ) =>
			deriveWindowId( url, overrideAdminUrl ?? config.adminUrl ),
		listSystemTiles: () => layoutDispatcher?.listSystemTiles() ?? [],
		getSystemTile: ( id: string ) =>
			layoutDispatcher?.getSystemTile( id ) ?? null,
		getMenuItems: () => layoutDispatcher?.getMenuItems() ?? [],
		getNavItems: () => layoutDispatcher?.getNavItems() ?? [],
		getNav: () => layoutDispatcher?.getNav() ?? null,
		renderIcon,
		applyTileClasses,
		applyTileElement,
		applyTileTooltip,
		dispatchTileRendered,
		isDockElement,
		registerDockSelector,
		registerTitleBarButton,
		unregisterTitleBarButton,
		listTitleBarButtons,
		registerWindowAction,
		unregisterWindowAction,
		listWindowActions,
		registerUnfocusEffect,
		unregisterUnfocusEffect,
		listUnfocusEffects,
		registerWindowReveal,
		unregisterWindowReveal,
		listWindowReveals,
		relations: relationsApi,
		registerWindowLinkRenderer,
		unregisterWindowLinkRenderer,
		listWindowLinkRenderers,
		registerWindowTheme,
		unregisterWindowTheme,
		listWindowThemes,
		desktopThemes: {
			list: listDesktopThemes,
			getActive: getActiveDesktopThemeId,
			setActive: applyDesktopTheme,

			ensureFull: ensureFullDesktopThemes,
			subscribe: subscribeDesktopThemes,
			resolveIcon: resolveThemedIcon,
			resolveIconColor: resolveThemedIconColor,
			applyRecommendedOsSettings: ( themeId ) => {
				const target = themeId !== undefined ? themeId : ( getActiveDesktopThemeId() ?? '' );

				return osSettings.applyThemeRecommendations( target );
			},
		},
		applyWindowTheme: ( windowId, override ) => {
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			win.setAppearanceTheme( override );
		},
		registerWindowControl,
		unregisterWindowControl,
		listWindowControls,
		applyWindowControls: ( windowId, override ) => {
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			win.setAppearanceControls( override );
		},
		registerWindowSlot,
		unregisterWindowSlot,
		listWindowSlots,
		applyWindowSlot: ( windowId, slot, slotConfig ) => {
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			win.setAppearanceSlot( slot, slotConfig );
		},
		registerWindowNotice,
		unregisterWindowNotice,
		listWindowNotices,
		dismissWindowNotice,
		undismissWindowNotice,
		registerWindowChrome,
		unregisterWindowChrome,
		listWindowChromes,
		applyWindowChrome: ( windowId, chromeId ) => {
			const win = manager.getById( windowId );
			if ( ! win ) {
				return;
			}
			win.setAppearanceChrome( chromeId );
		},
		connect,
		getConnection,
		broadcast,
		subscribe,
		announceContentChange,
		registerPalette,
		unregisterPalette,
		listPalettes,
		openPalette: openPaletteOnly,
		devtools,
		createSharedStore,
		presence: presenceApi,
		workArea: workAreaApi,
		workspaces,
		selection: selectionApi,
		activity,
		heartbeat,
		showToast,
		notify: pwaNotify,
		pwa: {
			promptInstall,
			undismissInstallHint,
			getState: getPwaState,
			subscribe: subscribePwaState,
			requestNotificationPermission,
			getNotificationPermission,
		},
		renderKeyedList,
		clearKeyedList,
		registerNamespace: ( name: string, api: object ) => {
			if ( typeof name !== 'string' || name === '' ) {
				console.warn(
					'[openstation] registerNamespace: name must be a non-empty string',
				);
				return;
			}
			if ( ! api || typeof api !== 'object' ) {
				console.warn(
					`[openstation] registerNamespace("${ name }"): api must be an object`,
				);
				return;
			}
			if ( RESERVED_NAMESPACE_KEYS.has( name ) ) {
				console.warn(
					`[openstation] registerNamespace("${ name }"): name is reserved by the shell — pick a plugin-specific key`,
				);
				return;
			}
			( desktopApi as unknown as Record< string, unknown > )[ name ] = api;

			const live = window.wp?.os as unknown as Record< string, unknown > | undefined;
			if ( live && live !== ( desktopApi as unknown ) ) {
				live[ name ] = api;
			}
		},
		getWindowConfig: < T = Record< string, unknown > >(
			id: string,
		): T | undefined => {
			const store = window.openStationWindowConfig;
			if ( ! store || typeof store !== 'object' ) {
				return undefined;
			}
			const value = ( store as Record< string, unknown > )[ id ];
			return value === undefined ? undefined : ( value as T );
		},

		getWindowParams: (
			id: string,
		): Record< string, string | number | boolean > | undefined => {
			const win = manager.getById( id );
			if ( ! win ) {
				return undefined;
			}

			return { ...( win.config.params ?? {} ) };
		},

		registerNativeUrlRemap,
		debug: {
			window: ( id: string ): DesktopDebugWindow | null => {
				const entry = ( config.nativeWindows ?? [] ).find(
					( e ) => e.id === id,
				);
				if ( ! entry ) {
					return null;
				}

				const url =
					entry.scriptUrl ||
					( entry.scriptHandle
						? config.nativeWindowScriptData?.[ entry.scriptHandle ]
							?.url ?? ''
						: '' );
				let loadPath: 'eager' | 'lazy' | 'unknown' = 'unknown';
				let tagInDom = false;
				if ( url ) {
					const lazyTag = document.querySelector(
						`script[data-os-vendor="${ url.replace( /"/g, '\\"' ) }"]`,
					);
					if ( lazyTag ) {
						loadPath = 'lazy';
						tagInDom = true;
					} else {
						const eagerTag = Array.from(
							document.querySelectorAll< HTMLScriptElement >(
								'script[src]',
							),
						).find( ( s ) => s.src === url );
						if ( eagerTag ) {
							loadPath = 'eager';
							tagInDom = true;
						}
					}
				}
				const cfgStore = window.openStationWindowConfig;
				const configPresent = !! (
					cfgStore &&
					typeof cfgStore === 'object' &&
					Object.prototype.hasOwnProperty.call( cfgStore, id )
				);
				return {
					id,
					scriptHandle: entry.scriptHandle || '',
					scriptUrl: url,
					loadPath,
					tagInDom,
					configPresent,
					extras: {
						hasTranslations: !! entry.scriptTranslations,
						l10nCount: ( entry.scriptL10n ?? [] ).length,
						beforeCount: ( entry.scriptBefore ?? [] ).length,
						afterCount: ( entry.scriptAfter ?? [] ).length,
					},
				};
			},
		},
	};

	return desktopApi;
}

export function installPublicApi( api: OpenStationPublicApi ): void {
	if ( ! window.wp ) {
		window.wp = {};
	}
	if ( ! window.wp.os ) {
		window.wp.os = api;
		return;
	}
	Object.assign(
		window.wp.os as unknown as Record< string, unknown >,
		api as unknown as Record< string, unknown >,
	);
}
