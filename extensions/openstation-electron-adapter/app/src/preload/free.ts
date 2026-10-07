import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, osLabelFor } from '../lib/protocol';

let windowId = '';

const waiting: Array< ( id: string ) => void > = [];

ipcRenderer.on(
	CHANNELS.EVENT_FRAME_INIT,
	( _event, payload: { windowId?: string } ) => {
		windowId = String( payload?.windowId || '' );
		while ( waiting.length ) {
			const cb = waiting.shift();
			try {
				cb?.( windowId );
			} catch ( err ) {
				console.error( '[openstation-desktop] frame-init listener threw:', err );
			}
		}
	},
);

contextBridge.exposeInMainWorld( 'openStationChromelessHost', true );

contextBridge.exposeInMainWorld( 'openStationDesktopFrame', {

	isFreedWindow: true,

	platform: process.platform,

	osLabel: osLabelFor( process.platform ),

	getWindowId: (): string => windowId,

	onReady: ( cb: ( id: string ) => void ): void => {
		if ( windowId ) {
			cb( windowId );
			return;
		}
		waiting.push( cb );
	},

	openWindow: ( req: {
		windowId: string;
		url: string;
		title?: string;
		width?: number;
		height?: number;
		native?: boolean;
	} ): Promise< { ok: boolean; error?: string } > => {
		const url = String( req?.url || '' );
		if ( ! /^https?:\/\//i.test( url ) ) {
			return Promise.resolve( { ok: false, error: 'url must be http(s)' } );
		}
		return ipcRenderer.invoke( CHANNELS.INVOKE_OPEN_WINDOW, {
			windowId: String( req?.windowId || '' ),
			url,
			title: String( req?.title || '' ),
			width: Number( req?.width || 0 ) || undefined,
			height: Number( req?.height || 0 ) || undefined,
			native: !! req?.native,
		} );
	},
} );
