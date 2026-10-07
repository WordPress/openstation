import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS } from '../lib/protocol';

export interface ConnectState {
	siteUrl: string;
	appVersion: string;
	osLabel: string;

	error?: string;
}

export interface ConnectResult {
	ok: boolean;
	siteUrl?: string;
	error?: string;
}

contextBridge.exposeInMainWorld( 'openStationConnect', {

	getState: (): Promise< ConnectState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECT_STATE ),

	connect: ( siteUrl: string ): Promise< ConnectResult > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECT_SITE, {
			siteUrl: String( siteUrl || '' ),
		} ),
} );
