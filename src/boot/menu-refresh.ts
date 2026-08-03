/**
 * Live menu-refresh pipeline.
 *
 * Listens for `os-plugins-changed` postMessages and
 * forwards every payload they carry to the apply step. The
 * chromeless bridge in `render.php` always emits a payload from
 * real admin context — both for the implicit case (`plugins.php`
 * etc.) and for the explicit refresh probe
 * (`?open_station_menu_refresh=1`) — so a single mechanism handles
 * every refresh.
 *
 * `bindMenuRefresh()` returns an async function plugins can call
 * to force a refresh. The implementation spawns a 1×1 hidden
 * iframe at `admin.php?open_station_chromeless=1&open_station_menu_refresh=1`,
 * waits for the bridge's payload message, then disposes the
 * iframe.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 */

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
	DesktopUnfocusEffectScriptServerEntry,
	DesktopWindowLinkRendererScriptServerEntry,
	DesktopWallpaperServerEntry,
	DesktopGameServerEntry,
	DesktopThemeServerEntry,
	DesktopWidgetServerEntry,
	NativeWindowServerEntry,
} from '../types';

/**
 * Hard ceiling on how long `refreshMenu()` waits for its hidden
 * iframe to emit the `os-plugins-changed` payload before
 * giving up. The probe is a normal admin page load, so the cap is
 * sized for a slow shared host on first request rather than the
 * happy path.
 */
const MENU_REFRESH_TIMEOUT_MS = 8000;

/**
 * Trailing debounce for `os-updates-changed` nudges. Long
 * enough to collapse the burst from several open windows reporting the
 * same shiny-update run, short enough that the badge repaint still
 * reads as immediate.
 */
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
	/** See `MenuRefreshDeps.syncServerDesktopThemes` in `../menu-refresh-apply`. */
	syncServerDesktopThemes?: ( list: DesktopThemeServerEntry[] ) => void;
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;
	/** See `MenuRefreshDeps.syncShortcuts` in `../menu-refresh-apply`. */
	syncShortcuts?: () => void;
}

/**
 * Wire the live menu-refresh pipeline.
 *
 * @return An async function plugins can call to force a refresh.
 */
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
		syncServerUnfocusEffects,
		syncServerWindowLinkRenderers,
		syncServerDockRailRenderers,
		syncServerGames,
		syncServerDesktopThemes,
		renderIcons,
		syncShortcuts,
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
		syncServerUnfocusEffects,
		syncServerWindowLinkRenderers,
		syncServerDockRailRenderers,
		syncServerGames,
		syncServerDesktopThemes,
		renderIcons,
		syncShortcuts,
	} );

	// Fingerprint of the admin menu the dock currently reflects. Seeded
	// from the boot config so the first off-allowlist menu change (vs.
	// boot state) is detected without a wasted probe, and thereafter
	// updated only when a full payload is applied (it carries its own
	// `menuSig`). Signature messages are compared against it but never
	// mutate it — see the handler below.
	let lastMenuSig: string =
		typeof config.menuSig === 'string' ? config.menuSig : '';
	// Guard so a burst of signature messages (rapid window navigation)
	// can't spawn overlapping refresh probes for the same change.
	let sigRefreshInFlight = false;

	// `os-updates-changed` scheduling state. The chromeless
	// bridge nudges after Core's shiny (AJAX) plugin/theme updates and
	// deletes complete (GH#296); the nudge carries no payload, so the
	// shell answers with one refresh probe. Debounce collapses a burst
	// (several windows watching the same run), and the in-flight flag +
	// queued bit guarantee a nudge that lands mid-probe still gets a
	// fresh probe afterwards — that probe's counts would predate the
	// change that triggered the nudge.
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
				url.searchParams.set( 'open_station_chromeless', '1' );
				url.searchParams.set( 'open_station_menu_refresh', '1' );
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
			// Off-screen + zero-cost: pulled out of the layout flow
			// entirely so it can't shift content, and styled small
			// enough that any momentary paint is invisible.
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
				// The shell-wide `message` listener applies the payload
				// (and adopts its signature). Here we just need to know
				// the probe completed so we can dispose the iframe.
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
				serverUnfocusEffectScripts?: unknown;
				serverWindowLinkRendererScripts?: unknown;
				serverGames?: unknown;
				serverDesktopThemes?: unknown;
				desktopIcons?: unknown;
				menuSig?: unknown;
			};
		} | null;
		if ( ! data ) {
			return;
		}

		if ( data.type === 'os-plugins-changed' ) {
			// The chromeless bridge always embeds a fresh menu payload
			// captured from real admin context — plugins that gate
			// `admin_menu` on `is_admin()` at load time registered
			// normally there. Messages without a payload are stale /
			// out-of-spec and ignored.
			if ( data.payload ) {
				applyPayload( data.payload );
				// The payload carries the authoritative signature for the
				// state we just applied — adopt it so a later signature
				// message for the same menu doesn't trigger a redundant
				// refresh.
				if ( typeof data.payload.menuSig === 'string' ) {
					lastMenuSig = data.payload.menuSig;
				}
			}
			return;
		}

		if ( data.type === 'os-updates-changed' ) {
			// A chromeless page reports that Core's shiny updater just
			// finished a plugin/theme update or delete run. The update
			// transient changed server-side without any navigation, so
			// no full payload is coming on its own — spend one probe to
			// pull fresh badge + admin-bar counts. GH#296.
			scheduleUpdatesRefresh();
			return;
		}

		if ( data.type === 'os-menu-signature' ) {
			// A chromeless page off the full-payload allowlist reported
			// its menu fingerprint. If it differs from the state the dock
			// currently reflects, the admin menu changed somewhere we
			// don't otherwise watch (a CPT registered via a settings tool,
			// a plugin that adds a menu on save) — spend one refresh probe
			// to reconcile. GH#325.
			//
			// `lastMenuSig` is deliberately NOT updated here: it tracks the
			// state the dock actually reflects, so it moves only when a
			// payload is applied (the branch above, or the probe's own
			// payload). The in-flight guard collapses a burst of reports
			// into a single probe; leaving `lastMenuSig` untouched means a
			// probe that times out is retried on the next navigation
			// rather than silently swallowed.
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
