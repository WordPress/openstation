import type { PwaConfig, PwaUserState } from '../types';

let _config: PwaConfig | null = null;
let _state: PwaUserState = {
	installHintDismissed: false,
	notificationsEnabled: false,
};
const _listeners = new Set<( s: PwaUserState ) => void >();

export function initPwaState( config: PwaConfig | undefined ): void {
	if ( ! config ) {
		_config = null;
		return;
	}
	_config = config;
	_state = { ...config.state };
	notify();
}

export function getPwaState(): PwaUserState {
	return { ..._state };
}

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
		if ( typeof console !== 'undefined' ) {
			console.warn( '[openstation] pwa-state write failed:', err );
		}
	} );

	return getPwaState();
}

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
					'[openstation] pwa-state listener threw:',
					err,
				);
			}
		}
	}
}

function readRestNonce(): string {
	const cfg = ( window as unknown as { openStationConfig?: { restNonce?: string } } )
		.openStationConfig;
	return cfg?.restNonce ?? '';
}
