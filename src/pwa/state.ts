/**
 * Desktop Mode — PWA user-state client.
 *
 * Thin wrapper over `POST /desktop-mode/v1/pwa-state` so the install
 * pill and the notifications module can persist user-level prefs
 * (install-hint dismissed, notifications enabled) without each
 * touching `fetch` directly. Reads come straight from the boot
 * payload (`config.pwa.state`) — there's no need to hit the network
 * just to know whether the user has already dismissed the hint.
 *
 * Writes are fire-and-forget: the caller updates the local snapshot
 * synchronously and the server round-trip happens in the background.
 * If the round-trip fails (network, capability change, server
 * outage), the next page load re-reads from the server and the local
 * state self-corrects. We intentionally do NOT block the UI on the
 * write — losing a dismissal flag for a single page is far better
 * than introducing a "saving…" spinner on a one-line preference.
 *
 * @since 0.8.0
 */

import type { PwaConfig, PwaUserState } from '../types';

let _config: PwaConfig | null = null;
let _state: PwaUserState = {
	installHintDismissed: false,
	notificationsEnabled: false,
};
const _listeners = new Set<( s: PwaUserState ) => void >();

/**
 * Initialize the client with the boot config. Called exactly once
 * from the PWA bootstrap; subsequent calls overwrite the config and
 * re-broadcast the state (used in tests).
 */
export function initPwaState( config: PwaConfig | undefined ): void {
	if ( ! config ) {
		_config = null;
		return;
	}
	_config = config;
	_state = { ...config.state };
	notify();
}

/** Return a snapshot of the current per-user state. */
export function getPwaState(): PwaUserState {
	return { ..._state };
}

/**
 * Apply a partial update locally and POST it to the server. Returns
 * the new state synchronously (the server response is ignored on
 * happy paths — we already know the merged shape).
 */
export function updatePwaState( patch: Partial< PwaUserState > ): PwaUserState {
	_state = { ..._state, ...patch };
	notify();

	if ( ! _config ) {
		return getPwaState();
	}

	const body = JSON.stringify( patch );
	const nonce = readRestNonce();

	void fetch( _config.stateUrl, {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/json',
			...( nonce ? { 'X-WP-Nonce': nonce } : {} ),
		},
		body,
	} ).catch( ( err: unknown ) => {
		// Surface to the console only — a failed write doesn't
		// warrant a toast (the pref is still applied locally; next
		// page load will re-read).
		if ( typeof console !== 'undefined' ) {
			console.warn( '[desktop-mode] pwa-state write failed:', err );
		}
	} );

	return getPwaState();
}

/** Subscribe to state changes. Returns an unsubscribe callback. */
export function subscribePwaState(
	cb: ( s: PwaUserState ) => void,
): () => void {
	_listeners.add( cb );
	return () => {
		_listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = getPwaState();
	for ( const cb of Array.from( _listeners ) ) {
		try {
			cb( snapshot );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] pwa-state listener threw:',
					err,
				);
			}
		}
	}
}

function readRestNonce(): string {
	const cfg = ( window as unknown as { desktopModeConfig?: { restNonce?: string } } )
		.desktopModeConfig;
	return cfg?.restNonce ?? '';
}
