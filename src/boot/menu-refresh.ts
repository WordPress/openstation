/**
 * Live menu-refresh pipeline.
 *
 * Listens for `desktop-mode-plugins-changed` postMessages and
 * forwards every payload they carry to the apply step. The
 * chromeless bridge in `render.php` always emits a payload from
 * real admin context — both for the implicit case (`plugins.php`
 * etc.) and for the explicit refresh probe
 * (`?desktop_mode_menu_refresh=1`) — so a single mechanism handles
 * every refresh.
 *
 * `bindMenuRefresh()` returns an async function plugins can call
 * to force a refresh. The implementation spawns a 1×1 hidden
 * iframe at `admin.php?desktop_mode_chromeless=1&desktop_mode_menu_refresh=1`,
 * waits for the bridge's payload message, then disposes the
 * iframe.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 *
 * @since 0.8.1
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
	DesktopWallpaperServerEntry,
	DesktopWidgetServerEntry,
	NativeWindowServerEntry,
} from '../types';

/**
 * Hard ceiling on how long `refreshMenu()` waits for its hidden
 * iframe to emit the `desktop-mode-plugins-changed` payload before
 * giving up. The probe is a normal admin page load, so the cap is
 * sized for a slow shared host on first request rather than the
 * happy path.
 */
const MENU_REFRESH_TIMEOUT_MS = 8000;

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
	syncServerDockRailRenderers: (
		scripts: DesktopDockRailRendererScriptServerEntry[],
	) => Promise< void >;
	renderIcons: ( icons: DesktopIconServerEntry[] | undefined ) => void;
	/** See `MenuRefreshDeps.syncShortcuts` in `../menu-refresh-apply`. */
	syncShortcuts?: () => void;
}

/**
 * Wire the live menu-refresh pipeline.
 *
 * @since 0.8.1 (extracted from desktop.ts; argument list collected
 *               into a single options object so future syncers
 *               don't grow the parameter list).
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
		syncServerDockRailRenderers,
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
		syncServerDockRailRenderers,
		renderIcons,
		syncShortcuts,
	} );

	// Last-known admin-menu fingerprint. Seeded from the boot config so
	// the first off-allowlist menu change (vs. boot state) is detected
	// without a wasted probe. Updated whenever a full payload lands (it
	// carries its own `menuSig`) or a lighter signature message arrives.
	let lastMenuSig: string =
		typeof config.menuSig === 'string' ? config.menuSig : '';
	// Guard so a burst of signature messages (rapid window navigation)
	// can't spawn overlapping refresh probes for the same change.
	let sigRefreshInFlight = false;

	const refresh = (): Promise< void > => {
		if ( ! config.adminUrl ) {
			return Promise.resolve();
		}
		const probeUrl = ( () => {
			try {
				const url = new URL( 'admin.php', config.adminUrl );
				url.searchParams.set( 'desktop_mode_chromeless', '1' );
				url.searchParams.set( 'desktop_mode_menu_refresh', '1' );
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
				if ( ! data || data.type !== 'desktop-mode-plugins-changed' ) {
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
				desktopIcons?: unknown;
				menuSig?: unknown;
			};
		} | null;
		if ( ! data ) {
			return;
		}

		if ( data.type === 'desktop-mode-plugins-changed' ) {
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

		if ( data.type === 'desktop-mode-menu-signature' ) {
			// A chromeless page off the full-payload allowlist reported
			// its menu fingerprint. If it differs from what we last knew,
			// the admin menu changed somewhere we don't otherwise watch
			// (a CPT registered via a settings tool, a plugin that adds a
			// menu on save) — spend one refresh probe to reconcile. GH#325.
			const sig = data.sig;
			if (
				typeof sig === 'string' &&
				sig !== '' &&
				sig !== lastMenuSig &&
				! sigRefreshInFlight
			) {
				// Adopt optimistically so repeat reports of the SAME new
				// signature don't each queue a probe; a genuinely newer
				// signature still gets through once this one settles.
				lastMenuSig = sig;
				sigRefreshInFlight = true;
				void refresh().finally( () => {
					sigRefreshInFlight = false;
				} );
			}
		}
	} );

	return refresh;
}
