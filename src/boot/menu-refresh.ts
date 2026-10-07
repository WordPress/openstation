import { HOOKS, doAction } from '../hooks';
import { createApplyPayload } from '../menu-refresh-apply';
import { INITIAL_ORIGIN } from './origin';
import type { LayoutDispatcher } from '../desktop-layout';
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
	DesktopUnfocusEffectScriptServerEntry,
	DesktopWindowLinkRendererScriptServerEntry,
	DesktopWallpaperServerEntry,
	DesktopGameServerEntry,
	DesktopThemeServerEntry,
	DesktopWidgetServerEntry,
	NativeWindowServerEntry,
	MultisiteConfig,
} from '../types';

const MENU_REFRESH_TIMEOUT_MS = 8000;

const UPDATES_REFRESH_DEBOUNCE_MS = 600;

export interface MenuRefreshDeps {
	layoutDispatcher: LayoutDispatcher | null;
	desktopArea: HTMLElement;
	config: DesktopConfig;
	syncNativeWindows: ( list: NativeWindowServerEntry[] ) => Promise< void >;
	syncServerWidgets: ( list: DesktopWidgetServerEntry[] ) => Promise< void >;
	syncServerWallpapers: ( list: DesktopWallpaperServerEntry[] ) => Promise< void >;
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

	syncServerDesktopThemes?: ( list: DesktopThemeServerEntry[] ) => void;

	applyMultisite?: ( block: MultisiteConfig | null ) => void;
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;

	refreshRootPlacements?: ( addedIconIds: string[] ) => void;

	syncShortcuts?: () => void;

	syncWindowSubmenus?: () => void;
}

export function bindMenuRefresh( deps: MenuRefreshDeps ): () => Promise< void > {
	const {
		layoutDispatcher,
		desktopArea,
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
		applyMultisite,
		renderIcons,
		refreshRootPlacements,
		syncShortcuts,
		syncWindowSubmenus,
	} = deps;

	const applyPayload = createApplyPayload( {
		applyDockItems: ( items ) => layoutDispatcher?.applyDockItems( items ),
		desktopArea,
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
		applyMultisite,
		renderIcons,

		applyDesktopIcons: ( icons ) =>
			layoutDispatcher?.applyDesktopIcons( icons ),
		refreshRootPlacements,
		syncShortcuts,
		syncWindowSubmenus,
	} );

	let lastMenuSig: string =
		typeof config.menuSig === 'string' ? config.menuSig : '';

	let sigRefreshInFlight = false;

	let updatesRefreshTimer: number | null = null;
	let updatesRefreshInFlight = false;
	let updatesRefreshQueued = false;

	const refresh = (): Promise< void > => {
		if ( ! config.adminUrl ) {
			return Promise.resolve();
		}
		const probeUrl = ( () => {
			try {
				const url = new URL( 'admin.php', config.adminUrl );
				url.searchParams.set( 'openstation_chromeless', '1' );
				url.searchParams.set( 'openstation_menu_refresh', '1' );
				return url.toString();
			} catch ( _err ) {
				return null;
			}
		} )();
		if ( ! probeUrl ) {
			return Promise.resolve();
		}

		return new Promise< void >( ( resolve ) => {
			const iframe = document.createElement( 'iframe' );

			iframe.setAttribute( 'aria-hidden', 'true' );
			iframe.tabIndex = -1;
			iframe.style.cssText =
				'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
			iframe.src = probeUrl;

			let done = false;
			const cleanup = (): void => {
				if ( done ) {
					return;
				}
				done = true;
				window.clearTimeout( timeoutId );
				window.removeEventListener( 'message', onMessage );
				if ( iframe.parentNode ) {
					iframe.parentNode.removeChild( iframe );
				}
				resolve();
			};

			const onMessage = ( e: MessageEvent ): void => {
				if ( e.source !== iframe.contentWindow ) {
					return;
				}
				const data = e.data as { type?: string } | null;
				if ( ! data || data.type !== 'os-plugins-changed' ) {
					return;
				}

				cleanup();
			};

			const timeoutId = window.setTimeout( () => {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'menu-refresh',
					error: new Error( 'menu refresh probe timed out' ),
				} );
				cleanup();
			}, MENU_REFRESH_TIMEOUT_MS );

			window.addEventListener( 'message', onMessage );
			document.body.appendChild( iframe );
		} );
	};

	const runUpdatesRefresh = (): void => {
		if ( updatesRefreshInFlight ) {
			updatesRefreshQueued = true;
			return;
		}
		updatesRefreshInFlight = true;
		void refresh().finally( () => {
			updatesRefreshInFlight = false;
			if ( updatesRefreshQueued ) {
				updatesRefreshQueued = false;
				runUpdatesRefresh();
			}
		} );
	};

	const scheduleUpdatesRefresh = (): void => {
		if ( updatesRefreshTimer !== null ) {
			window.clearTimeout( updatesRefreshTimer );
		}
		updatesRefreshTimer = window.setTimeout( () => {
			updatesRefreshTimer = null;
			runUpdatesRefresh();
		}, UPDATES_REFRESH_DEBOUNCE_MS );
	};

	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== INITIAL_ORIGIN ) {
			return;
		}
		const data = e.data as {
			type?: string;
			sig?: unknown;
			payload?: {
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
				serverWindowActionScripts?: unknown;
				serverUnfocusEffectScripts?: unknown;
				serverWindowLinkRendererScripts?: unknown;
				serverGames?: unknown;
				serverDesktopThemes?: unknown;
				desktopIcons?: unknown;

				scriptDepPayloads?: unknown;
				menuSig?: unknown;
			};
		} | null;
		if ( ! data ) {
			return;
		}

		if ( data.type === 'os-plugins-changed' ) {
			if ( data.payload ) {
				applyPayload( data.payload );

				if ( typeof data.payload.menuSig === 'string' ) {
					lastMenuSig = data.payload.menuSig;
				}
			}
			return;
		}

		if ( data.type === 'os-updates-changed' ) {
			scheduleUpdatesRefresh();
			return;
		}

		if ( data.type === 'os-menu-signature' ) {
			const sig = data.sig;
			if (
				typeof sig === 'string' &&
				sig !== '' &&
				sig !== lastMenuSig &&
				! sigRefreshInFlight
			) {
				sigRefreshInFlight = true;
				void refresh().finally( () => {
					sigRefreshInFlight = false;
				} );
			}
		}
	} );

	return refresh;
}
