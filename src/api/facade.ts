/**
 * Public API facade — `wp.desktop.*` assembly.
 *
 * **Why this exists.** The runtime side of the public API used to
 * be assembled inline inside `init()` as a single ~280-LOC object
 * literal. Plugin authors who wanted to know "what's available on
 * `wp.desktop`?" had to scroll through `desktop.ts` looking for
 * the literal. Phase 5 of the architecture-0.8.1 boot
 * decomposition pulls the literal out: `init()` builds a
 * dependency bag and calls `buildPublicApi(deps)`; this module
 * owns the literal, the reserved-namespace allowlist, and the
 * merge-onto-shim assignment.
 *
 * **Backwards compatibility.** Everything attached to
 * `window.wp.desktop` before the extraction is still attached
 * after — same names, same shapes, same semantics. Tests
 * exercising `wp.desktop.*` continue to pass unchanged.
 *
 * @since 0.8.1
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
import { broadcast, subscribe } from '../broadcast';
import { devtools } from '../devtools';
import { showToast } from '../toast';
import { activity } from '../activity';
import { heartbeat } from '../heartbeat';
import { presenceApi } from '../presence';
import { createSharedStore } from '../shared-store';
import { wpdConfirm } from '../wpd-confirm';
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
	WpDesktopPublicApi,
} from '../desktop';
import type { WindowManager } from '../window-manager';
import type { Window as DesktopWindow } from '../window';
import type { Dock, SystemDockItem } from '../dock';
import type { LayoutDispatcher } from '../desktop-layout';
import type { OsSettings } from '../settings';
import type { IconsApi } from '../desktop-icons';
import type { FilesApi } from '../desktop-files';
import type { WidgetLayer } from '../widgets/layer';
import type { AiAssistantApi } from '../ai-assistant';
import type { DragBridgeApi } from '../drag-bridge';
import type { DragManagerApi } from '../drag';
import type { WindowConnection, ConnectOptions } from '../connection';
import type { WallpaperDef } from '../wallpapers/types';
import type { NativeWindowDef, DesktopConfig } from '../types';

/**
 * Built-in keys on `wp.desktop` that `registerNamespace()` refuses
 * to overwrite. The runtime check inside `registerNamespace`
 * consults this allowlist; keep it in sync with
 * {@link WpDesktopPublicApi}.
 *
 * Lives here (not in `desktop.ts`) because the facade is the one
 * place that owns the assembly of `wp.desktop.*`. A new public
 * key SHOULD be added here in the same change that adds the
 * field to the interface.
 *
 * @since 0.8.1
 */
export const RESERVED_NAMESPACE_KEYS: ReadonlySet< string > = new Set( [
	'windowManager', 'dock', 'taskbar', 'icons', 'saveSession', 'hooks', 'HOOKS',
	'isActive', 'registerWallpaper', 'registerWidget', 'widgetLayer',
	'registerSystemTile', 'registerWindow', 'openWindow', 'cloneTemplate',
	'onWindow', 'loadVendorScript', 'getWallpaperSurfaces', 'registerModule',
	'loadModules', 'whenReady', 'ready', 'isReady', 'setDefaultWindow',
	'refreshMenu', 'config', 'ai', 'dragBridge', 'dragManager', 'registerCommand',
	'unregisterCommand', 'listCommands', 'registerSettingsTab',
	'unregisterSettingsTab', 'listSettingsTabs',
	'registerDockRailRenderer', 'unregisterDockRailRenderer', 'listDockRailRenderers',
	'openOsSettings', 'getOsSettings', 'subscribeOsSettings', 'updateOsSettings',
	'deriveWindowId',
	'listSystemTiles', 'getSystemTile', 'getMenuItems',
	'renderIcon',
	'applyTileClasses', 'applyTileElement', 'applyTileTooltip',
	'dispatchTileRendered',
	'isDockElement', 'registerDockSelector',
	'registerTitleBarButton',
	'unregisterTitleBarButton', 'listTitleBarButtons',
	'registerWindowTheme', 'unregisterWindowTheme', 'listWindowThemes',
	'applyWindowTheme',
	'registerWindowControl', 'unregisterWindowControl', 'listWindowControls',
	'applyWindowControls',
	'registerWindowSlot', 'unregisterWindowSlot', 'listWindowSlots',
	'applyWindowSlot',
	'registerWindowChrome', 'unregisterWindowChrome', 'listWindowChromes',
	'applyWindowChrome',
	'connect',
	'broadcast', 'subscribe', 'registerPalette', 'unregisterPalette',
	'listPalettes', 'openPalette', 'devtools', 'createSharedStore',
	'presence', 'activity', 'heartbeat', 'showToast', 'renderKeyedList',
	'clearKeyedList', 'registerNamespace',
	'notify', 'pwa',
	'getWindowConfig', 'debug',
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
	registerWindow: ( def: NativeWindowDef ) => DesktopWindow;
	openWindowById: ( id: string, opts?: { source?: string } ) => boolean;
	openNewWindowById: ( id: string, opts?: { source?: string } ) => boolean;
	placeSystemTile: ( item: SystemDockItem ) => void;
	setDefaultWindow: ( url: string | null ) => Promise< void >;
	refreshMenu: () => Promise< void >;
	openOsSettings: () => void;
	aiAssistant: AiAssistantApi;
	dragBridge: DragBridgeApi;
	dragManager: DragManagerApi;
	connect: ( targetWindowId: string, opts?: ConnectOptions ) => WindowConnection;
	config: DesktopConfig;
}

/**
 * Build the `wp.desktop.*` public API object.
 *
 * Pure: no side effects, no mutation of `window.wp.desktop`. The
 * caller (init in `desktop.ts`) is responsible for merging the
 * returned object onto the early-shim slot — see
 * {@link installPublicApi}.
 *
 * @since 0.8.1
 */
export function buildPublicApi( deps: BuildPublicApiDeps ): WpDesktopPublicApi {
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
		placeSystemTile,
		setDefaultWindow,
		refreshMenu,
		openOsSettings,
		aiAssistant,
		dragBridge,
		dragManager,
		connect,
		config,
	} = deps;

	const desktopApi: WpDesktopPublicApi = {
		windowManager: manager,
		dock,
		sideDock: layoutDispatcher?.getSide() ?? null,
		desktopLayout: osSettings.getOsSettingsSnapshot().desktopLayout,
		icons: iconsApi,
		files: filesApi,
		confirm: wpdConfirm,
		saveSession,
		hooks: rawHooks(),
		HOOKS,
		isActive: () => !! document.getElementById( 'desktop-mode-shell' ),
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
			// `wp.desktop.widgetLayer.add(id)` /
			// `ensureMounted(id)` — exposed below.
		},
		widgetLayer,
		loadVendorScript,
		getWallpaperSurfaces: () => collectWallpaperSurfaces( manager ),
		registerWindow,
		openWindow: openWindowById,
		openNewWindow: openNewWindowById,
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
			// Whitelist only the public-snapshot keys so a typo'd
			// field can't bloat the persisted state. The setters
			// mutate the underlying private OsSettingsState, then
			// `save()` runs the debounced REST sync + localStorage
			// write + notifies every subscriber.
			if ( typeof patch.wallpaper === 'string' ) {
				osSettings.state.wallpaper = patch.wallpaper;
			}
			if ( typeof patch.accent === 'string' ) {
				osSettings.state.accent =
					patch.accent as typeof osSettings.state.accent;
			}
			if ( typeof patch.dockSize === 'string' ) {
				osSettings.state.dockSize =
					patch.dockSize as typeof osSettings.state.dockSize;
			}
			if ( typeof patch.desktopLayout === 'string' ) {
				osSettings.state.desktopLayout =
					patch.desktopLayout as typeof osSettings.state.desktopLayout;
			}
			if ( typeof patch.dockRailRenderer === 'string' ) {
				osSettings.state.dockRailRenderer = patch.dockRailRenderer;
			}
			if ( patch.ai && typeof patch.ai === 'object' ) {
				osSettings.state.ai = { ...osSettings.state.ai, ...patch.ai };
			}
			if ( typeof patch.nativePostsEnabled === 'boolean' ) {
				osSettings.state.nativePostsEnabled = patch.nativePostsEnabled;
			}
			if ( typeof patch.nativePagesEnabled === 'boolean' ) {
				osSettings.state.nativePagesEnabled = patch.nativePagesEnabled;
			}
			if ( typeof patch.nativeUsersEnabled === 'boolean' ) {
				osSettings.state.nativeUsersEnabled = patch.nativeUsersEnabled;
			}
			if ( typeof patch.nativePluginsEnabled === 'boolean' ) {
				osSettings.state.nativePluginsEnabled = patch.nativePluginsEnabled;
			}
			if ( typeof patch.nativeCommentsEnabled === 'boolean' ) {
				osSettings.state.nativeCommentsEnabled = patch.nativeCommentsEnabled;
			}
			if ( Array.isArray( patch.nativePostsHiddenColumns ) ) {
				osSettings.state.nativePostsHiddenColumns =
					patch.nativePostsHiddenColumns
						.filter(
							( v ): v is string =>
								typeof v === 'string' && v !== '',
						)
						.slice( 0, 32 );
			}
			if (
				patch.itemVisibility &&
				typeof patch.itemVisibility === 'object'
			) {
				const allowed = [ 'both', 'dock', 'desktop', 'hidden' ];
				const next: Record<
					string,
					'both' | 'dock' | 'desktop' | 'hidden'
				> = {};
				for ( const [ k, v ] of Object.entries(
					patch.itemVisibility as Record< string, unknown >,
				) ) {
					if ( typeof k !== 'string' || k === '' ) {
						continue;
					}
					if ( typeof v !== 'string' || ! allowed.includes( v ) ) {
						continue;
					}
					next[ k ] = v as
						| 'both'
						| 'dock'
						| 'desktop'
						| 'hidden';
				}
				osSettings.state.itemVisibility = next;
			}
			if ( Array.isArray( patch.dockOrder ) ) {
				osSettings.state.dockOrder = patch.dockOrder
					.filter(
						( v ): v is string =>
							typeof v === 'string' && v !== '',
					)
					.slice( 0, 256 );
			}
			osSettings.save( opts );
			// Belt-and-suspenders live repaint for visibility / order
			// changes. The `subscribeOsSettings` listener installed in
			// `desktop.ts` already calls `layoutDispatcher.refresh()`,
			// but that wiring sits behind a few defensive guards (TDZ
			// on `desktopApi`, conditional layout compare, third-party
			// subscribers that may throw and short-circuit downstream
			// listeners since `save()` iterates a single Set). Re-
			// invoking refresh() directly here makes the dock + icon
			// grid pick up the new placement synchronously with the
			// write — no F5 required for "Hide from dock" / "Also show
			// on desktop" picks from the right-click menu.
			if ( patch.itemVisibility || patch.dockOrder ) {
				layoutDispatcher?.refresh();
			}
		},
		deriveWindowId: ( url: string, overrideAdminUrl?: string ) =>
			deriveWindowId( url, overrideAdminUrl ?? config.adminUrl ),
		listSystemTiles: () => layoutDispatcher?.listSystemTiles() ?? [],
		getSystemTile: ( id: string ) =>
			layoutDispatcher?.getSystemTile( id ) ?? null,
		getMenuItems: () => layoutDispatcher?.getMenuItems() ?? [],
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
		registerWindowTheme,
		unregisterWindowTheme,
		listWindowThemes,
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
		broadcast,
		subscribe,
		registerPalette,
		unregisterPalette,
		listPalettes,
		openPalette: openPaletteOnly,
		devtools,
		createSharedStore,
		presence: presenceApi,
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
					'[desktop-mode] registerNamespace: name must be a non-empty string',
				);
				return;
			}
			if ( ! api || typeof api !== 'object' ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[desktop-mode] registerNamespace("${ name }"): api must be an object`,
				);
				return;
			}
			if ( RESERVED_NAMESPACE_KEYS.has( name ) ) {
				// eslint-disable-next-line no-console
				console.warn(
					`[desktop-mode] registerNamespace("${ name }"): name is reserved by the shell — pick a plugin-specific key`,
				);
				return;
			}
			( desktopApi as unknown as Record< string, unknown > )[ name ] = api;
		},
		getWindowConfig: < T = Record< string, unknown > >(
			id: string,
		): T | undefined => {
			const store = window.desktopModeWindowConfig;
			if ( ! store || typeof store !== 'object' ) {
				return undefined;
			}
			const value = ( store as Record< string, unknown > )[ id ];
			return value === undefined ? undefined : ( value as T );
		},
		debug: {
			window: ( id: string ): DesktopDebugWindow | null => {
				const entry = ( config.nativeWindows ?? [] ).find(
					( e ) => e.id === id,
				);
				if ( ! entry ) {
					return null;
				}
				const url = entry.scriptUrl || '';
				let loadPath: 'eager' | 'lazy' | 'unknown' = 'unknown';
				let tagInDom = false;
				if ( url ) {
					const lazyTag = document.querySelector(
						`script[data-desktop-mode-vendor="${ url.replace( /"/g, '\\"' ) }"]`,
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
				const cfgStore = window.desktopModeWindowConfig;
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
 * `window.wp.desktop` (or set it directly if the shim is
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
 *
 * @since 0.8.1
 */
export function installPublicApi( api: WpDesktopPublicApi ): void {
	if ( ! window.wp ) {
		window.wp = {};
	}
	if ( ! window.wp.desktop ) {
		window.wp.desktop = api;
		return;
	}
	Object.assign(
		window.wp.desktop as unknown as Record< string, unknown >,
		api as unknown as Record< string, unknown >,
	);
}
