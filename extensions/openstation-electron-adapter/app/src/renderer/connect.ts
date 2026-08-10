/**
 * OpenStation Desktop — connect-screen renderer.
 *
 * Talks to the main process through `window.openStationConnect` only
 * (see `preload/connect.ts`). No network access of its own — the CSP in
 * `connect.html` denies it, and the main process is what actually loads
 * the site.
 */

import type { ConnectResult, ConnectState } from '../preload/connect';

declare global {
	interface Window {
		openStationConnect: {
			getState(): Promise< ConnectState >;
			connect( siteUrl: string ): Promise< ConnectResult >;
		};
	}
}

const form = document.getElementById( 'connect-form' ) as HTMLFormElement;
const input = document.getElementById( 'site' ) as HTMLInputElement;
const submit = document.getElementById( 'submit' ) as HTMLButtonElement;
const error = document.getElementById( 'error' ) as HTMLElement;

/**
 * @param message Text to show, or '' to clear.
 */
function showError( message: string ): void {
	error.textContent = message;
	error.setAttribute( 'data-visible', message ? '1' : '0' );
}

void ( async () => {
	const state = await window.openStationConnect.getState();
	if ( state.siteUrl ) {
		input.value = state.siteUrl;
	}
	const version = document.getElementById( 'version' );
	const platform = document.getElementById( 'platform' );
	if ( version ) {
		version.textContent = `OpenStation Desktop ${ state.appVersion }`;
	}
	if ( platform ) {
		platform.textContent = state.osLabel;
	}
	input.focus();
	input.select();
} )();

form.addEventListener( 'submit', async ( event ) => {
	event.preventDefault();
	showError( '' );

	const value = input.value.trim();
	if ( ! value ) {
		showError( 'Enter the address of your WordPress site.' );
		input.focus();
		return;
	}

	submit.disabled = true;
	submit.textContent = 'Connecting…';
	try {
		const result = await window.openStationConnect.connect( value );
		if ( ! result.ok ) {
			showError( result.error || 'Could not connect to that address.' );
		}
		// On success the main process opens the shell window and closes
		// this one; there is nothing left to do here.
	} catch ( err ) {
		showError( err instanceof Error ? err.message : String( err ) );
	} finally {
		submit.disabled = false;
		submit.textContent = 'Connect';
	}
} );
