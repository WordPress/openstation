/**
 * `wp.desktop.startOAuth( service )` — client-side companion to the
 * PHP `desktop_mode_register_oauth_relay()` API.
 *
 * Coordinates the popup + state-nonce + postMessage dance so plugin
 * authors don't write that code per integration. Returns a Promise
 * that resolves when the popup completes the round-trip OR rejects
 * with a tagged error. Behaviour:
 *
 *   1. POST `/desktop-mode/v1/oauth/start` with `{ service }` to get
 *      the assembled authorize URL (server-side `state` already baked
 *      in).
 *   2. Open the authorize URL in a named popup
 *      (`desktop-mode-oauth-<service>`) via `window.open()` with
 *      explicit size/position features. The opener relationship is
 *      kept intentionally — the popup needs it for the postMessage
 *      handshake.
 *   3. Listen for `'message'` events of `type:
 *      'desktop-mode-oauth-callback'` from the popup, validate origin.
 *   4. If `payload.ok`, resolve with the payload. Otherwise reject
 *      with a tagged Error whose `cause` is the payload.
 *
 * The listener detaches automatically on resolve / reject — including
 * the popup-closed-without-callback rejection. Concurrent
 * `startOAuth()` flows are NOT isolated: the listener matches on
 * origin + message type only (it does not compare `payload.service`
 * or the source popup), so the first callback to arrive settles every
 * in-flight promise. Run one flow at a time.
 *
 * @since 0.8.2
 */

import { joinRestUrl } from './rest-url';
import { trackedFetch } from './tracked-fetch';

export interface StartOAuthOptions {
	/**
	 * Width / height for the popup window. The framework picks
	 * sensible defaults (`520x720`) — override only when the
	 * service's authorize page demands something specific.
	 */
	width?: number;
	height?: number;
}

export interface OAuthCallbackPayload {
	ok: boolean;
	service?: string;
	reason?: string;
	message?: string;
}

interface StartResponse {
	authorize_url: string;
	state: string;
}

const POPUP_DEFAULT_WIDTH = 520;
const POPUP_DEFAULT_HEIGHT = 720;
/** Polling interval to detect a user-closed popup that never posted. */
const POPUP_CLOSE_POLL_MS = 500;

/**
 * Open an OAuth popup for `service`. Resolves with the success
 * payload (`{ ok: true, service }`) on a clean round-trip, rejects
 * on any failure path.
 *
 * @public
 * @since 0.8.2
 */
export function startOAuth(
	service: string,
	options: StartOAuthOptions = {},
): Promise< OAuthCallbackPayload > {
	if ( typeof service !== 'string' || service === '' ) {
		return Promise.reject(
			new Error( '[desktop-mode] startOAuth requires a non-empty service slug.' ),
		);
	}

	const restRoot = readRestRoot();
	const restNonce = readRestNonce();

	return trackedFetch(
		joinRestUrl( restRoot, 'desktop-mode/v1/oauth/start' ),
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': restNonce ?? '',
			},
			body: JSON.stringify( { service } ),
		},
		{ source: 'desktop-mode/oauth-start' },
	)
		.then( async ( res ) => {
			if ( ! res.ok ) {
				const text = await res.text().catch( () => '' );
				throw new Error(
					`[desktop-mode] OAuth start failed (${ res.status }): ${ text }`,
				);
			}
			return ( await res.json() ) as StartResponse;
		} )
		.then( ( startBody ) => openPopupAndWait( startBody, service, options ) );
}

function openPopupAndWait(
	body: StartResponse,
	service: string,
	options: StartOAuthOptions,
): Promise< OAuthCallbackPayload > {
	return new Promise< OAuthCallbackPayload >( ( resolve, reject ) => {
		const width = options.width ?? POPUP_DEFAULT_WIDTH;
		const height = options.height ?? POPUP_DEFAULT_HEIGHT;
		const left = Math.max( 0, Math.floor( ( window.screen.width - width ) / 2 ) );
		const top = Math.max( 0, Math.floor( ( window.screen.height - height ) / 2 ) );

		const features = [
			`width=${ width }`,
			`height=${ height }`,
			`left=${ left }`,
			`top=${ top }`,
			'menubar=no',
			'toolbar=no',
			'location=yes',
			'status=no',
			'resizable=yes',
			'scrollbars=yes',
		].join( ',' );

		const popup = window.open(
			body.authorize_url,
			`desktop-mode-oauth-${ service }`,
			features,
		);
		if ( ! popup ) {
			reject(
				new Error(
					'[desktop-mode] OAuth popup blocked. Tell users to allow popups for this site.',
				),
			);
			return;
		}

		const expectedOrigin = window.location.origin;
		let pollTimer: number | null = null;
		let detached = false;

		const cleanup = (): void => {
			if ( detached ) {
				return;
			}
			detached = true;
			window.removeEventListener( 'message', onMessage );
			if ( pollTimer !== null ) {
				window.clearInterval( pollTimer );
				pollTimer = null;
			}
		};

		const onMessage = ( e: MessageEvent ): void => {
			if ( e.origin !== expectedOrigin ) {
				return;
			}
			const data = e.data as
				| {
					type?: string;
					payload?: OAuthCallbackPayload;
				}
				| undefined;
			if ( ! data || data.type !== 'desktop-mode-oauth-callback' ) {
				return;
			}
			const payload = data.payload;
			cleanup();
			if ( payload && payload.ok ) {
				resolve( payload );
			} else {
				const reason = payload?.reason ?? 'unknown';
				const message = payload?.message ?? 'OAuth flow failed';
				const err = new Error(
					`[desktop-mode] startOAuth(${ service }) failed: ${ reason } — ${ message }`,
				);
				( err as Error & { cause?: unknown } ).cause = payload;
				reject( err );
			}
		};

		window.addEventListener( 'message', onMessage );

		// Detect a popup the user closed without completing the flow —
		// no `'beforeunload'` cross-origin signal, so polling is the
		// only reliable mechanism.
		pollTimer = window.setInterval( () => {
			if ( popup.closed ) {
				cleanup();
				reject(
					new Error(
						`[desktop-mode] startOAuth(${ service }) cancelled — popup closed before completing.`,
					),
				);
			}
		}, POPUP_CLOSE_POLL_MS );
	} );
}

interface ConfigShape {
	restRoot?: string;
	restNonce?: string;
}

function readDesktopConfig(): ConfigShape {
	return (
		( window as unknown as { desktopModeConfig?: ConfigShape } )
			.desktopModeConfig ?? {}
	);
}

function readRestRoot(): string {
	const root = readDesktopConfig().restRoot;
	if ( typeof root === 'string' && root !== '' ) {
		return root;
	}
	// Fallback: derive from the current origin. Plugins activated
	// before the shell config lands still get a working start path.
	return `${ window.location.origin }/wp-json/`;
}

function readRestNonce(): string | null {
	const nonce = readDesktopConfig().restNonce;
	return typeof nonce === 'string' && nonce !== '' ? nonce : null;
}
