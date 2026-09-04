/**
 * App Framework runtime — the hover-intent prewarm.
 *
 * A window's first `mount` is a WordPress request, and it starts on
 * the click. A sustained hover on the window's dock tile is a strong
 * predictor of that click, so the shell asks the runtime to send the
 * request early (`wp.os.apps.prewarm( id )`, reached through
 * `wp.os.prewarmWindow( id )`): the same body the session's own first
 * `mount` would send — the declared state, no params — held here for
 * a short while. When the window opens, its session takes the warmed
 * answer instead of fetching, and the rows are on screen a frame
 * after the frame is.
 *
 * Only a window's DEFAULT first mount is warmable: a deep link (a
 * window opened with params) derives its state on the server and
 * always fetches. A warmed answer that failed is dropped, so the open
 * falls back to a normal request; a stale one (older than the TTL)
 * is dropped too — the rows it holds may have moved on.
 *
 * @internal
 */

import type { AppConfig, DispatchResponse, RuntimeHost } from './types';

/** How long a warmed answer stays good for. */
export const PREWARM_TTL_MS = 30_000;

interface Warmed {
	promise: Promise< DispatchResponse | null >;
	at: number;
}

const warmed = new Map< string, Warmed >();

/**
 * Send an app's default first `mount` ahead of its open. `false` when a
 * fresh one is already held (in flight or answered) — a hover that
 * lingers never costs a second request.
 */
export function startPrewarm( config: AppConfig, hostFetch: RuntimeHost[ 'fetch' ] ): boolean {
	const held = warmed.get( config.id );
	if ( held && Date.now() - held.at < PREWARM_TTL_MS ) {
		return false;
	}
	const headers: Record< string, string > = {
		Accept: 'application/json',
		'Content-Type': 'application/json',
	};
	if ( config.restNonce ) {
		headers[ 'X-WP-Nonce' ] = config.restNonce;
	}
	// Silent: nothing the user did asked for this request, so it must
	// not read as activity on any window.
	const promise = hostFetch(
		config.endpoint,
		{
			method: 'POST',
			headers,
			body: JSON.stringify( {
				action: 'mount',
				view: 'main',
				state: { ...config.state },
				args: {},
				params: {},
				client: { width: 0, height: 0 },
			} ),
		},
		{ source: `openstation/app/${ config.id }/prewarm`, silent: true },
	)
		.then( async ( response ) => {
			if ( ! response.ok ) {
				return null;
			}
			const payload = ( await response.json() ) as DispatchResponse | null;
			return payload && payload.ok === true ? payload : null;
		} )
		.catch( () => null );
	warmed.set( config.id, { promise, at: Date.now() } );
	return true;
}

/**
 * Claim the warmed first `mount` of an app, if a fresh one is held.
 * One-shot: the answer is the opening window's, and the next open
 * warms anew.
 */
export function takePrewarm( id: string ): Promise< DispatchResponse | null > | undefined {
	const held = warmed.get( id );
	if ( ! held ) {
		return undefined;
	}
	warmed.delete( id );
	return Date.now() - held.at < PREWARM_TTL_MS ? held.promise : undefined;
}

/** Whether a fresh warmed answer is held for an app (in flight or answered). */
export function hasPrewarm( id: string ): boolean {
	const held = warmed.get( id );
	return !! held && Date.now() - held.at < PREWARM_TTL_MS;
}

/**
 * Test-only: forget every warmed answer.
 *
 * @internal
 */
export function __resetPrewarmForTests(): void {
	warmed.clear();
}
