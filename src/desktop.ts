import { WindowManager } from './window-manager';
import { installWindowSwitcherShortcut } from './window-manager/switcher';
import { installTextEntryGuard } from './text-entry-guard';
import { installDesktopArrowShortcuts } from './window-manager/desktop-shortcuts';
import { installCloseAllShortcut } from './window-manager/close-all-shortcut';
import {
	installWindowLoadingTransitions,
} from './window/loading';
import {
	Dock,
	type DockItem,
	type SubmenuItem,
	type SystemDockItem,
} from './dock';
import {
	bindNativeUrlRemap,
	isPersonViewClaimed,
	registerNativeUrlRemap,
	tryNativeUrlRemap,
} from './native-url-remap';
import type { NativeUrlRemap } from './native-url-remap';
import { matchesStationHomeUrl } from './open-targets/station-home-url';
import { bindAdminLinkDispatch } from './window/iframe-bridge';
import { syncOpenWindowSubmenus } from './window/submenu-sync';
import type { DestructiveAdminActionEntry } from './destructive-admin-actions';

import { OsSettings } from './settings';
import { OS_SETTINGS_WINDOW_ID } from './settings/constants';
import { getExitOpenStationTileDef } from './exit-openstation';
import { getNetworkAdminTileDef } from './multisite/dock-tiles';
import { createHopMinter, hopToAdmin, type HopMinter } from './multisite/hop';
import { buildSiteSwitcher, installSiteSwitcherKeys, switchToSite } from './multisite/site-switcher';
import { createLinkPoster, offerAccountLink } from './multisite/link-offer';
import { revealInstance, stampArrival } from './multisite/instance-transition';
import { installOverviewHeader, refreshOverviewTopBar } from './window-manager/overview';
import { deriveWindowId, urlMatchKey } from './utils';
import { shellUrlWithoutBootArgs } from './shell-url';
import {
	HOOKS,
	addAction,
	doAction,
	type WpHooks,
} from './hooks';
import { WallpaperLayer } from './wallpapers/layer';
import type { WallpaperSuspendApi } from './wallpapers/layer';
import { gamesApi } from './games/api';
import type { GamesApi } from './games/api';
import type { WindowActionDef } from './window-actions/registry';
import { createWallpaperRegistrySync } from './wallpapers/server-sync';
import { createGamesRegistrySync } from './games/server-sync';
import { createDesktopThemeSync } from './desktop-themes/server-sync';
import type {
	DesktopThemeEntry,
	DesktopThemeState,
	RecommendedOsSettings,
} from './desktop-themes/types';
import { DESKTOP_THEME_CHANGED_EVENT } from './desktop-themes/apply';
import { bootGamesChallenges } from './games/challenges-client';
import { createCommandRegistrySync } from './commands/server-sync';
import { createSettingsTabRegistrySync } from './settings/server-sync';
import {
	type DesktopSettingsTab,
	type OsSettingsSnapshot,
} from './settings/registry';
import {
	type TitleBarButtonDef,
} from './title-bar-buttons/registry';
import { createTitleBarButtonRegistrySync } from './title-bar-buttons/server-sync';
import { createWindowActionRegistrySync } from './window-actions/server-sync';
import { type UnfocusEffectDef } from './effects/types';
import { type WindowRevealDef } from './reveals/types';
import { startWindowLinksEngine } from './window-links/engine';
import { bootRelatedEntities } from './related-entities';
import { bootEditorPreview } from './editor-preview';
import { bootRevisions } from './revisions';
import type {
	WindowLinkRendererDef,
	WindowRelationsApi,
} from './window-links/types';
import { createUnfocusEffectRegistrySync } from './effects/server-sync';
import { createWindowLinkRendererRegistrySync } from './window-links/server-sync';
import { ensureWindowLinkVisuals } from './window-links/ensure-visuals';
import { registerBuiltInLinkRendererStub } from './window-links/stub-renderer';
import { startUnfocusEngine } from './effects/unfocus-engine';
import { startWindowRevealEngine } from './reveals/engine';
import { createDockRailRendererSync } from './dock-rail/server-sync';
import { installDockConstellationSentinel } from './dock-constellation/sentinel';
import {
	type WindowThemeDef,
} from './window-chrome/themes/registry';
import { createWindowThemeRegistrySync } from './window-chrome/themes/server-sync';
import {
	type WindowControlDef,
} from './window-chrome/controls/registry';
import { registerBuiltInControls } from './window-chrome/controls/built-ins';
import { createWindowControlRegistrySync } from './window-chrome/controls/server-sync';
import {
	type WindowSlotDef,
} from './window-chrome/slots/registry';
import { createWindowSlotRegistrySync } from './window-chrome/slots/server-sync';
import { applyServerWindowNotices } from './window-notices-server-sync';
import {
	type WindowChromeDef,
} from './window-chrome/chrome/registry';
import { createWindowChromeRegistrySync } from './window-chrome/chrome/server-sync';
import {
	createConnectionBridge,
	type WindowConnection,
	type ConnectOptions,
} from './connection';
import { IframeCommandBridge } from './commands/iframe-bridge';
import { installWindowActivityNotifier } from './window-activity-notifier';
import { ShellCommandHarvester } from './commands/shell-harvester';
import { PALETTE_ASSETS_READY_EVENT } from './commands/palette-assets';
import { type ScriptExtras } from './wallpapers/vendor-loader';
import {
	type WallpaperSurface,
} from './wallpapers/surfaces';
import { WidgetLayer } from './widgets/layer';
import {
	createNativeWindowSync,
	createRegisterWindow,
	hydrateServerEntries,
	type NativeWindowRestoreState,
	type WindowLifecycleHandlers,
} from './native-windows';
import { iconsApi, renderDesktopIcons, type IconsApi } from './desktop-icons';
import type { OsIconSetApi } from './ui/icons';
import {
	createLayoutDispatcher,
	type LayoutDispatcher,
} from './desktop-layout';

import { AiAssistantStub, type AiAssistantApi } from './ai-assistant';
import { createAsk } from './ai/ask';
import {
	attachBroadcastBus,
	installBroadcastReceiver,
} from './broadcast';
import { startRecycleBinIconState, _currentRecycleBinCount } from './desktop-files/recycle-bin-icon-state';
import { registerBuiltInPeekRenderers } from './dock-peek/built-in-renderers';
import {
	BUG_REPORT_WINDOW_ID,
	renderBugReport,
} from './bug-report';
import { ensureDeferredStyle } from './deferred-styles';
import { showToast, type ToastOptions } from './toast';
import { restErrorFromResponse } from './core/api-client';
import { __, sprintf } from './i18n';
import {
	bootstrapPwa,
	type NotifyOptions,
} from './pwa';
import {
	getInstallTileDef,
	isStandaloneDisplay,
	isLikelyInstalled,
} from './pwa/install';
import { type KeyedListOptions } from './ui/util/keyed-list';
import { DragBridge, type DragBridgeApi } from './drag-bridge';
import { DragManager, type DragManagerApi, DRAG_EVENTS } from './drag';
import { installIframeDropTargets } from './drag/iframe-drop-targets';
import { installFocusWindowOnDragHover } from './drag/focus-window-on-drag-hover';
import {
	type DesktopCommand,
} from './commands';
import { registerBuiltInCommands } from './built-in-commands';
import {
	registerPalette,
	openPaletteOnly,
	installPaletteShortcut,
	listPalettes,
	notifyPaletteVisibility,
	type Palette,
} from './palette-registry';
import { type SharedStore } from './shared-store';
import {
	bootPresenceProbe,
	type PresenceApi,
} from './presence';
import { recentlyMarqueed, type SelectionApi } from './selection';
import { activity, type ActivityApi } from './activity';
import { bootHeartbeatBus, type HeartbeatBus } from './heartbeat';
import { bootPluginPresenceWatch } from './plugin-presence';
import { bootContentChangesHeartbeat } from './content-changes/heartbeat';
import { bootNonceRefresh } from './nonce-refresh';
import { bootAuthRecovery } from './auth-recovery';
import { findDockTitleForUrl } from './boot/geometry';
import { bindTopWindowLinkInterceptor } from './boot/link-interceptor';
import { bindMenuRefresh } from './boot/menu-refresh';
import { hasRestorableSession, openCurrentPage, restoreSession } from './boot/session';
import { shouldAutoOpenCurrentPage } from './boot/auto-open';
import { createSessionSaver } from './boot/session-saver';
import { bindShellLifecycle, wireSessionEvents } from './boot/shell-lifecycle';
import { trackedFetch } from './boot/tracked-fetch';
import { buildPublicApi, installPublicApi } from './api/facade';
import { setCurrentLayout } from './layout';
import {
	installShortcutsSync,
	syncDesktopShortcuts,
} from './nav/desktop-sync';
import { installNotesSentinel } from './notes/sentinel';

import { registerBuiltInWidgets } from './widgets/built-in';
import { maybeShowUpdate } from './update-notice';
import { maybeShowNotices } from './core-notices';
import { setupDevModeWidgetGate } from './widgets/dev-mode-gate';
import {
	installDefaultDockRailRenderer,
	type DockRailRenderer,
} from './dock-rail';
import { createWidgetRegistrySync } from './widgets/server-sync';
import { OS_COMPONENT_TAGS } from './ui/components/tags';
import { startMissingImportWarner } from './ui/components/missing-import-warner';
import {
	registerModule,
	type ModuleDef,
} from './modules/registry';
import {
	MioController,
	MIO_TILE_ICON,
	MIO_TILE_ID,
	type MioApi,
} from './mio/controller';
import { installAdminBarHeight } from './admin-bar-height';
import { installDockBehavior } from './dock-behavior';
import {
	installWorkArea,
	subscribeWorkArea,
	workAreaRectOf,
	type WorkAreaApi,
} from './work-area';
import {
	applyServerWorkspacePresets,
	applyWorkspaceView,
	blankWorkspaceProfile,
	captureWorkspaceAppearance,
	captureWorkspaceWindows,
	createWorkspace,
	createWorkspacesApi,
	getActiveWorkspaceProfile,
	installWorkspaceOverviewControl,
	installWorkspacePresetSync,
	listWorkspacePresets,
	getWorkspaceProfile,
	provisionWorkspace,
	reopenWorkspaceWindows,
	registerWorkspaceCommand,
	saveDeskToWorkspace,
	setWorkspaceProfile,
	withWorkspaceWidget,
	workspaceProfileFromPreset,
	type WorkspaceDeps,
	type WorkspacesApi,
} from './workspaces';
import { openWorkspaceWizard } from './workspaces/wizard-loader';
import { installGridSpanReflow } from './window-manager/grid-snap';
import { all as listWidgetDefs } from './widgets/registry';
import { all as listWallpaperDefs } from './wallpapers/registry';
import { getAccents } from './settings/constants';
import type { WorkspacePreset } from './workspaces/types';
import {
	ASSISTANT_TILE_ID,
	OS_ASSISTANT_ICON,
	OS_OVERVIEW_ICON,
	OS_SYSTEM_ICON,
	OVERVIEW_TILE_ID,
	SYSTEM_TILE_ID,
	SYSTEM_TILE_ORDER,
} from './dock-shell-tiles';
import { toggleFullscreen } from './fullscreen';
import { openShortcutsWith, SHORTCUTS_WINDOW_ID } from './shortcuts';
import { maybeShowRebrandNotice } from './rebrand-notice';
import { installShellTour } from './shell-tour/loader';
import { spendMenuRefresh } from './settings/spend-menu-refresh';
import { maybeAskForUsageFeedback } from './usage-feedback/index';
import { osConfirm } from './os-confirm';
import { preloadShellOverlays } from './shell-overlays/loader';
import { renderIcon } from './icon';
import { installMode, sanitizeModePreference, type OsModeApi } from './mode';
import { installZoomGuard } from './mode/zoom-guard';
import { installMobileConstraints } from './mobile/constraints';
import { ensureMobileLoaded } from './mobile/loader';
import { createNavItemOpener } from './mobile/open-nav-item';
import type { MobileLayerHandle } from './mobile/types';
import { preloadWindowSystem } from './window-system/loader';
import type { WallpaperDef } from './wallpapers/types';

import {
	filesApi,
	filesRest,
	installOpenDeps as installFilesOpenDeps,
	setUserAssociations as setFilesUserAssociations,
	type FilesApi,
} from './desktop-files';
import {
	isSyntheticPlacement,
	mountFilesLayer,
	settleArrivedShortcuts,
} from './desktop-files/layer';
import { installRecycleBinDropTargets } from './desktop-files/recycle-bin-targets';
import { installAgentTileDropHandlers } from './desktop-files/agent-drop-targets';
import { startFilesHeartbeat } from './desktop-files/heartbeat';
import { startFilesRestoreSync } from './desktop-files/restore-sync';
import { listPlacements } from './desktop-files/rest';
import { setFolderPlacements } from './desktop-files/store';
import { buildOccupiedSet, snapToEmptyCell } from './desktop-files/grid';
import {
	buildMenuItems as buildWallpaperMenuItems,
	closeWallpaperMenu,
	isWallpaperMenuOpen,
	openWallpaperMenu,
	type ServerWallpaperMenuItem,
	type SortMode as RootSortMode,
} from './desktop-files/wallpaper-menu';
import { openCreateFolderDialog } from './desktop-files/create-folder-dialog';
import { openUrlDialog } from './desktop-files/overlays-loader';
import { installFileDropSentinel } from './os-file-drop/sentinel';
import { hydrateScriptDeps } from './script-dep-payloads';
import type {
	DesktopConfig,
	DesktopWallpaperServerEntry,
	NativeWindowDef,
	WindowConfig,
} from './types';
import type { Window as DesktopWindow } from './window';

const _earlyReadyQueue: Array< () => void > = [];
let _earlyReady = false;

( function installEarlyDesktopShim() {
	const w = window as { wp?: { os?: unknown } };
	if ( ! w.wp ) {
		w.wp = {};
	}
	if ( w.wp.os ) {
		return;
	}
	const shim = {
		whenReady( cb: () => void ): void {
			if ( typeof cb !== 'function' ) {
				return;
			}
			if ( _earlyReady ) {
				Promise.resolve().then( cb );
				return;
			}
			_earlyReadyQueue.push( cb );
		},
		ready( cb: () => void ): void {
			shim.whenReady( cb );
		},
		isReady(): boolean {
			return _earlyReady;
		},
	};

	w.wp.os = shim as unknown;
}() );

let _idleBootQueue: Array< () => void > = [];
let _idleBootTimeout = Number.POSITIVE_INFINITY;
let _idleBootScheduled = false;
function scheduleIdleBoot( cb: () => void, timeout = 1500 ): void {
	_idleBootQueue.push( cb );
	if ( timeout < _idleBootTimeout ) {
		_idleBootTimeout = timeout;
	}
	if ( _idleBootScheduled ) {
		return;
	}
	_idleBootScheduled = true;
	const drain = (): void => {
		const callbacks = _idleBootQueue;
		const effectiveTimeout = _idleBootTimeout;
		_idleBootQueue = [];
		_idleBootTimeout = Number.POSITIVE_INFINITY;
		_idleBootScheduled = false;
		void effectiveTimeout;
		for ( const fn of callbacks ) {
			try {
				fn();
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] scheduleIdleBoot callback threw:',
						err,
					);
				}
			}
		}
	};
	if ( typeof window.requestIdleCallback === 'function' ) {
		window.requestIdleCallback( drain, { timeout: _idleBootTimeout } );
	} else {
		window.setTimeout( drain, 0 );
	}
}

export interface OpenStationPublicApi {
	windowManager: WindowManager;

	dock: Dock | null;

	sideDock: Dock | null;

	desktopLayout: 'classic' | 'unified';

	dockPlacement: 'bottom' | 'left' | 'right';

	icons: IconsApi;

	iconSet: OsIconSetApi;

	files: FilesApi;

	confirm: ( options: import( './ui/components/os-confirm-dialog/os-confirm-dialog' ).OsConfirmOptions ) => Promise< boolean >;
	saveSession: () => void;

	hooks: WpHooks;

	HOOKS: typeof import( './hooks' ).HOOKS;

	isActive: () => boolean;

	registerWallpaper: ( def: WallpaperDef ) => void;

	wallpaper: WallpaperSuspendApi;

	mio: MioApi;

	mode: OsModeApi;

	games: GamesApi;

	deactivationFeedback?: import( './deactivation-feedback' ).DeactivationFeedbackApi;

	registerWidget: ( def: import( './widgets/types' ).WidgetDef ) => void;

	widgetLayer: WidgetLayer | null;

	widgets: {

		redock: ( id: string ) => void;
	};

	registerSystemTile: ( item: SystemDockItem ) => void;

	registerWindow: ( def: NativeWindowDef ) => Promise< DesktopWindow >;

	openWindow: ( id: string, opts?: { source?: string } ) => boolean;

	openNewWindow: ( id: string, opts?: { source?: string } ) => boolean;

	embedAdminPage: (
		host: HTMLElement,
		url: string,
		opts?: { windowId?: string },
	) => () => void;

	loadWindowScript: ( id: string ) => Promise< boolean >;

	prewarmWindow: ( id: string ) => Promise< boolean >;

	loadComponents: ( tags?: readonly string[] ) => Promise< void >;

	fetch: (
		input: RequestInfo | URL,
		requestInit?: RequestInit,
		opts?: {
			windowId?: string;
			window?: DesktopWindow;
			silent?: boolean;

			source?: string;
		},
	) => Promise< Response >;

	cloneTemplate: ( template: string | HTMLTemplateElement ) => DocumentFragment;

	onWindow: (
		id: string,
		handlers: WindowLifecycleHandlers,
		options?: { persistent?: boolean },
	) => () => void;

	createInfiniteList: < TItem >(
		options: import( './infinite-list' ).InfiniteListOptions< TItem >,
	) => import( './infinite-list' ).InfiniteList;

	startOAuth: (
		service: string,
		options?: import( './oauth-relay' ).StartOAuthOptions,
	) => Promise< import( './oauth-relay' ).OAuthCallbackPayload >;

	loadVendorScript: ( url: string, extras?: ScriptExtras ) => Promise<void>;

	getWallpaperSurfaces: () => WallpaperSurface[];

	registerModule: ( def: ModuleDef ) => void;

	loadModules: ( ids: string[] ) => Promise<void>;

	whenReady: ( cb: () => void ) => void;

	ready: ( cb: () => void ) => void;

	isReady: () => boolean;

	setDefaultWindow: ( url: string | null ) => Promise<void>;

	refreshMenu: () => Promise<void>;

	config: DesktopConfig;

	ai: AiAssistantApi;

	dragBridge: DragBridgeApi;

	dragManager: DragManagerApi;

	registerCommand: ( cmd: DesktopCommand ) => void;

	unregisterCommand: ( slug: string ) => void;

	listCommands: () => DesktopCommand[];

	registerDestructiveAdminAction: (
		entry: DestructiveAdminActionEntry,
	) => () => void;

	unregisterDestructiveAdminAction: ( id: string ) => void;

	listDestructiveAdminActions: () => DestructiveAdminActionEntry[];

	registerSettingsTab: ( tab: DesktopSettingsTab ) => void;

	unregisterSettingsTab: ( id: string ) => void;

	listSettingsTabs: () => DesktopSettingsTab[];

	registerDockRailRenderer: ( renderer: DockRailRenderer ) => void;

	unregisterDockRailRenderer: ( id: string ) => void;

	listDockRailRenderers: () => DockRailRenderer[];

	openOsSettings: ( opts?: { tabId?: string } ) => void;

	getOsSettings: () => OsSettingsSnapshot;

	subscribeOsSettings: (
		cb: ( snapshot: OsSettingsSnapshot ) => void,
	) => () => void;

	updateOsSettings: (
		patch: Partial< OsSettingsSnapshot >,
		opts?: { windowId?: string },
	) => void;

	resetOsSettings: ( opts?: { windowId?: string } ) => void;

	deriveWindowId: ( url: string, adminUrl?: string ) => string;

	listSystemTiles: () => Array< {
		id: string;
		title: string;
		icon: string;

		navKind: 'core' | 'app' | 'control';

		placeable: boolean;

		locked: boolean;
	} >;

	getNavItems: () => import( './nav' ).NavItem[];

	getNav: () => import( './nav' ).NavResult | null;

	getSystemTile: ( id: string ) => SystemDockItem | null;

	getMenuItems: () => DockItem[];

	renderIcon: (
		icon: string,
		opts: { title: string; className?: string },
	) => HTMLElement;

	applyTileClasses: typeof import( './dock-helpers' ).applyTileClasses;

	applyTileElement: typeof import( './dock-helpers' ).applyTileElement;

	applyTileTooltip: typeof import( './dock-helpers' ).applyTileTooltip;

	dispatchTileRendered: typeof import( './dock-helpers' ).dispatchTileRendered;

	isDockElement: ( target: EventTarget | null ) => boolean;

	registerDockSelector: ( selector: string ) => () => void;

	registerTitleBarButton: ( def: TitleBarButtonDef ) => void;

	unregisterTitleBarButton: ( id: string ) => void;

	listTitleBarButtons: () => TitleBarButtonDef[];

	registerWindowAction: ( def: WindowActionDef ) => void;

	unregisterWindowAction: ( id: string ) => void;

	listWindowActions: () => WindowActionDef[];

	registerUnfocusEffect: ( def: UnfocusEffectDef ) => void;

	unregisterUnfocusEffect: ( id: string ) => void;

	listUnfocusEffects: () => UnfocusEffectDef[];

	registerWindowReveal: ( def: WindowRevealDef ) => void;

	unregisterWindowReveal: ( id: string ) => void;

	listWindowReveals: () => WindowRevealDef[];

	relations: WindowRelationsApi;

	registerWindowLinkRenderer: ( def: WindowLinkRendererDef ) => void;

	unregisterWindowLinkRenderer: ( id: string ) => void;

	listWindowLinkRenderers: () => WindowLinkRendererDef[];

	registerWindowTheme: ( def: WindowThemeDef ) => void;

	unregisterWindowTheme: ( id: string ) => void;

	listWindowThemes: () => WindowThemeDef[];

	desktopThemes: {

		list: () => DesktopThemeEntry[];

		getActive: () => string | null;

		setActive: ( themeId: string ) => void;

		ensureFull: () => Promise< void >;

		subscribe: (
			cb: ( state: Readonly< DesktopThemeState > ) => void,
		) => () => void;

		resolveIcon: ( slot: string ) => string | null;

		resolveIconColor: ( slot: string ) => string | null;

		applyRecommendedOsSettings: (
			themeId?: string,
		) => RecommendedOsSettings;
	};

	registerWindowControl: ( def: WindowControlDef ) => void;

	unregisterWindowControl: ( id: string ) => void;

	listWindowControls: () => WindowControlDef[];

	applyWindowControls: (
		windowId: string,
		override: import( './types' ).WindowControlsConfig | null | undefined,
	) => void;

	registerWindowSlot: ( def: WindowSlotDef ) => void;

	unregisterWindowSlot: ( id: string ) => void;

	listWindowSlots: () => WindowSlotDef[];

	applyWindowSlot: (
		windowId: string,
		slot: import( './types' ).WindowSlotName,
		config: import( './types' ).WindowSlotConfig | undefined,
	) => void;

	registerWindowNotice: (
		entry: import( './window-notices' ).WindowNoticeEntry,
	) => () => void;

	unregisterWindowNotice: ( id: string ) => void;

	listWindowNotices: () => import( './window-notices' ).WindowNoticeEntry[];

	dismissWindowNotice: ( id: string ) => void;

	undismissWindowNotice: ( id: string ) => void;

	registerWindowChrome: ( def: WindowChromeDef ) => void;

	unregisterWindowChrome: ( id: string ) => void;

	listWindowChromes: () => WindowChromeDef[];

	applyWindowChrome: (
		windowId: string,
		chromeId: string | null | undefined,
	) => void;

	applyWindowTheme: (
		windowId: string,
		override:
			| import( './types' ).WindowThemeRef
			| Record< string, string >
			| string
			| null
			| undefined,
	) => void;

	connect: ( targetWindowId: string, opts?: ConnectOptions ) => WindowConnection;

	getConnection: ( connectionId: string ) => WindowConnection | null;

	broadcast: < T = unknown >( topic: string, payload: T ) => void;

	announceContentChange: (
		type: string,
		action: 'created' | 'updated' | 'trashed' | 'untrashed' | 'deleted',
		ids: number | number[],
		source?: string,
	) => void;

	subscribe: < T = unknown >(
		topic: string,
		cb: ( payload: T, meta: { topic: string } ) => void,
	) => () => void;

	registerPalette: ( p: Palette ) => () => void;

	unregisterPalette: ( id: string ) => void;

	listPalettes: () => Palette[];

	openPalette: ( id: string ) => void;

	devtools: import( './devtools' ).DevtoolsApi;

	createSharedStore: < T >(
		key: string,
		initialState: () => T,
	) => SharedStore< T >;

	presence: PresenceApi;

	workArea: WorkAreaApi;

	workspaces: WorkspacesApi;

	selection: SelectionApi;

	activity: ActivityApi;

	heartbeat: HeartbeatBus;

	showToast: ( opts: ToastOptions ) => () => void;

	repaintLoadingOverlays: () => void;

	renderKeyedList: < T >(
		host: HTMLElement,
		items: readonly T[],
		opts: KeyedListOptions< T >,
	) => void;

	clearKeyedList: ( host: HTMLElement ) => void;

	registerNamespace: ( name: string, api: object ) => void;

	getWindowConfig: < T = Record< string, unknown > >( id: string ) => T | undefined;

	getWindowParams: (
		id: string,
	) => Record< string, string | number | boolean > | undefined;

	registerNativeUrlRemap: ( entry: NativeUrlRemap ) => () => void;

	notify: ( opts: NotifyOptions ) => () => void;

	pwa: {

		promptInstall: () => Promise< 'accepted' | 'dismissed' | 'unavailable' >;

		undismissInstallHint: () => void;

		getState: () => import( './types' ).PwaUserState;

		subscribe: (
			cb: ( s: import( './types' ).PwaUserState ) => void,
		) => () => void;

		requestNotificationPermission: () => Promise<
			'granted' | 'denied' | 'default' | 'unsupported'
		>;

		getNotificationPermission: () =>
			| 'granted'
			| 'denied'
			| 'default'
			| 'unsupported';
	};
	debug: {

		window: ( id: string ) => DesktopDebugWindow | null;
	};
}

export interface DesktopDebugWindow {
	id: string;
	scriptHandle: string;
	scriptUrl: string;

	loadPath: 'eager' | 'lazy' | 'unknown';
	tagInDom: boolean;
	configPresent: boolean;
	extras: {
		hasTranslations: boolean;
		l10nCount: number;
		beforeCount: number;
		afterCount: number;
	};
}

declare global {
	interface Window {
		openStationConfig?: DesktopConfig;

		openStationWindowConfig?: Record< string, unknown >;
	}

	interface WpGlobal {
		os?: OpenStationPublicApi;
	}
}

function init(): void {
	const config = window.openStationConfig;
	if ( ! config ) {
		return;
	}

	hydrateScriptDeps( config );

	const desktopArea = document.getElementById( 'os-area' );
	if ( ! desktopArea ) {
		return;
	}

	const cleanUrl = shellUrlWithoutBootArgs( window.location.href );
	if ( cleanUrl ) {
		try {
			window.history.replaceState( window.history.state, '', cleanUrl );
		} catch {

		}
	}

	stampArrival(
		config.arrivalDirection === 'next' || config.arrivalDirection === 'prev'
			? config.arrivalDirection
			: null,
	);

	const manager = new WindowManager( desktopArea );

	const wallpaperEl = document.getElementById( 'os-wallpaper' );
	const pluginUrl = config.pluginUrl || '';
	let wallpaperLayer: WallpaperLayer | null = null;
	if ( wallpaperEl ) {
		wallpaperLayer = new WallpaperLayer( wallpaperEl, pluginUrl );
	}

	const widgetsEl = document.getElementById( 'os-widgets' );
	let widgetLayer: WidgetLayer | null = null;
	registerBuiltInWidgets();

	installDefaultDockRailRenderer();
	if ( widgetsEl ) {
		widgetLayer = new WidgetLayer( widgetsEl, pluginUrl );
	}

	registerModule( {
		id: 'pixijs',
		url: `${ pluginUrl }/assets/vendor/pixi.min.js`,
		isReady: () => typeof ( window as { PIXI?: unknown } ).PIXI !== 'undefined',
	} );

	const osSettings = new OsSettings(
		wallpaperLayer ?? new WallpaperLayer( document.createElement( 'div' ), pluginUrl ),
	);
	osSettings.apply();

	manager.openWindowsAs = () => osSettings.state.openWindowsAs;

	const modeController = installMode( {
		preference: sanitizeModePreference(
			osSettings.getOsSettingsSnapshot().mobileLayout ?? config.mode?.preference,
		),
		breakpoints: config.mode?.breakpoints,
	} );
	osSettings.subscribeOsSettings( ( snap ) => {
		modeController.setPreference( sanitizeModePreference( snap.mobileLayout ) );
	} );

	installZoomGuard();
	const mobileConstraints = installMobileConstraints( {
		manager,
		mode: modeController.api,

		openNative: ( id, baseId, state ) =>
			openNativeWindowById( id, baseId, state ),
	} );

	const mioShellEl = document.getElementById( 'os-shell' );
	const mio = new MioController( {
		shell: mioShellEl ?? document.body,
		focusedWindow: () => {
			const win = manager.getFocused();
			return win && manager.isActive( win.id ) ? win.id : null;
		},
		bundleUrl: config.mioBundleUrl ?? '',
		serverConfig: config.mio,
		enabled: osSettings.state.mioEnabled,
		wallpaperVisible: () => osSettings.state.mioShowOnWallpaper,
		chatAvailable: () => !! ( osSettings.state.ai.enabled && config.aiAssistant?.available && config.aiAssistant.assistantProviderConfigured ),
		persist: ( enabled: boolean ) => {
			osSettings.state.mioEnabled = enabled;
			osSettings.state.mioApiEnabled = enabled;
			osSettings.save();
		},

		savedLook: osSettings.state.mioStyle,
		persistLook: ( look ) => {
			osSettings.state.mioStyle = look;
			osSettings.save();
		},
	} );
	const mioApi: MioApi = mio.api();
	osSettings.subscribeOsSettings( ( snapshot ) => mio.syncEnabled( snapshot.mioEnabled ) );
	document.addEventListener( 'os-ai-status-changed', () => mio.refreshWindowAvailability() );

	if ( ! modeController.api.isMobile() ) {
		mio.boot();
	} else {
		const unsubscribeMio = modeController.api.subscribe( ( change ) => {
			if ( change.mode !== 'mobile' ) {
				unsubscribeMio();
				mio.boot();
			}
		} );
	}

	if ( widgetLayer ) {
		setupDevModeWidgetGate( { osSettings, layer: widgetLayer } );
	}

	const aiAssistant = new AiAssistantStub(
		{
			aiSearchUrl: config.aiSearchUrl ?? '',
			restNonce: config.restNonce,
			adminUrl: config.adminUrl,

			isAiSupported: () => config.aiAssistant?.available === true,

			canConnectProvider: () => Boolean( config.currentUserIsAdmin ),
			isAiAvailable: () =>
				config.aiAssistant?.available === true &&
				config.aiAssistant?.assistantProviderConfigured === true,
			isOverrideEnabled: () =>
				osSettings.getOsSettingsSnapshot().ai.enabled !== false,
		},
		config.aiAssistantBundleUrl ?? '',
	);

	aiAssistant.attachAsk(
		createAsk( {
			config: () => config,
			fallbackContext: () => ( {
				close: () => aiAssistant.close(),
				openInWindow: ( url, title, icon ) => {
					( manager as unknown as {
						open( cfg: {
							id?: string;
							url: string;
							title: string;
							icon?: string;
						} ): unknown;
					} ).open( {
						url,
						title,
						icon: icon ?? 'dashicons-admin-generic',
					} );
				},
				confirm: ( msg ) =>
					osConfirm( { message: msg } ),
			} ),
		} ),
	);

	const dragBridge = new DragBridge();

	const dragManager: DragManagerApi = new DragManager();

	document.addEventListener( DRAG_EVENTS.START, ( e ) => {
		const detail = ( e as CustomEvent ).detail as
			| {
					payload?: {
						type?: string;
						data?: { bridgePayload?: unknown };
					};
				}
			| undefined;
		const payload = detail?.payload;

		if ( ! payload ) {
			return;
		}
		if ( payload.type !== 'shortcut' && payload.type !== 'desktop-file' ) {
			return;
		}
		const bridgePayload = payload.data?.bridgePayload as
			| import( './drag-bridge' ).DragBridgePayload
			| undefined;
		if ( bridgePayload ) {
			dragBridge.start( bridgePayload );
		}
	} );
	document.addEventListener( DRAG_EVENTS.END, () => {
		dragBridge.end();
	} );

	scheduleIdleBoot( () => installIframeDropTargets( dragManager ) );

	scheduleIdleBoot( () => installFocusWindowOnDragHover( manager ) );

	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== window.location.origin ) {
			return;
		}
		const data = e.data as { type?: unknown; reason?: unknown } | null;
		if ( ! data || data.type !== 'os-drop-failed' ) {
			return;
		}
		showToast( {
			message: 'Could not insert into the editor.',
		} );
	} );

	registerPalette( {
		id: 'desktop-mode-ai-assistant',
		label: 'AI Assistant',
		open: () => aiAssistant.open(),
		close: () => aiAssistant.close(),
		isOpen: () => aiAssistant.isOpen,
	} );

	installTextEntryGuard();
	installPaletteShortcut();
	installWindowSwitcherShortcut( manager );
	installDesktopArrowShortcuts( manager );
	installCloseAllShortcut( manager, {
		shouldAsk: () => osSettings.state.confirmCloseAllWindows,
		setAsk: ( ask ) => {
			osSettings.state.confirmCloseAllWindows = ask;
			osSettings.save();
		},
	} );

	scheduleIdleBoot( () => {
		new IframeCommandBridge( {
			manager,
			adminUrl: config.adminUrl,
		} ).install();

		installWindowActivityNotifier( manager );

		const shellHarvester = new ShellCommandHarvester( {
			manager,
			adminUrl: config.adminUrl,
			titleForUrl: ( url ) => findDockTitleForUrl( url, config ),
		} );
		shellHarvester.install();
		document.addEventListener(
			PALETTE_ASSETS_READY_EVENT,
			() => shellHarvester.install(),
			{ once: true },
		);
	} );

	document.addEventListener( 'os-open-ai', () => {
		openPaletteOnly( 'desktop-mode-ai-assistant' );
	} );

	document.addEventListener(
		'click',
		( e: MouseEvent ) => {
			const target = e.target;
			if (
				! ( target instanceof Element ) ||
				! target.closest( '#wp-admin-bar-command-palette' )
			) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			openPaletteOnly( 'desktop-mode-ai-assistant' );
		},
		true,
	);

	const bottomDockEl = document.getElementById( 'os-dock' );
	const shellEl = document.getElementById( 'os-shell' );
	const shellBody = shellEl?.querySelector< HTMLElement >(
		'.os-shell__body',
	);
	let layoutDispatcher: LayoutDispatcher | null = null;

	let workspaceDeps: WorkspaceDeps | null = null;

	const applyWorkspaceViewForMode = (
		deps: WorkspaceDeps,
		desktopId: string,
	): void => {
		if ( modeController.api.isMobile() ) {
			deps.setAppearance?.( null );
			deps.setVisibleWidgets?.( null );
			return;
		}
		applyWorkspaceView( deps, desktopId );
	};
	const provisionWorkspaceForMode = (
		deps: WorkspaceDeps,
		desktopId: string,
	): void => {
		if ( modeController.api.isMobile() ) {
			return;
		}
		provisionWorkspace( deps, desktopId );
	};

	let pwaAlreadyInstalled = false;

	const currentWorkspaceLook = (): ReturnType<
		typeof captureWorkspaceAppearance
	> =>
		captureWorkspaceAppearance(
			osSettings.getOsSettingsSnapshot() as unknown as Record<
				string,
				unknown
			>,
		);

	const wizardWorld = ( deps: WorkspaceDeps ) => ( {
		presets: listWorkspacePresets(),
		apps: deps.getNavItems().map( ( item ) => ( {
			id: item.id,
			title: item.title,
			kind: item.kind,
			locked: item.locked,

			url: item.menu?.url || item.entry?.url || undefined,
			windowId: item.windowId,
		} ) ),
		widgets: listWidgetDefs().map( ( def ) => ( {
			id: def.id,
			label: def.label || def.id,
			description: def.description,
		} ) ),
		enabledWidgetIds: widgetLayer?.getEnabledIds() ?? [],

		wallpapers: listWallpaperDefs().map( ( def ) => ( {
			id: def.id,
			label: def.label,
			preview: def.preview,
		} ) ),
		accents: getAccents().map( ( a ) => ( {
			id: a.id,
			label: a.label,
			value: a.value,
		} ) ),
		resolvePreset: ( preset: WorkspacePreset ) =>
			workspaceProfileFromPreset( preset, deps.getNavItems() ),
		captureAppearance: currentWorkspaceLook,
	} );

	const createWorkspaceWithWizard = ( desktopId?: string ): void => {
		if ( ! workspaceDeps ) {
			return;
		}
		const deps = workspaceDeps;
		const target = desktopId ?? createWorkspace( deps ).id;
		openWorkspaceWizard( {
			mode: 'create',
			...wizardWorld( deps ),
			onCreate: ( result ) => {
				createWorkspace( deps, {
					desktopId: target,
					label: result.label || undefined,
					...( result.preset
						? { preset: result.preset }
						: { profile: result.profile ?? undefined } ),
				} );

				applyWorkspaceViewForMode( deps, target );
				provisionWorkspaceForMode( deps, target );
			},
		} );
	};

	const saveDesk = ( desktopId: string = manager.getActiveDesktopId() ): boolean => {
		if ( ! workspaceDeps ) {
			return false;
		}
		const nav = layoutDispatcher?.getNav();
		let visibleAppIds: string[] | undefined;
		if ( nav ) {
			const onScreen = [
				...nav.dock.core,
				...nav.dock.apps,
				...nav.dock.controls,
				...nav.sidebar,
				...nav.desktop,
			];

			visibleAppIds = onScreen
				.filter( ( item ) => ! nav.ephemeral.has( item.id ) )
				.map( ( item ) => item.id );
		}
		const saved = saveDeskToWorkspace( workspaceDeps, desktopId, {
			visibleAppIds,
			mountedWidgetIds: widgetLayer?.getMountedIds(),
		} );
		if ( ! saved ) {
			return false;
		}
		const label =
			manager.getDesktops().find( ( d ) => d.id === desktopId )?.label ?? '';

		const onDesk = manager
			.getAll()
			.filter( ( w ) => ( w.config.desktopId || desktopId ) === desktopId ).length;
		const kept = saved.windows.length;
		let message: string;
		if ( onDesk > kept ) {
			message = sprintf(

				__( '%1$s will open like this — the top %2$d of %3$d windows, where they are.' ),
				label,
				kept,
				onDesk,
			);
		} else {
			message = sprintf(

				__( '%1$s will open like this — %2$d windows, where they are.' ),
				label,
				kept,
			);
		}
		showToast( { message } );
		return true;
	};

	const editWorkspace = ( desktopId: string ): void => {
		if ( ! workspaceDeps ) {
			return;
		}
		const desktop = manager
			.getDesktops()
			.find( ( d ) => d.id === desktopId );
		if ( ! desktop ) {
			return;
		}
		const deps = workspaceDeps;
		openWorkspaceWizard( {
			mode: 'edit',
			desktopId,
			label: desktop.label,

			profile: desktop.profile ?? blankWorkspaceProfile(),
			...wizardWorld( deps ),
			onSave: ( result ) => {
				if ( result.label ) {
					manager.renameDesktop( desktopId, result.label );
				}

				setWorkspaceProfile( deps, desktopId, result.profile );
			},
			captureWindows: () => captureWorkspaceWindows( manager, desktopId ),

			onDelete:
				manager.getDesktops().length > 1
					? () => manager.closeDesktop( desktopId )
					: undefined,
		} );
	};

	const anyRowOpen = ( rows: SubmenuItem[] ): boolean =>
		rows.some(
			( row ) =>
				!! row.windowId &&
				manager.getAllByBaseIdOnActiveDesktop( row.windowId ).length >
					0,
		);

	const nativeWindows = createNativeWindowSync( {
		manager,
		appendSystemTile: ( item ) =>
			layoutDispatcher?.appendSystemTile( item ),
		removeSystemTile: ( id ) => layoutDispatcher?.removeSystemTile( id ),
		desktopArea,
	} );
	const syncNativeWindows = nativeWindows.sync;

	bindNativeUrlRemap( {
		getSnapshot: () => osSettings.getOsSettingsSnapshot(),
		openById: ( id, opts ) => nativeWindows.openById( id, opts ),
		openNewById: ( id, opts ) => nativeWindows.openNewById( id, opts ),
		adminUrl: config.adminUrl,
	} );

	const findDockEntryForUrl = (
		url: string,
	): import( './window/iframe-bridge' ).AdminLinkDockEntry | null => {
		const targetSlug = deriveWindowId( url, config.adminUrl );
		const items = layoutDispatcher
			? layoutDispatcher.getMenuItems()
			: ( config.dockItems ?? [] );
		for ( const item of items ) {
			if ( deriveWindowId( item.url, config.adminUrl ) === targetSlug ) {
				return {
					title: item.title,
					icon: item.icon,
					url: item.url,
					submenu: item.submenu,
					selfLabel: item.selfLabel,
					multi: item.multi,
				};
			}
			for ( const sub of item.submenu ?? [] ) {
				if (
					deriveWindowId( sub.url, config.adminUrl ) === targetSlug
				) {
					return {
						title: sub.title,

						icon: item.icon,

						url: item.url,
						multi: item.multi,
					};
				}
			}
		}
		return null;
	};

	const openOtherAdmin = hopToAdmin;

	const hopMinter: HopMinter = ( target, direction ) => {
		const hopUrl = config.multisite?.hopUrl;
		return hopUrl
			? createHopMinter( { hopUrl, restNonce: config.restNonce } )( target, direction )
			: Promise.resolve( null );
	};
	installOverviewHeader( () =>
		config.multisite
			? buildSiteSwitcher( config.multisite, { mint: hopMinter } )
			: null,
	);

	document.addEventListener( 'os-app-effect', ( e: Event ) => {
		const effect = ( e as CustomEvent< { effect?: { type?: string; site?: unknown } } > )
			.detail?.effect;
		if ( effect?.type === 'hop' && config.multisite && typeof effect.site === 'string' ) {
			switchToSite( config.multisite, effect.site, { mint: hopMinter } );
		}
	} );

	installSiteSwitcherKeys( {
		multisite: () => config.multisite,
		isShown: () => !! document.querySelector( '.os-area--overview .os-site-switcher' ),
		mint: hopMinter,
	} );

	if ( config.hopLinkOffer ) {
		void offerAccountLink( config.hopLinkOffer, {
			confirm: ( options ) => osConfirm( options ),
			post: createLinkPoster( config.restNonce ),
		} );
	}

	bindAdminLinkDispatch( {
		adminUrl: config.adminUrl,
		deriveSlug: ( url ) => deriveWindowId( url, config.adminUrl ),
		openWindow: ( windowConfig ) => {
			void manager.open( windowConfig );
		},
		findDockEntry: findDockEntryForUrl,
		openOtherAdmin,
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-dashboard',
		nativeWindowId: 'desktop-mode-dashboard',
		matches: ( _url, parsed ) => matchesStationHomeUrl( parsed ),
		enabled: ( snapshot ) => snapshot.stationHomeEnabled === true,
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-posts',
		nativeWindowId: 'desktop-mode-posts',
		matches: ( _url, parsed ) => {
			if ( ! parsed.pathname.endsWith( '/edit.php' ) ) {
				return false;
			}
			const postType = parsed.searchParams.get( 'post_type' );
			return ! postType || postType === 'post';
		},
		enabled: ( snapshot ) => snapshot.nativePostsEnabled === true,
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-pages',
		nativeWindowId: 'desktop-mode-pages',
		matches: ( _url, parsed ) => {
			if ( ! parsed.pathname.endsWith( '/edit.php' ) ) {
				return false;
			}
			return parsed.searchParams.get( 'post_type' ) === 'page';
		},
		enabled: ( snapshot ) => snapshot.nativePagesEnabled === true,
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-users',
		nativeWindowId: 'desktop-mode-users',
		matches: ( _url, parsed ) => parsed.pathname.endsWith( '/users.php' ),
		enabled: ( snapshot ) => snapshot.nativeUsersEnabled === true,
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-user-edit',
		nativeWindowId: 'desktop-mode-user-edit',
		matches: ( _url, parsed ) => {
			if ( isPersonViewClaimed( parsed ) ) {
				return false;
			}
			const path = parsed.pathname;
			if ( path.endsWith( '/profile.php' ) ) {
				return true;
			}
			if ( path.endsWith( '/user-edit.php' ) ) {
				return parsed.searchParams.has( 'user_id' );
			}
			return false;
		},
		enabled: ( snapshot ) => snapshot.nativeUsersEnabled === true,
		params: ( _url, parsed ) => {
			const userId = parseInt(
				parsed.searchParams.get( 'user_id' ) ?? '0',
				10,
			);
			return { userId: userId > 0 ? userId : 0 };
		},
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-comments',
		nativeWindowId: 'desktop-mode-comments',
		matches: ( _url, parsed ) =>
			parsed.pathname.endsWith( '/edit-comments.php' ),
		enabled: ( snapshot ) => snapshot.nativeCommentsEnabled === true,
		params: ( _url, parsed ) => {
			const postId = parseInt( parsed.searchParams.get( 'p' ) ?? '0', 10 );
			return { post: postId > 0 ? postId : 0 };
		},
	} );

	registerNativeUrlRemap( {
		id: 'desktop-mode-plugins',
		nativeWindowId: 'desktop-mode-plugins',
		matches: ( _url, parsed ) => {
			const path = parsed.pathname;
			return (
				path.endsWith( '/plugins.php' ) ||
				path.endsWith( '/plugin-install.php' )
			);
		},
		enabled: ( snapshot ) => snapshot.nativePluginsEnabled === true,

		params: ( _url, parsed ) => ( {
			tab: parsed.pathname.endsWith( '/plugin-install.php' )
				? 'browse'
				: 'installed',
		} ),
	} );

	if ( bottomDockEl && shellEl && shellBody && config.dockItems ) {
		desktopArea.classList.add( 'os-area--with-dock' );
		const initialSnapshot = osSettings.getOsSettingsSnapshot();
		const initialLayout = initialSnapshot.desktopLayout;
		const initialPlacement = initialSnapshot.dockPlacement;
		const renderIcons = (
			icons: import( './types' ).DesktopIconServerEntry[] | undefined,
		): void => {
			renderDesktopIcons( desktopArea, icons, {
				openWindow: nativeWindows.openById,
				manager,
				deriveWindowId: ( url: string ) =>
					deriveWindowId( url, config.adminUrl ),
			} );
		};
		layoutDispatcher = createLayoutDispatcher(
			{
				shellRoot: shellEl,
				shellBody,
				bottomDockEl,
				desktopArea,
				windowManager: manager,
				adminUrl: config.adminUrl,
				renderIcons,
				getSettings: () => {
					const snap = osSettings.getOsSettingsSnapshot();
					return {
						navPlacement: snap.navPlacement,
						navOrder: snap.navOrder,
					};
				},

				getWorkspaceProfile: () =>
					modeController.api.isMobile()
						? null
						: getActiveWorkspaceProfile( manager ),
			},
			initialLayout,
			config.dockItems,
			config.desktopIcons,
			initialPlacement,
		);

		installAdminBarHeight();

		installWorkArea( {
			shell: shellEl,
			shellBody,
			area: desktopArea,
		} );

		installGridSpanReflow( manager );

		installDockBehavior( {
			shellBody,
			getBehaviors: () => ( {
				dock: osSettings.state.dockBehavior,
				sidebar: osSettings.state.sideDockBehavior,
			} ),
		} );

		installDockConstellationSentinel( {
			bundleUrl: config.dockConstellationBundleUrl ?? '',
			deps: {
				windowManager: manager,
				adminUrl: config.adminUrl,
				getMenuItems: () => layoutDispatcher?.getMenuItems() ?? [],
				getSystemItem: ( id: string ) =>
					layoutDispatcher?.getSystemTile( id ) ?? null,
			},
		} );

		workspaceDeps = {
			manager,
			getNavItems: () => layoutDispatcher?.getNavItems() ?? [],
			adminUrl: config.adminUrl,
			deriveWindowId: ( url: string ) =>
				deriveWindowId( url, config.adminUrl ),
			openNative: nativeWindows.openById,
			refreshLayout: () => layoutDispatcher?.refresh(),

			setVisibleWidgets: ( ids ) => widgetLayer?.setVisibleIds( ids ),

			setAppearance: ( patch ) =>
				osSettings.setWorkspaceAppearance(
					patch as Partial< typeof osSettings.state > | null,
				),
		};

		installWorkspacePresetSync();
		applyServerWorkspacePresets( config.workspacePresets );

		registerWorkspaceCommand(
			workspaceDeps,
			editWorkspace,
			createWorkspaceWithWizard,
			saveDesk,
		);

		installWorkspaceOverviewControl( {
			...workspaceDeps,
			openCreator: createWorkspaceWithWizard,
			openEditor: editWorkspace,
		} );

		addAction(
			HOOKS.DESKTOP_SWITCHED,
			'desktop-mode/workspace-provision',
			( payload: { to?: string } ) => {
				if ( ! workspaceDeps || ! payload?.to ) {
					return;
				}

				applyWorkspaceViewForMode( workspaceDeps, payload.to );
				provisionWorkspaceForMode( workspaceDeps, payload.to );
			},
		);

		const recordWidgetChange = ( id: string, visible: boolean ): void => {
			if ( ! workspaceDeps || ! visible ) {
				return;
			}
			const desktopId = manager.getActiveDesktopId();
			const profile = getWorkspaceProfile( manager, desktopId );
			if ( ! profile || 'only' !== profile.widgets?.mode ) {
				return;
			}
			const next = withWorkspaceWidget( profile, id, visible );
			if ( next !== profile ) {
				setWorkspaceProfile( workspaceDeps, desktopId, next );
			}
		};
		addAction( HOOKS.WIDGET_ADDED, 'desktop-mode/workspace-widgets', ( p: { id: string } ) =>
			recordWidgetChange( p.id, true ),
		);

		if ( workspaceDeps ) {
			const bootDesktop = manager.getActiveDesktopId();
			applyWorkspaceViewForMode( workspaceDeps, bootDesktop );
			provisionWorkspaceForMode( workspaceDeps, bootDesktop );
		}

		const installTile = getInstallTileDef(
			config.pwa?.appName || 'WordPress',
			showToast,
		);
		const systemTile: SystemDockItem = {
			id: SYSTEM_TILE_ID,
			title: 'System',
			icon: OS_SYSTEM_ICON,
			navKind: 'control',

			placeable: true,
			order: SYSTEM_TILE_ORDER.system,

			onOpen: () => openOsSettings(),
			get submenu() {
				const rows: SubmenuItem[] = [
					{
						title: 'OpenStation Preferences',
						url: '',
						windowId: OS_SETTINGS_WINDOW_ID,
						onSelect: () => openOsSettings(),
					},
				];
				if ( config.homeUrl ) {
					rows.push( {
						title: 'View site',

						url: config.homeUrl,
					} );
				}
				rows.push(
					{
						title: 'Fullscreen',
						url: '',
						onSelect: toggleFullscreen,
					},
					{
						title: 'Keyboard shortcuts',
						url: '',
						windowId: SHORTCUTS_WINDOW_ID,
						onSelect: () =>
							openShortcutsWith( ( cfg ) => {
								void manager.open( cfg );
							} ),
					},
					{
						title: 'Report a bug',
						url: '',
						windowId: BUG_REPORT_WINDOW_ID,
						onSelect: () => openBugReport(),
					},
				);

				if ( ! isStandaloneDisplay() && ! pwaAlreadyInstalled ) {
					rows.push( {
						title: installTile.title,
						url: '',
						onSelect: installTile.onOpen,
					} );
				}
				if ( config.logoutUrl ) {
					rows.push( {
						title: 'Log out',
						url: '',
						onSelect: () => {
							window.location.assign(
									config.logoutUrl as string,
							);
						},
					} );
				}
				return rows;
			},

			isOpen: () => anyRowOpen( systemTile.submenu ?? [] ),
		};
		layoutDispatcher.appendSystemTile( systemTile );

		void isLikelyInstalled().then( ( installed ) => {
			pwaAlreadyInstalled = installed;
		} );
	}

	const LAYOUT_SECTION_ID = 'os-settings-layout';

	const SETTINGS_SECTION_WAIT_MS = 8000;

	function visibleSettingsSection( sectionId: string ): HTMLElement | null {
		const section = document.getElementById( sectionId );
		return section && ! section.closest( '[hidden]' ) ? section : null;
	}

	function revealSettingsSection(
		sectionId: string,
		deadline = performance.now() + SETTINGS_SECTION_WAIT_MS,
	): void {
		const section = visibleSettingsSection( sectionId );
		if ( section ) {
			section.scrollIntoView( { block: 'start', behavior: 'instant' } );
			return;
		}
		if ( performance.now() < deadline ) {
			requestAnimationFrame( () => revealSettingsSection( sectionId, deadline ) );
		}
	}

	function openOsSettings( opts: { tabId?: string } = {} ): void {
		const MERGED_TABS: Readonly< Record< string, string > > = {

			extended: 'features',

			effects: 'windows',
		};
		const merged = opts.tabId ? MERGED_TABS[ opts.tabId ] : undefined;
		if ( merged ) {
			opts = { ...opts, tabId: merged };
		}

		const alreadyOpen = !! manager.getById( OS_SETTINGS_WINDOW_ID );
		nativeWindows.openById( OS_SETTINGS_WINDOW_ID, {
			source: 'os-settings',
			...( opts.tabId ? { params: { tab: opts.tabId } } : {} ),
		} );
		if ( opts.tabId && alreadyOpen ) {
			const apps = ( window.wp?.os as {
				apps?: { local: ( id: string, action: string, args: Record< string, unknown > ) => void };
			} | undefined )?.apps;
			apps?.local( OS_SETTINGS_WINDOW_ID, 'tab', { value: opts.tabId } );
		}
	}

	function openBugReport(
		instanceId = BUG_REPORT_WINDOW_ID,
		state?: NativeWindowRestoreState,
	): void {
		ensureDeferredStyle( 'desktop-mode-bug-report' );
		const bugReportConfig: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		} = {
			id: instanceId,
			baseId: BUG_REPORT_WINDOW_ID,
			url: `#${ BUG_REPORT_WINDOW_ID }`,
			title: 'Report a bug',
			icon: 'dashicons-buddicons-replies',
			native: true,
			render: ( body ) => renderBugReport( body ),
			width: 560,
			height: 620,
			minWidth: 420,
			minHeight: 480,
			...state,
		};
		void ( state
			? manager.openNew( bugReportConfig )
			: manager.open( bugReportConfig ) );
	}

	if ( layoutDispatcher ) {
		layoutDispatcher.appendSystemTile( getExitOpenStationTileDef() );

		if ( config.multisite ) {
			const networkTile = getNetworkAdminTileDef(
				config.multisite,
				openOtherAdmin,
			);
			if ( networkTile ) {
				layoutDispatcher.appendSystemTile( networkTile );
			}
		}

		layoutDispatcher.appendSystemTile( {
			id: ASSISTANT_TILE_ID,
			title: __( 'Site assistant' ),
			icon: OS_ASSISTANT_ICON,
			navKind: 'control',
			placeable: true,
			order: SYSTEM_TILE_ORDER.assistant,
			onOpen: () => {
				document.dispatchEvent( new CustomEvent( 'os-open-ai' ) );
			},
		} );

		layoutDispatcher.appendSystemTile( {
			id: MIO_TILE_ID,
			title: 'Mio',
			icon: MIO_TILE_ICON,
			navKind: 'control',
			placeable: true,
			order: SYSTEM_TILE_ORDER.mio,
			isOpen: () => mioApi.isEnabled(),
			onOpen: () => {
				void mioApi.toggle();
			},
		} );

		layoutDispatcher.appendSystemTile( {
			id: OVERVIEW_TILE_ID,
			title: 'Workspaces',
			icon: OS_OVERVIEW_ICON,
			navKind: 'control',
			placeable: true,
			order: SYSTEM_TILE_ORDER.overview,
			isOpen: () => manager._overviewActive,
			onOpen: () => {
				if ( manager._overviewActive ) {
					manager.exitOverview();
				} else {
					manager.enterOverview();
				}
			},
		} );
	}
	const dock: Dock | null = layoutDispatcher?.getPrimary() ?? null;

	void syncNativeWindows(
		hydrateServerEntries(
			Array.isArray( config.nativeWindows ) ? config.nativeWindows : [],
			config.nativeWindowScriptData,
		),
	);

	const hasSession = hasRestorableSession( config.session );

	function openNativeWindowById(
		nativeId: string,
		baseId?: string,
		state?: NativeWindowRestoreState,
	): boolean {
		const registeredId = baseId || nativeId;

		if (
			registeredId === 'desktop-mode-dashboard' &&
			osSettings.getOsSettingsSnapshot().stationHomeEnabled !== true
		) {
			return false;
		}
		if ( registeredId === BUG_REPORT_WINDOW_ID ) {
			openBugReport( nativeId, state );
			return true;
		}
		if ( state ) {
			return nativeWindows.restoreById(
				nativeId,
				registeredId,
				state,
			);
		}
		return nativeWindows.openById( nativeId );
	}

	const soloWindowId =
		'string' === typeof config.soloWindow ? config.soloWindow : '';
	if ( soloWindowId ) {
		queueMicrotask( () => {
			if ( openNativeWindowById( soloWindowId ) ) {
				return;
			}

			const gameId = soloWindowId.startsWith( 'os-game-' )
				? soloWindowId.slice( 'os-game-'.length )
				: '';
			if ( gameId ) {
				void gamesApi.launch( gameId ).catch( ( err ) => {
					if ( typeof console !== 'undefined' ) {
						console.error( '[openstation] solo game failed to launch:', err );
					}
				} );
				return;
			}

			if ( typeof console !== 'undefined' ) {
				console.error(
					`[openstation] solo window "${ soloWindowId }" is not registered; nothing to paint.`,
				);
			}
		} );
	}

	const restoreConfig = modeController.api.isMobile()
		? mobileConstraints.trimSessionForMobile( config )
		: config;
	const sessionRestore = hasSession && ! soloWindowId
		? restoreSession(
			manager,
			restoreConfig,
			desktopArea,
			openNativeWindowById,
		).catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] session restore failed:', err );
			}
		} )
		: Promise.resolve();
	const defaultEnabled = config.defaultWindow?.enabled !== false;
	const defaultUrlEarly = config.defaultWindow?.url ?? '';
	const isNativeDefault =
		typeof defaultUrlEarly === 'string' &&
		defaultUrlEarly.startsWith( 'native:' );

	let bootWindowsSettled: Promise< unknown > = sessionRestore;
	if ( ! soloWindowId && shouldAutoOpenCurrentPage( {
		fromPortal: config.fromPortal,
		fromPortalIntent: config.fromPortalIntent,
		hasSession,
		defaultEnabled,
		isNativeDefault,
	} ) ) {
		bootWindowsSettled = sessionRestore.then( () =>
			openCurrentPage( manager, config ).catch( ( err ) => {
				if ( typeof console !== 'undefined' ) {
					console.error( '[openstation] openCurrentPage failed:', err );
				}
			} ),
		);
	}

	if ( config.landInOverview && ! soloWindowId ) {
		void bootWindowsSettled.then( () => {
			manager.enterOverview();
			revealInstance();
		} );
	}

	if ( ! soloWindowId && workspaceDeps ) {
		const deps = workspaceDeps;
		void sessionRestore.then( () => {
			const bootDesktop = manager.getActiveDesktopId();

			if ( ! modeController.api.isMobile() ) {
				reopenWorkspaceWindows( deps, bootDesktop );
			}
			applyWorkspaceViewForMode( deps, bootDesktop );
		} );
	}

	const saveSession = createSessionSaver( manager, config );
	wireSessionEvents( saveSession );

	const setDefaultWindow = async ( url: string | null ): Promise<void> => {
		try {
			const response = await trackedFetch(
				manager,
				config.defaultWindowUrl,
				{
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': config.restNonce,
					},
					body: JSON.stringify( { url } ),
				},
				{ source: 'desktop-mode/default-window' },
			);
			if ( ! response.ok ) {
				throw await restErrorFromResponse( response );
			}
			const data = ( await response.json() ) as {
				enabled: boolean;
				url: string;
			};
			config.defaultWindow = data;
			document.dispatchEvent(
				new CustomEvent( 'os-default-window-changed', {
					detail: data,
				} ),
			);
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, { scope: 'default-window-save', error: err } );
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] Failed to save default window:',
					err,
				);
			}
		}
	};

	manager.onToggleStartupRequested = ( win ) => {
		const currentPref = config.defaultWindow;
		const isNative = !! win.config.native;
		const winValue = isNative ? `native:${ win.id }` : win.getCurrentUrl();
		const matchesCurrent = isNative
			? currentPref?.url === winValue
			: urlMatchKey( currentPref?.url ?? '' ) === urlMatchKey( winValue );
		const alreadyDefault = !! currentPref?.enabled && matchesCurrent;
		void setDefaultWindow( alreadyDefault ? null : winValue );
	};

	if (
		config.defaultWindow?.enabled &&
		config.fromPortal &&
		! config.fromPortalIntent &&
		! hasSession &&
		isNativeDefault
	) {
		const nativeId = defaultUrlEarly.slice( 'native:'.length );

		queueMicrotask( () => {
			openNativeWindowById( nativeId );
		} );
	}

	const placeSystemTile = ( item: SystemDockItem ): void => {
		layoutDispatcher?.appendSystemTile( item );
	};

	const syncServerWidgets = createWidgetRegistrySync( {
		layer: widgetLayer,
	} );
	void syncServerWidgets(
		Array.isArray( config.serverWidgets ) ? config.serverWidgets : [],
	);

	const syncServerWallpapers = createWallpaperRegistrySync( {
		osSettings,
	} );
	void syncServerWallpapers(
		Array.isArray( config.serverWallpapers ) ? config.serverWallpapers : [],
	);

	addAction(
		HOOKS.WALLPAPERS_SERVER_CHANGED,
		'desktop-mode/wallpapers-server-sync',
		( payload: unknown ) => {
			const list = ( payload as { wallpapers?: unknown } )?.wallpapers;
			if ( Array.isArray( list ) ) {
				void syncServerWallpapers( list as DesktopWallpaperServerEntry[] );
			}
		},
	);

	const syncServerGames = createGamesRegistrySync();
	void syncServerGames(
		Array.isArray( config.serverGames ) ? config.serverGames : [],
	);

	const syncServerDesktopThemes = createDesktopThemeSync();
	syncServerDesktopThemes(
		Array.isArray( config.serverDesktopThemes )
			? config.serverDesktopThemes
			: [],
	);

	const syncServerCommands = createCommandRegistrySync();
	void syncServerCommands(
		Array.isArray( config.serverCommandScripts ) ? config.serverCommandScripts : [],
		Array.isArray( config.serverCommands ) ? config.serverCommands : [],
	);

	const syncServerSettingsTabs = createSettingsTabRegistrySync();
	void syncServerSettingsTabs(
		Array.isArray( config.serverSettingsTabScripts )
			? config.serverSettingsTabScripts
			: [],
		Array.isArray( config.serverSettingsTabs ) ? config.serverSettingsTabs : [],
	);

	const syncServerTitleBarButtons = createTitleBarButtonRegistrySync();
	void syncServerTitleBarButtons(
		Array.isArray( config.serverTitleBarButtonScripts )
			? config.serverTitleBarButtonScripts
			: [],
	);

	const syncServerWindowActions = createWindowActionRegistrySync();
	void syncServerWindowActions(
		Array.isArray( config.serverWindowActionScripts )
			? config.serverWindowActionScripts
			: [],
	);

	const syncServerUnfocusEffects = createUnfocusEffectRegistrySync();
	void syncServerUnfocusEffects(
		Array.isArray( config.serverUnfocusEffectScripts )
			? config.serverUnfocusEffectScripts
			: [],
	);

	const syncServerWindowLinkRenderers = createWindowLinkRendererRegistrySync();
	void syncServerWindowLinkRenderers(
		Array.isArray( config.serverWindowLinkRendererScripts )
			? config.serverWindowLinkRendererScripts
			: [],
	);

	startUnfocusEngine( { manager, osSettings } );

	startWindowRevealEngine( { osSettings } );

	startWindowLinksEngine( { manager } );

	registerBuiltInLinkRendererStub();

	{
		let visualsRequested = false;
		addAction(
			HOOKS.WINDOW_LINK_GROUPS_CHANGED,
			'desktop-mode/window-link-visuals-sentinel',
			() => {
				if ( visualsRequested ) {
					return;
				}
				visualsRequested = true;

				void ensureWindowLinkVisuals()
					.then( ( loaded ) => {
						if ( ! loaded ) {
							return;
						}
						window.openStationWindowLinkVisuals?.start( {
							manager,
							osSettings,
						} );
					} )
					.catch( () => {
						visualsRequested = false;
					} );
			},
		);
	}

	bootRelatedEntities( {
		manager,
		openUrl: ( item ) => {
			if (
				item.windowId &&
				nativeWindows.openById( item.windowId, {
					source: 'related-entities',
					...( item.params ? { params: item.params } : {} ),
				} )
			) {
				return;
			}
			if ( ! item.url ) {
				return;
			}

			if ( tryNativeUrlRemap( item.url ) ) {
				return;
			}
			const relatedId = deriveWindowId( item.url, config.adminUrl );
			void manager.open( {
				id: relatedId,
				baseId: relatedId,
				url: item.url,
				title: item.label,
				icon: item.icon || 'dashicons-admin-links',
			} );
		},
	} );

	bootEditorPreview( { manager } );

	bootRevisions( { manager } );

	const syncServerDockRailRenderers = createDockRailRendererSync();
	void syncServerDockRailRenderers(
		Array.isArray( config.serverDockRailRendererScripts )
			? config.serverDockRailRendererScripts
			: [],
	);

	const syncServerWindowThemes = createWindowThemeRegistrySync();
	void syncServerWindowThemes(
		Array.isArray( config.serverWindowThemeScripts )
			? config.serverWindowThemeScripts
			: [],
		Array.isArray( config.serverWindowThemes )
			? config.serverWindowThemes
			: [],
	);

	registerBuiltInControls();

	const syncServerWindowControls = createWindowControlRegistrySync();
	void syncServerWindowControls(
		Array.isArray( config.serverWindowControlScripts )
			? config.serverWindowControlScripts
			: [],
		Array.isArray( config.serverWindowControls )
			? config.serverWindowControls
			: [],
	);

	const syncServerWindowSlots = createWindowSlotRegistrySync();
	void syncServerWindowSlots(
		Array.isArray( config.serverWindowSlotScripts )
			? config.serverWindowSlotScripts
			: [],
		Array.isArray( config.serverWindowSlots )
			? config.serverWindowSlots
			: [],
	);

	applyServerWindowNotices(
		Array.isArray( config.serverWindowNotices )
			? config.serverWindowNotices
			: [],
	);

	const syncServerWindowChromes = createWindowChromeRegistrySync();
	void syncServerWindowChromes(
		Array.isArray( config.serverWindowChromeScripts )
			? config.serverWindowChromeScripts
			: [],
		Array.isArray( config.serverWindowChromes )
			? config.serverWindowChromes
			: [],
	);

	const connectionBridge = createConnectionBridge( manager );

	attachBroadcastBus( manager );
	scheduleIdleBoot( () => installBroadcastReceiver() );

	installWindowLoadingTransitions();

	addAction(
		'os.shell.toast',
		'desktop-mode/shell-toast',
		( payload: {
			message?: string;
			type?: string;
			action?: { label: string; onClick: () => void };
			duration?: number;
		} ) => {
			if ( ! payload || typeof payload.message !== 'string' ) {
				return;
			}
			showToast( {
				message: payload.message,
				type: typeof payload.type === 'string' ? payload.type : undefined,
				action: payload.action,
				duration: payload.duration,
			} );
		},
	);

	const cfgWithBin = config as DesktopConfig & {
		recycleBinCount?: number | string;
		recycleBinCountUrl?: string;
	};
	const cfgCountRaw = cfgWithBin.recycleBinCount;
	startRecycleBinIconState(
		Number( cfgCountRaw ) || 0,
		typeof cfgWithBin.recycleBinCountUrl === 'string'
			? cfgWithBin.recycleBinCountUrl
			: '',
	);

	registerBuiltInPeekRenderers( {
		getRecycleBinCount: _currentRecycleBinCount,
	} );

	(
		window as unknown as {
			__openStationConnectionBridge?: ReturnType< typeof createConnectionBridge >;
		}
	).__openStationConnectionBridge = connectionBridge;

	addAction( HOOKS.WINDOW_CLOSED, 'desktop-mode/connection-cleanup', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onWindowClosed( e.windowId );
		}
	} );

	addAction( HOOKS.IFRAME_READY, 'desktop-mode/connection-rearm', ( e: { windowId?: string } ) => {
		if ( e?.windowId ) {
			connectionBridge.onIframeReady( e.windowId );
		}
	} );

	const registerWindow = createRegisterWindow( manager );

	const renderIcons = (
		icons: import( './types' ).DesktopIconServerEntry[] | undefined,
	): void => {
		if ( layoutDispatcher ) {
			layoutDispatcher.applyDesktopIcons( icons );
			return;
		}

		renderDesktopIcons( desktopArea, icons, {
			openWindow: nativeWindows.openById,
			manager,
			deriveWindowId: ( url: string ) =>
				deriveWindowId( url, config.adminUrl ),
		} );
	};

	const syncShortcutsNow = (): void => {
		if ( ! layoutDispatcher ) {
			return;
		}
		syncDesktopShortcuts(
			layoutDispatcher.getNav().desktop,
			layoutDispatcher.getNavItems(),
			osSettings.getOsSettingsSnapshot().dockPromotedPositions,
		);
	};

	const refreshMenu = bindMenuRefresh( {
		layoutDispatcher,
		desktopArea,
		config,

		applyMultisite: ( block ) => {
			const was = config.multisite;
			config.multisite =
				block && was
					? { ...block, current: was.current, isNetworkAdmin: was.isNetworkAdmin }
					: block;
			refreshOverviewTopBar( manager );
		},
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

		refreshRootPlacements: ( addedIconIds ) => {
			void listPlacements( 0 )
				.then( ( res ) => {
					setFolderPlacements( 0, res.placements );
					settleArrivedShortcuts( desktopArea, addedIconIds );
				} )
				.catch( () => {

				} );
		},
		syncShortcuts: syncShortcutsNow,
		syncWindowSubmenus: () => syncOpenWindowSubmenus( manager.getAll(), config ),
	} );

	document.addEventListener( DESKTOP_THEME_CHANGED_EVENT, () => {
		if ( layoutDispatcher ) {
			layoutDispatcher.setLayout( layoutDispatcher.getLayout() );
		}
		for ( const win of manager._stack ) {
			try {
				win.repaintWindowControls();
				win.repaintThemedChrome();
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'desktop-theme-repaint',
					id: win.id,
					error: err,
				} );
			}
		}
	} );

	osSettings.subscribeOsSettings( ( snapshot ) => {
		if ( ! layoutDispatcher ) {
			return;
		}
		const prevLayout = layoutDispatcher.getLayout();
		const prevPlacement = layoutDispatcher.getDockPlacement();

		layoutDispatcher.setDockPlacement( snapshot.dockPlacement );
		layoutDispatcher.setLayout( snapshot.desktopLayout );
		desktopApi.dock = layoutDispatcher.getPrimary();
		desktopApi.sideDock = layoutDispatcher.getSide();
		desktopApi.desktopLayout = snapshot.desktopLayout;
		desktopApi.dockPlacement = layoutDispatcher.getDockPlacement();

		if (
			prevLayout === snapshot.desktopLayout &&
			prevPlacement === snapshot.dockPlacement
		) {
			layoutDispatcher.refresh();
		}

		syncShortcutsNow();

		setCurrentLayout( snapshot.desktopLayout );
	} );

	installShortcutsSync( syncShortcutsNow );

	setCurrentLayout( osSettings.getOsSettingsSnapshot().desktopLayout );

	const desktopApi: OpenStationPublicApi = buildPublicApi( {
		manager,
		dock,
		layoutDispatcher,
		osSettings,
		iconsApi,
		filesApi,
		saveSession,
		widgetLayer,
		registerWindow,
		openWindowById: nativeWindows.openById,
		openNewWindowById: nativeWindows.openNewById,
		loadWindowScriptById: nativeWindows.loadScriptById,
		prewarmWindowById: nativeWindows.prewarmById,
		placeSystemTile,
		setDefaultWindow,
		refreshMenu,
		openOsSettings,
		aiAssistant,
		dragBridge,
		dragManager,
		connect: connectionBridge.connect,
		getConnection: connectionBridge.getConnection,
		mio: mioApi,
		mode: modeController.api,

		workspaces: createWorkspacesApi(
			workspaceDeps ?? {
				manager,
				getNavItems: () => layoutDispatcher?.getNavItems() ?? [],
				adminUrl: config.adminUrl,
				deriveWindowId: ( url: string ) =>
					deriveWindowId( url, config.adminUrl ),
				openNative: nativeWindows.openById,
				refreshLayout: () => layoutDispatcher?.refresh(),
			},
			editWorkspace,
			currentWorkspaceLook,
			createWorkspaceWithWizard,
			saveDesk,
		),
		wallpaperSuspend: {
			suspend: ( reason: string ) => wallpaperLayer?.suspend( reason ),
			resume: ( reason: string ) => wallpaperLayer?.resume( reason ),
			isSuspended: () => wallpaperLayer?.isSuspended() ?? false,
		},
		config,
	} );
	installPublicApi( desktopApi );

	let mobileLayer: MobileLayerHandle | null = null;
	let mobileMountSeq = 0;
	const openNavItemForMobile = createNavItemOpener( {
		manager,
		adminUrl: config.adminUrl,
		openNative: openNativeWindowById,
	} );
	const syncMobileLayer = (): void => {
		const seq = ++mobileMountSeq;
		if ( ! modeController.api.isMobile() ) {
			if ( mobileLayer ) {
				mobileLayer.unmount();
				mobileLayer = null;
			}
			return;
		}
		if ( mobileLayer || ! shellEl ) {
			return;
		}
		const shellForMobile = shellEl;
		ensureMobileLoaded( config.mobileBundleUrl ?? '' )
			.then( ( api ) => {
				if ( seq !== mobileMountSeq || ! modeController.api.isMobile() || mobileLayer ) {
					return;
				}
				mobileLayer = api.mount( {
					manager,
					shell: shellForMobile,
					area: desktopArea,
					mode: modeController.api,
					getNav: () => layoutDispatcher?.getNav() ?? null,
					openNavItem: openNavItemForMobile,
					getBadge: ( item ) =>
						Math.max( item.menu?.badge ?? 0, iconsApi.getBadge( item.id ) ),
					getPinnedTabIds: () => {
						const mine = osSettings.getOsSettingsSnapshot().mobileTabs;
						return Array.isArray( mine ) && mine.length > 0
							? mine
							: config.mode?.tabBar ?? [];
					},
					subscribeNav: ( cb ) => {
						const unsubscribeSettings = osSettings.subscribeOsSettings( cb );
						document.addEventListener( 'os-layout-changed', cb );
						document.addEventListener( 'os-registry-changed', cb );
						return () => {
							unsubscribeSettings();
							document.removeEventListener( 'os-layout-changed', cb );
							document.removeEventListener( 'os-registry-changed', cb );
						};
					},
					wallpaper: {
						suspend: ( reason ) => wallpaperLayer?.suspend( reason ),
						resume: ( reason ) => wallpaperLayer?.resume( reason ),
					},
					openExternal: ( url ) => {
						window.open( url, '_blank', 'noopener' );
					},
					adminUrl: config.adminUrl,
					renderIcon: ( icon, opts ) => renderIcon( icon, opts ),

					getArt: ( item ) => iconsApi.getArt( item.id ) || dock?.getArt( item.id ) || '',
					subscribeArt: ( cb ) => activity.subscribe( 'os/art-changed', () => cb() ),
				} );
			} )
			.catch( ( err ) => {
				if ( typeof console !== 'undefined' ) {
					console.error( '[openstation] the phone layer failed to load:', err );
				}
			} );
	};
	syncMobileLayer();
	modeController.api.subscribe( syncMobileLayer );

	modeController.api.subscribe( ( change ) => {
		if ( change.mode !== 'mobile' && change.previous !== 'mobile' ) {
			return;
		}
		layoutDispatcher?.refresh();
		if ( ! workspaceDeps ) {
			return;
		}
		const active = manager.getActiveDesktopId();
		applyWorkspaceViewForMode( workspaceDeps, active );
		provisionWorkspaceForMode( workspaceDeps, active );
	} );

	scheduleIdleBoot( () => installRecycleBinDropTargets( dragManager ) );

	scheduleIdleBoot( () => installAgentTileDropHandlers() );

	bootHeartbeatBus();

	bootPluginPresenceWatch();

	if ( config.gamesEnabled !== false ) {
		bootGamesChallenges( {
			currentUserId: Number( config.currentUserId ) || 0,
		} );
	}

	scheduleIdleBoot( () => bootContentChangesHeartbeat() );

	scheduleIdleBoot( () => bootNonceRefresh() );

	scheduleIdleBoot( () =>
		bootAuthRecovery( {
			currentUserId: Number( config.currentUserId ) || 0,
		} ),
	);

	installNotesSentinel( {
		bundleUrl: config.notesBundleUrl ?? '',

		hasNotes: Boolean( config.hasNotes ),
		host: desktopArea,
		config,
		onError: ( toast ) => {
			showToast( toast );
		},
	} );

	installFilesOpenDeps( {
		openUrl: ( { id, url, title, icon } ) => {
			if ( tryNativeUrlRemap( url ) ) {
				return true;
			}

			void manager.open( { id, baseId: id, url, title, icon } );
			return true;
		},
		openNativeWindow: ( id ) => nativeWindows.openById( id ),
		deriveWindowId: ( url: string ) => deriveWindowId( url, config.adminUrl ),
	} );
	setFilesUserAssociations(
		( config.userFileAssociations as Record< string, string > | undefined ) ?? {},
	);

	const updateNoticeShown = maybeShowUpdate( {
		update: config.coreUpdate,
		openUrl: ( { url, title } ) => {
			if ( tryNativeUrlRemap( url ) ) {
				return;
			}
			void manager.open( {
				id: 'update-core',
				baseId: 'update-core',
				url,
				title,
				icon: 'dashicons-update',
			} );
		},
	} );

	const openNoticeUrl = ( { url, title }: { url: string; title: string } ): void => {
		if ( tryNativeUrlRemap( url ) ) {
			return;
		}

		const baseId = deriveWindowId( url, config.adminUrl );
		void manager.open( {
			id: baseId,
			baseId,
			url,
			title,
			icon: 'dashicons-info',
		} );
	};
	maybeShowNotices( { notices: config.coreNotices, openUrl: openNoticeUrl } );
	maybeShowNotices( {
		notices: config.pluginNotices,
		openUrl: openNoticeUrl,
		keyPrefix: 'plugin-notice',
	} );

	void maybeShowRebrandNotice( { config } );

	let tourMioSpot: { x: number; y: number } | null = null;
	installShellTour( {
		config,
		windowManager: manager,
		isMobile: () => modeController.api.isMobile(),
		updateNoticeShown,
		openPalette: () => openPaletteOnly( 'desktop-mode-ai-assistant' ),
		openLayoutSettings: () => {
			const wasAlreadyOpen = !! manager.getById( OS_SETTINGS_WINDOW_ID );
			openOsSettings( { tabId: 'appearance' } );
			revealSettingsSection( LAYOUT_SECTION_ID );
			return { windowId: OS_SETTINGS_WINDOW_ID, wasAlreadyOpen };
		},

		findLayoutTarget: () =>
			visibleSettingsSection( LAYOUT_SECTION_ID ) ??
			document.querySelector(
				`.os-dock__item[data-system-id="${ SYSTEM_TILE_ID }"]`,
			),
		closeWindow: ( id: string ) => manager.getById( id )?.close(),
		closePalette: () => {
			const palette = listPalettes().find(
				( p ) => p.id === 'desktop-mode-ai-assistant',
			);
			if ( palette?.isOpen() ) {
				palette.close();
				notifyPaletteVisibility( palette.id, false );
			}
		},

		mio: {
			size: () =>
				modeController.api.isMobile() ? 0 : mioApi.getConfig().appearance.radius * 2,
			summon: () => {
				void mio.summon().then( () => mio.setAnchor( tourMioSpot ) );
			},
			follow: ( spot ) => {
				tourMioSpot = spot;
				mio.setAnchor( spot );
			},
			release: () => {
				tourMioSpot = null;
				mio.setAnchor( null );
				mio.dismiss();
			},
		},
		refreshDesktopIcons: spendMenuRefresh,

		findAssistant: () =>
			document.querySelector(
				'#desktop-mode-ai-assistant:not([hidden]) .os-ai__panel',
			),
		openFallbackWindow: () => {
			const url = `${ config.adminUrl }edit.php`;
			const id = deriveWindowId( url, config.adminUrl );
			void manager.open( {
				id,
				baseId: id,
				url,
				title: __( 'Posts' ),
				icon: 'dashicons-admin-post',
			} );
		},
	} );

	void maybeAskForUsageFeedback( { config } );
	if ( typeof config.filesUrl === 'string' && config.filesUrl ) {
		filesRest.installRestDeps( {
			baseUrl: config.filesUrl,
			nonce: config.restNonce,
		} );

		const rootHost = document.getElementById( 'os-area' );
		if ( rootHost ) {
			const layerHandle = mountFilesLayer( rootHost, 0 );
			const reveal = (): void => {
				if ( ! desktopArea.classList.contains( 'os-area--booting' ) ) {
					return;
				}
				requestAnimationFrame( () => {
					desktopArea.classList.remove( 'os-area--booting' );
				} );
			};
			const safetyTimer = setTimeout( reveal, 2000 );
			void layerHandle.hydrated.then( () => {
				clearTimeout( safetyTimer );
				reveal();
			} );
		}
	}

	scheduleIdleBoot( () => startFilesHeartbeat() );

	scheduleIdleBoot( () => startFilesRestoreSync() );

	scheduleIdleBoot( () => bootPresenceProbe() );

	doAction( HOOKS.COMPONENTS_REGISTERED, { tags: [ ...OS_COMPONENT_TAGS ] } );

	registerBuiltInCommands();

	bootstrapPwa( config, showToast, async () => {
		await saveSession.flush();
		window.location.reload();
	} );

	const overlayPreload = (): void => {
		preloadShellOverlays( config.shellOverlaysBundleUrl ?? '' );

		preloadWindowSystem( config.windowSystemBundleUrl ?? '' );
	};
	if ( typeof window.requestIdleCallback === 'function' ) {
		window.requestIdleCallback( overlayPreload, { timeout: 1500 } );
	} else {
		window.setTimeout( overlayPreload, 0 );
	}

	doAction( HOOKS.INIT, { config } );

	_earlyReady = true;
	const queued = _earlyReadyQueue.splice( 0 );
	for ( const cb of queued ) {
		try {
			cb();
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'when-ready-cb',
				error: err,
			} );
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] whenReady cb threw:', err );
			}
		}
	}

	osSettings.apply();

	if ( ! modeController.api.isMobile() ) {
		widgetLayer?.hydrate();
	} else {
		const unsubscribeHydrate = modeController.api.subscribe( ( change ) => {
			if ( change.mode !== 'mobile' ) {
				unsubscribeHydrate();
				widgetLayer?.hydrate();
			}
		} );
	}

	window.addEventListener( 'pagehide', () => {
		wallpaperLayer?.teardownActive();
		widgetLayer?.disposeAll();
	} );

	bindShellLifecycle();

	bindTopWindowLinkInterceptor( manager, config );

	const relayoutRoot = (
		transform: (
			arr: import( './desktop-files/rest' ).RestPlacementShape[],
		) => import( './desktop-files/rest' ).RestPlacementShape[],
		persist = true,
	): void => {
		const root = filesApi.store.getState().placementsByFolder.get( 0 ) ?? [];
		const ordered = transform( root );

		const canvas = workAreaRectOf( desktopArea );
		const rowsPerCol = Math.max(
			1,
			Math.floor( ( canvas.height - 16 ) / 110 ),
		);
		const occupied = new Set< string >();
		let i = 0;
		for ( const p of ordered ) {
			const cell = snapToEmptyCell(
				16 + Math.floor( i / rowsPerCol ) * 96,
				16 + ( i % rowsPerCol ) * 110,
				occupied,
				canvas,
			);
			occupied.add( `${ cell.col },${ cell.row }` );
			i++;
			if ( p.x === cell.x && p.y === cell.y ) {
				continue;
			}
			filesApi.store.upsertPlacement( {
				...p,
				x: cell.x,
				y: cell.y,
				sortOrder: i,
			} );

			if ( ! persist || isSyntheticPlacement( p ) ) {
				continue;
			}
			void filesRest
				.updatePlacement( p.id, {
					x: cell.x,
					y: cell.y,
					sortOrder: i,
				} )
				.catch( ( err: unknown ) => {
					console.error( '[openstation] relayout persist failed', err );
				} );
		}
	};

	const rootSortTransform = ( mode: RootSortMode ) => (
		arr: import( './desktop-files/rest' ).RestPlacementShape[],
	): import( './desktop-files/rest' ).RestPlacementShape[] => {
		const sorted = arr.slice();
		switch ( mode ) {
			case 'name-asc':
				sorted.sort( ( a, b ) =>
					a.file.title.localeCompare( b.file.title ),
				);
				break;
			case 'name-desc':
				sorted.sort( ( a, b ) =>
					b.file.title.localeCompare( a.file.title ),
				);
				break;
			case 'date-asc':
				sorted.sort( ( a, b ) => a.updatedAtMs - b.updatedAtMs );
				break;
			case 'date-desc':
				sorted.sort( ( a, b ) => b.updatedAtMs - a.updatedAtMs );
				break;
		}
		return sorted;
	};

	const ROOT_SORT_MODE_KEY = 'desktop-mode:root-sort-mode';
	const isRootSortMode = ( v: unknown ): v is RootSortMode =>
		v === 'name-asc' ||
		v === 'name-desc' ||
		v === 'date-asc' ||
		v === 'date-desc';
	let rootSortMode: RootSortMode | null = ( () => {
		try {
			const raw = window.localStorage.getItem( ROOT_SORT_MODE_KEY );
			return isRootSortMode( raw ) ? raw : null;
		} catch {
			return null;
		}
	} )();
	const setRootSortMode = ( mode: RootSortMode | null ): void => {
		rootSortMode = mode;
		try {
			if ( mode ) {
				window.localStorage.setItem( ROOT_SORT_MODE_KEY, mode );
			} else {
				window.localStorage.removeItem( ROOT_SORT_MODE_KEY );
			}
		} catch {

		}
	};

	addAction(
		'os.files.tile-manually-placed',
		'desktop-mode/root-sort-clear',
		( payload: unknown ) => {
			const folderId = ( payload as { folderId?: number } | undefined )
				?.folderId;
			if ( folderId === 0 ) {
				setRootSortMode( null );
			}
		},
	);

	{
		let last = workAreaRectOf( desktopArea );
		const repack = (): void => {
			if ( ! rootSortMode ) {
				return;
			}
			const next = workAreaRectOf( desktopArea );
			if ( next.width === last.width && next.height === last.height ) {
				return;
			}
			last = next;
			relayoutRoot( rootSortTransform( rootSortMode ), false );
		};
		if ( typeof ResizeObserver !== 'undefined' ) {
			const ro = new ResizeObserver( repack );
			ro.observe( desktopArea );
		}
		subscribeWorkArea( repack );
	}

	let pointerdownOnWallpaper = false;
	desktopArea.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( ! e.isPrimary ) {
			return;
		}
		pointerdownOnWallpaper = e.target === desktopArea;
	} );
	desktopArea.addEventListener( 'click', ( e: MouseEvent ) => {
		if ( ! osSettings.state.showDesktopOnWallpaperClick ) {
			return;
		}

		if ( e.target !== desktopArea ) {
			return;
		}

		if ( ! pointerdownOnWallpaper ) {
			return;
		}

		if ( desktopArea.classList.contains( 'os-area--overview' ) ) {
			return;
		}

		if ( isWallpaperMenuOpen() ) {
			return;
		}

		if ( dragManager.recentlyEndedDrag() ) {
			return;
		}

		if ( recentlyMarqueed() ) {
			return;
		}
		manager.toggleShowDesktop();
	} );

	desktopArea.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		if ( e.target !== desktopArea ) {
			return;
		}
		e.preventDefault();
		const clientX = e.clientX;
		const clientY = e.clientY;
		( () => {
			if ( desktopArea.classList.contains( 'os-area--overview' ) ) {
				return;
			}

			if ( isWallpaperMenuOpen() ) {
				closeWallpaperMenu();
				return;
			}

			const dropClient = { x: clientX, y: clientY };

			const cellAtClick = (): { x: number; y: number } => {
				const rect = desktopArea.getBoundingClientRect();
				const rawX = Math.max( 0, dropClient.x - rect.left );
				const rawY = Math.max( 0, dropClient.y - rect.top );
				const occupied = buildOccupiedSet(
					filesApi.store.getState().placementsByFolder.get( 0 ) ?? [],
				);
				return snapToEmptyCell(
					rawX,
					rawY,
					occupied,
					workAreaRectOf( desktopArea ),
				);
			};
			const createUrlPlacement = (
				dialogTitle: string,
				description: string,
			): void => {
				openUrlDialog( {
					title: dialogTitle,
					description,
					nameLabel: 'Name',
					urlLabel: 'URL',
					submitLabel: 'Create',
					onSubmit: async ( { name, url } ) => {
						const cell = cellAtClick();
						const placement = await filesRest.createPlacement( {
							type: 'link',
							ref: url,
							parentId: 0,
							x: cell.x,
							y: cell.y,
							meta: name ? { name } : undefined,
						} );
						filesApi.store.upsertPlacement( placement );
					},
				} );
			};
			const items = buildWallpaperMenuItems( {
				createFolder: () => {
					openCreateFolderDialog( {
						onSubmit: async ( name ) => {
							const folder = await filesRest.createFolder( { name } );
							const cell = cellAtClick();
							const placement = await filesRest.createPlacement( {
								type: 'folder',
								ref: String( folder.id ),
								parentId: 0,
								x: cell.x,
								y: cell.y,
							} );
							filesApi.store.upsertFolder( folder );
							filesApi.store.upsertPlacement( placement );
						},
					} );
				},
				createUrl: () =>
					createUrlPlacement(
						'New URL',
						'Opens the URL in a new browser tab.',
					),
				addWidget: () => widgetLayer?.openPicker(),
				toggleShowDesktop: () => manager.toggleShowDesktop(),
				openOsSettings: () => openOsSettings(),
				sortIcons: ( mode ) => {
					setRootSortMode( mode );
					relayoutRoot( rootSortTransform( mode ) );
				},
				currentSortMode: rootSortMode,
				includeShowDesktop:
					! osSettings.state.showDesktopOnWallpaperClick,
				position: { x: clientX, y: clientY },
				labels: {
					createFolder: 'New folder',
					showDesktop: 'Show desktop',
					osSettings: 'OpenStation Preferences',
					sortHeading: 'Sort by',
					sortNameAsc: 'Name (A → Z)',
					sortNameDesc: 'Name (Z → A)',
					sortDateAsc: 'Date (oldest first)',
					sortDateDesc: 'Date (newest first)',
					newUrl: 'New URL',
					addWidget: 'Add widget',
				},
				serverItems: ( config.serverWallpaperMenuItems as
				| ServerWallpaperMenuItem[]
				| undefined ) ?? [],
			} );

			openWallpaperMenu(
				document.body,
				{ x: clientX, y: clientY },
				items,
			);
		} )();
	} );

	installFileDropSentinel( {
		bundleUrl: config.fileDropBundleUrl ?? '',
		boot: {
			config: config.dropConfig,
			mediaUrl: config.mediaUrl,
			restNonce: config.restNonce,
			filesUrl: config.filesUrl,
			storage: config.desktopStorage,
		},
	} );

	document.dispatchEvent(
		new CustomEvent( 'os-init', {
			detail: { config, restored: hasSession },
		} ),
	);
}

startMissingImportWarner();

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}

export { clampGeometryToViewport } from './boot/geometry';
