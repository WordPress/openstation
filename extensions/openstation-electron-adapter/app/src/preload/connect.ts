/**
 * OpenStation Desktop — preload for the first-run connect screen.
 *
 * Deliberately tiny, and deliberately not reachable from the WordPress
 * page: this is the only surface that can point the app at a different
 * site, so it lives on its own window with its own preload. See the
 * `connectWindow` docblock in `main.ts`.
 */

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS } from '../lib/protocol';

export interface ConnectState {
	siteUrl: string;
	appVersion: string;
	osLabel: string;
}

export interface ConnectResult {
	ok: boolean;
	siteUrl?: string;
	error?: string;
}

contextBridge.exposeInMainWorld( 'openStationConnect', {
	/** @return Current config. */
	getState: (): Promise< ConnectState > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECT_STATE ),

	/**
	 * @param siteUrl Whatever the user typed.
	 * @return Result.
	 */
	connect: ( siteUrl: string ): Promise< ConnectResult > =>
		ipcRenderer.invoke( CHANNELS.INVOKE_CONNECT_SITE, {
			siteUrl: String( siteUrl || '' ),
		} ),
} );
