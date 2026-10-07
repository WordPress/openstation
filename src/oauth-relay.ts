import { joinRestUrl } from './rest-url';
import { trackedFetch } from './tracked-fetch';
import { restErrorFromBody } from './core/api-client';

export interface StartOAuthOptions {

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

const POPUP_CLOSE_POLL_MS = 500;

export function startOAuth(
	service: string,
	options: StartOAuthOptions = {},
): Promise< OAuthCallbackPayload > {
	if ( typeof service !== 'string' || service === '' ) {
		return Promise.reject(
			new Error( '[openstation] startOAuth requires a non-empty service slug.' ),
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
				let body: unknown = null;
				try {
					body = JSON.parse( text );
				} catch {
					body = null;
				}
				throw restErrorFromBody(
					res.status,
					body,
					`[openstation] OAuth start failed (${ res.status }): ${ text }`,
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
			`os-oauth-${ service }`,
			features,
		);
		if ( ! popup ) {
			reject(
				new Error(
					'[openstation] OAuth popup blocked. Tell users to allow popups for this site.',
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
			if ( ! data || data.type !== 'os-oauth-callback' ) {
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
					`[openstation] startOAuth(${ service }) failed: ${ reason } — ${ message }`,
				);
				( err as Error & { cause?: unknown } ).cause = payload;
				reject( err );
			}
		};

		window.addEventListener( 'message', onMessage );

		pollTimer = window.setInterval( () => {
			if ( popup.closed ) {
				cleanup();
				reject(
					new Error(
						`[openstation] startOAuth(${ service }) cancelled — popup closed before completing.`,
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
		( window as unknown as { openStationConfig?: ConfigShape } )
			.openStationConfig ?? {}
	);
}

function readRestRoot(): string {
	const root = readDesktopConfig().restRoot;
	if ( typeof root === 'string' && root !== '' ) {
		return root;
	}

	return `${ window.location.origin }/wp-json/`;
}

function readRestNonce(): string | null {
	const nonce = readDesktopConfig().restNonce;
	return typeof nonce === 'string' && nonce !== '' ? nonce : null;
}
