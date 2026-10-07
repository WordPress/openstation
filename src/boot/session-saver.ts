import { HOOKS, doAction } from '../hooks';
import { trackedFetch } from './tracked-fetch';
import { rememberRestoreTargets } from '../pwa/speculate';
import { withChromelessParam } from '../window/dom';
import type { WindowManager } from '../window-manager';
import type { DesktopConfig, Session } from '../types';

const SESSION_SAVE_DEBOUNCE_MS = 500;

const SESSION_SAVE_MIN_INTERVAL_MS = 1500;

function fingerprint( payload: Session ): string {
	const { updated, ...rest } = payload;
	void updated;
	return JSON.stringify( rest );
}

function noteRestoreTargets( payload: Session ): void {
	try {
		const os = (
			window as unknown as {
				wp?: {
					os?: {
						getOsSettings?: () => { windowPrewarmEnabled?: boolean };
					};
				};
			}
		).wp?.os;
		if ( ! os?.getOsSettings?.().windowPrewarmEnabled ) {
			return;
		}
		rememberRestoreTargets(
			payload.windows
				.filter( ( w ) => ! w.native && w.url )
				.map( ( w ) => withChromelessParam( w.url ) || '' )
				.filter( Boolean ),
		);
	} catch {

	}
}

export type SessionSaver = ( () => void ) & {
	flush: () => Promise< void >;
};

export function createSessionSaver(
	manager: WindowManager,
	config: DesktopConfig,
): SessionSaver {
	let debounceTimer: number | null = null;
	let inFlight = false;
	let dirty = false;

	let activeSave: Promise< void > | null = null;

	let lastSaveStartedAt = 0;

	let lastAccepted: string | null = null;

	const doSave = (): Promise< void > => {
		if ( inFlight ) {
			dirty = true;
			return Promise.resolve();
		}

		const payload = manager.snapshot();
		const current = fingerprint( payload );
		if ( current === lastAccepted ) {
			return Promise.resolve();
		}
		inFlight = true;
		lastSaveStartedAt = Date.now();

		noteRestoreTargets( payload );

		activeSave = ( async () => {
			try {
				const response = await trackedFetch(
					manager,
					config.sessionUrl,
					{
						method: 'POST',
						credentials: 'same-origin',
						headers: {
							'Content-Type': 'application/json',
							'X-WP-Nonce': config.restNonce,
						},
						body: JSON.stringify( { session: payload } ),

						keepalive: true,
					},
					{ silent: true },
				);

				if ( response?.ok ) {
					lastAccepted = current;
				}
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, { scope: 'session-save', error: err } );
			}
		} )().finally( () => {
			inFlight = false;
			activeSave = null;
			if ( dirty ) {
				dirty = false;

				schedule();
			}
		} );
		return activeSave;
	};

	const flush = async (): Promise< void > => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}
		while ( activeSave ) {
			await activeSave;
		}
		dirty = false;
		await doSave();
	};

	const flushImmediately = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
			debounceTimer = null;
		}

		dirty = false;

		const payload = manager.snapshot();
		const current = fingerprint( payload );
		if ( current === lastAccepted ) {
			return;
		}

		noteRestoreTargets( payload );
		const body = new Blob(
			[ JSON.stringify( { session: payload } ) ],
			{ type: 'application/json' },
		);
		const beaconUrl =
			config.sessionUrl +
			( config.sessionUrl.includes( '?' ) ? '&' : '?' ) +
			'_wpnonce=' +
			encodeURIComponent( config.restNonce );
		if (
			navigator.sendBeacon &&
			navigator.sendBeacon( beaconUrl, body )
		) {
			lastAccepted = current;
			return;
		}
		void doSave();
	};

	const schedule = (): void => {
		if ( debounceTimer !== null ) {
			clearTimeout( debounceTimer );
		}

		let wait = SESSION_SAVE_DEBOUNCE_MS;
		if ( lastSaveStartedAt !== 0 ) {
			const sinceLastSave = Date.now() - lastSaveStartedAt;
			wait = Math.max(
				wait,
				SESSION_SAVE_MIN_INTERVAL_MS - sinceLastSave,
			);
		}
		debounceTimer = window.setTimeout( () => {
			debounceTimer = null;
			void doSave();
		}, wait ) as unknown as number;
	};

	window.addEventListener( 'pagehide', flushImmediately );

	document.addEventListener( 'visibilitychange', () => {
		if ( document.visibilityState === 'hidden' ) {
			flushImmediately();
		}
	} );

	return Object.assign( schedule, { flush } );
}
