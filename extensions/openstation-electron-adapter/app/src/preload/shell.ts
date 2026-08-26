/**
 * OpenStation Desktop — preload for the OpenStation shell window.
 *
 * Injects exactly one global into the page: `window.openStationDesktopHost`.
 * That global IS the capability probe — the adapter's shell bundle
 * tests for it and stays entirely dormant when it is absent, which is
 * what keeps the browser experience unchanged.
 *
 * Everything is exposed through `contextBridge` with `contextIsolation`
 * on, so the page gets functions and plain data and never a live
 * reference to `ipcRenderer`. A compromised admin page can ask the host
 * to open a window; it cannot ask Node to do anything.
 *
 * The URL a freed window loads is chosen by the *shell*, not here — the
 * shell knows whether a window is an iframe (chromeless admin URL) or
 * native (solo-mode shell URL). This file does not interpret it beyond
 * requiring http(s), and the main process checks it again against the
 * connected site.
 */

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, HOST_PROTOCOL_VERSION, osLabelFor } from '../lib/protocol';
import type {
	ConnectionState,
	FreeWindowRequest,
	FreeWindowResult,
	HandshakeArgs,
	HostInfo,
} from '../lib/protocol';

/**
 * Wrap an `ipcRenderer.on` subscription so callers get an unsubscribe
 * function instead of having to hand the same listener reference back.
 *
 * @param channel  Channel to listen on.
 * @param callback Called with the payload.
 * @return Unsubscribe.
 */
function subscribe< T >(
	channel: string,
	callback: ( payload: T ) => void,
): () => void {
	const listener = ( _event: unknown, payload: T ) => {
		try {
			callback( payload );
		} catch ( err ) {
			console.error( `[openstation-desktop] listener for ${ channel } threw:`, err );
		}
	};
	ipcRenderer.on( channel, listener );
	return () => {
		ipcRenderer.removeListener( channel, listener );
	};
}

contextBridge.exposeInMainWorld( 'openStationDesktopHost', {
	/** Presence of the object is the probe; this is the assertion. */
	isDesktopHost: true,

	/** Protocol the shell negotiates against. */
	protocol: HOST_PROTOCOL_VERSION,

	/** 'darwin' | 'win32' | 'linux' | … */
	platform: process.platform,

	/** "Mac" / "Windows PC" / "Linux desktop" — the menu label's tail. */
	osLabel: osLabelFor( process.platform ),

	/**
	 * Full host description, including the ids of windows already
	 * freed — which matters after a shell reload, because native
	 * windows outlive the page that created them.
	 *
	 * @return Host info.
	 */
	getInfo: (): Promise< HostInfo > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_HOST_INFO ),

	/**
	 * Set a window free onto the real desktop.
	 *
	 * @param req Request.
	 * @return Result.
	 */
	freeWindow: ( req: FreeWindowRequest ): Promise< FreeWindowResult > => {
		const url = String( req?.url || '' );
		if ( ! /^https?:\/\//i.test( url ) ) {
			return Promise.resolve( {
				ok: false,
				windowId: String( req?.windowId || '' ),
				reused: false,
				error: 'url must be http(s)',
			} );
		}
		return ipcRenderer.invoke( CHANNELS.INVOKE_FREE_WINDOW, {
			windowId: String( req?.windowId || '' ),
			url,
			title: String( req?.title || '' ),
			width: Number( req?.width || 0 ) || undefined,
			height: Number( req?.height || 0 ) || undefined,
			native: !! req?.native,
		} );
	},

	/**
	 * Bring a freed window back into the shell by closing its native
	 * window. The shell also learns about user-initiated closes through
	 * `onWindowDocked`, so both directions land on one code path.
	 *
	 * @param windowId OpenStation window id.
	 * @return Result.
	 */
	dockWindow: ( windowId: string ): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_DOCK_WINDOW, {
			windowId: String( windowId || '' ),
		} ),

	/**
	 * @param windowId OpenStation window id.
	 * @return Result.
	 */
	focusWindow: ( windowId: string ): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_FOCUS_WINDOW, {
			windowId: String( windowId || '' ),
		} ),

	/** @return Currently freed window ids. */
	listFreedWindows: (): Promise< { windowIds: string[] } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_LIST_WINDOWS ),

	/**
	 * Hand the host the REST root and nonce so it can introduce itself
	 * to the site and start its liveness heartbeat. Called on boot and
	 * again whenever the shell refreshes its nonce.
	 *
	 * @param args REST coordinates.
	 * @return Connection state.
	 */
	handshake: ( args: HandshakeArgs ): Promise< ConnectionState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_HANDSHAKE, {
			restUrl: String( args?.restUrl || '' ),
			nonce: String( args?.nonce || '' ),
			siteUrl: String( args?.siteUrl || '' ),
		} ),

	/** @return Last known connection state. */
	getConnection: (): Promise< ConnectionState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECTION ),

	/** Forget the site and return to the connect screen. @return Result. */
	disconnect: (): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_DISCONNECT ),

	/**
	 * @param cb Called when a freed window closes.
	 * @return Unsubscribe.
	 */
	onWindowDocked: ( cb: ( payload: { windowId: string } ) => void ) =>
		subscribe( CHANNELS.EVENT_WINDOW_DOCKED, cb ),

	/**
	 * @param cb Called once a freed window paints.
	 * @return Unsubscribe.
	 */
	onWindowFreed: ( cb: ( payload: { windowId: string } ) => void ) =>
		subscribe( CHANNELS.EVENT_WINDOW_FREED, cb ),

	/**
	 * @param cb Called on every connection transition.
	 * @return Unsubscribe.
	 */
	onConnectionChange: ( cb: ( state: ConnectionState ) => void ) =>
		subscribe( CHANNELS.EVENT_CONNECTION, cb ),
} );
