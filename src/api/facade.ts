/**
 * Public API facade — `wp.os.*` assembly.
 *
 * **Why this exists.** The runtime side of the public API used to
 * be assembled inline inside `init()` as a single ~280-LOC object
 * literal. Plugin authors who wanted to know "what's available on
 * `wp.os`?" had to scroll through `desktop.ts` looking for
 * the literal. Phase 5 of the architecture-0.8.1 boot
 * decomposition pulls the literal out: `init()` builds a
 * dependency bag and calls `buildPublicApi(deps)`; this module
 * owns the literal, the reserved-namespace allowlist, and the
 * merge-onto-shim assignment.
 *
 * **Backwards compatibility.** Everything attached to
 * `window.wp.os` before the extraction is still attached
 * after — same names, same shapes, same semantics. Tests
 * exercising `wp.os.*` continue to pass unchanged.
 */

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

/**
 * Built-in keys on `wp.os` that `registerNamespace()` refuses
 * to overwrite. The runtime check inside `registerNamespace`
 * consults this allowlist; keep it in sync with
 * {@link OpenStationPublicApi}.
 *
 * Lives here (not in `desktop.ts`) because the facade is the one
 * place that owns the assembly of `wp.os.*`. A new public
 * key SHOULD be added here in the same change that adds the
 * field to the interface.
 */
export const RESERVED_NAMESPACE_KEYS: ReadonlySet< string > = new Set( [
	'windowManager', 'dock', 'sideDock', 'taskbar', 'desktopLayout',
	'dockPlacement', 'icons', 'iconSet',
	'files', 'confirm', 'saveSession', 'hooks', 'HOOKS',
	'isActive', 'registerWallpaper', 'registerWidget', 'widgetLayer', 'widgets',
	'registerSystemTile', 'registerWindow', 'openWindow', 'openNewWindow',
	'cloneTemplate', 'onWindow', 'createInfiniteList', 'startOAuth',
	'repaintLoadingOverlays',
	'loadVendorScript', 'getWallpaperSurfaces', 'wallpaper', 'games',
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

/**
 * Bag of dependencies the facade needs from `init()`. Every value
 * here is a closure or instance created during boot; everything
 * else is imported directly inside this module.
 */
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
	workspaces: WorkspacesApi;
	config: DesktopConfig;
}

/**
 * Build the `wp.os.*` public API object.
 *
 * Pure: no side effects, no mutation of `window.wp.os`. The
 * caller (init in `desktop.ts`) is responsible for merging the
 * returned object onto the early-shim slot — see
 * {@link installPublicApi}.
 */
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
			// Re-apply so a plugin that registers its own wallpaper
			// and sets the user's selection to it in the same breath
			// sees an immediate repaint rather than having to wait
			// for the next OS Settings open.
			osSettings.apply();
		},
		registerWidget: ( def ) => {
			widgetRegistry.register( def );
			// No re-paint needed: the layer only mounts IDs the
			// user explicitly enabled, so adding a new def just
			// makes it available in the next picker open. Plugins
			// wanting to force a widget on can call
			// `wp.os.widgetLayer.add(id)` /
			// `ensureMounted(id)` — exposed below.
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
		games: gamesApi,
		registerWindow,
		openWindow: openWindowById,
		openNewWindow: openNewWindowById,
		loadWindowScript: loadWindowScriptById,
		// No dep injection — the loader reads its URL off the boot
		// config and owns its own single-flight state, so the facade
		// hands the function through untouched.
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
			// The store owns the write: every `OsSettingsState` key is
			// admitted through the same sanitizer that reads user meta
			// (an invalid value is ignored, an unknown key never
			// lands, the seeded-theme ledger stays shell-owned), the
			// save runs the debounced REST sync + localStorage write +
			// notifies every subscriber, and a presentation key is
			// applied so the change is visible now rather than on the
			// next page load.
			osSettings.update( patch, opts );
			// Belt-and-suspenders live repaint for visibility / order
			// changes. The `subscribeOsSettings` listener installed in
			// `desktop.ts` already calls `layoutDispatcher.refresh()`,
			// but that wiring sits behind a few defensive guards (TDZ
			// on `desktopApi`, conditional layout compare, third-party
			// subscribers that may throw and short-circuit downstream
			// listeners since `save()` iterates a single Set). Re-
			// invoking refresh() directly here makes the dock + icon
			// grid pick up the new placement synchronously with the
			// write — no F5 required for "Hide from dock" / "Show on
			// desktop" picks from the right-click menu.
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
			// Hydrate boot-slimmed entries (`cssDeferred: true`) with
			// their full `cssText` / `tokens` WITHOUT activating
			// anything — the awaitable the `cssDeferred` docs point
			// consumers at. `setActive()` triggers the same fetch
			// itself, but activation must not be the only door.
			ensureFull: ensureFullDesktopThemes,
			subscribe: subscribeDesktopThemes,
			resolveIcon: resolveThemedIcon,
			resolveIconColor: resolveThemedIconColor,
			applyRecommendedOsSettings: ( themeId ) => {
				const target = themeId ?? getActiveDesktopThemeId() ?? '';
				if ( target === '' ) {
					return {};
				}
				// Forced, because this entry point IS the deliberate
				// re-apply. First-activation seeding happens when the
				// theme is activated (`updateOsSettings( { desktopTheme } )`
				// or the Themes tab); a caller reaching for this is
				// asking for the author's arrangement back.
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
				// eslint-disable-next-line no-console
				console.warn(
					'[openstation] registerNamespace: name must be a non-empty string',
				);
				return;
			}
			if ( ! api || typeof api !== 'object' ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[openstation] registerNamespace("${ name }"): api must be an object`,
				);
				return;
			}
			if ( RESERVED_NAMESPACE_KEYS.has( name ) ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[openstation] registerNamespace("${ name }"): name is reserved by the shell — pick a plugin-specific key`,
				);
				return;
			}
			( desktopApi as unknown as Record< string, unknown > )[ name ] = api;
			// `wp.os` is the boot shim with this literal's members COPIED
			// onto it (`installPublicApi`), not this object — so a write
			// here alone never reached the page. The app runtime's
			// `wp.os.apps` was the namespace that showed it.
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
		/**
		 * What an OPEN window is showing right now.
		 *
		 * The render callback receives the same object as
		 * `ctx.params`, and that is the right place to read it when
		 * you have one. This is for the code that doesn't: a
		 * declarative window whose body is a PHP template, a module
		 * that mounts after the render callback ran, anything
		 * reacting to a retarget from outside a
		 * `HOOKS.WINDOW_REOPENED` subscriber. The manager keeps the
		 * live copy — a reopen with new params writes it before the
		 * reopen event fires — so this and `ctx.params` never
		 * disagree.
		 */
		getWindowParams: (
			id: string,
		): Record< string, string | number | boolean > | undefined => {
			const win = manager.getById( id );
			if ( ! win ) {
				return undefined;
			}
			// Copy: the caller must not be able to retarget a window
			// by mutating what it was handed.
			return { ...( win.config.params ?? {} ) };
		},
		// Re-exported straight from the registry module. The
		// singleton lives in a shared store, so main and the lazy
		// window-system bundle write to and read from one list —
		// which is exactly why this can be handed out as-is.
		registerNativeUrlRemap,
		debug: {
			window: ( id: string ): DesktopDebugWindow | null => {
				const entry = ( config.nativeWindows ?? [] ).find(
					( e ) => e.id === id,
				);
				if ( ! entry ) {
					return null;
				}
				// Wire entries reference their bundle by handle; the
				// resolved URL lives in the handle-keyed script-data
				// map. Old inline entries still carry it directly.
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
						// Match a non-lazy `<script src>` whose URL
						// equals our resolved URL (with or without
						// the `?ver=` query).
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

/**
 * Merge a built API onto the early-shim object on
 * `window.wp.os` (or set it directly if the shim is
 * missing — degraded path that should never trigger in
 * production because the IIFE at the top of `desktop.ts`
 * installs the shim before `init()` runs).
 *
 * Critically: we MERGE rather than reassign because the shim's
 * `whenReady` closure captures `_earlyReadyQueue`. Reassigning
 * would orphan the queue from the bootstrap's drain step and
 * `whenReady` callbacks queued before the API attached would
 * never fire. `Object.assign` overwrites `whenReady` / `ready` /
 * `isReady` with the canonical versions from `src/hooks.ts`.
 */
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
