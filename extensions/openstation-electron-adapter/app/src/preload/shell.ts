import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, HOST_PROTOCOL_VERSION, osLabelFor } from '../lib/protocol';
import type {
	ConnectionState,
	FreeWindowRequest,
	FreeWindowResult,
	HandshakeArgs,
	HostInfo,
} from '../lib/protocol';

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

	isDesktopHost: true,

	protocol: HOST_PROTOCOL_VERSION,

	platform: process.platform,

	osLabel: osLabelFor( process.platform ),

	getInfo: (): Promise< HostInfo > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_HOST_INFO ),

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

	dockWindow: ( windowId: string ): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_DOCK_WINDOW, {
			windowId: String( windowId || '' ),
		} ),

	focusWindow: ( windowId: string ): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_FOCUS_WINDOW, {
			windowId: String( windowId || '' ),
		} ),

	listFreedWindows: (): Promise< { windowIds: string[] } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_LIST_WINDOWS ),

	handshake: ( args: HandshakeArgs ): Promise< ConnectionState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_HANDSHAKE, {
			restUrl: String( args?.restUrl || '' ),
			nonce: String( args?.nonce || '' ),
			siteUrl: String( args?.siteUrl || '' ),
		} ),

	getConnection: (): Promise< ConnectionState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECTION ),

	disconnect: (): Promise< { ok: boolean } > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_DISCONNECT ),

	onWindowDocked: ( cb: ( payload: { windowId: string } ) => void ) =>
		subscribe( CHANNELS.EVENT_WINDOW_DOCKED, cb ),

	onWindowFreed: ( cb: ( payload: { windowId: string } ) => void ) =>
		subscribe( CHANNELS.EVENT_WINDOW_FREED, cb ),

	onConnectionChange: ( cb: ( state: ConnectionState ) => void ) =>
		subscribe( CHANNELS.EVENT_CONNECTION, cb ),
} );
