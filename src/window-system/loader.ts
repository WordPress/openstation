import type { WindowSystemApi } from './types';

let inflight: Promise< void > | null = null;

function isLoaded(): boolean {
	return !! window.openStationWindowSystem;
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-window-system="1"]',
		);
		const finish = (): void => {
			if ( isLoaded() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] window-system bundle loaded but did not register `window.openStationWindowSystem`.',
				),
			);
		};
		if ( existing ) {
			if ( isLoaded() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load window-system bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osWindowSystem = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load window-system bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

export function windowSystemBundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { windowSystemBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.windowSystemBundleUrl ?? '';
}

export function preloadWindowSystem( scriptUrl: string ): void {
	if ( ! scriptUrl || isLoaded() || inflight ) {
		return;
	}
	inflight = injectScript( scriptUrl ).catch( ( err ) => {
		inflight = null;
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] window-system preload failed; will retry on first open():',
				err,
			);
		}
	} );
}

export async function ensureWindowSystemLoaded(
	scriptUrl: string,
): Promise< WindowSystemApi > {
	if ( isLoaded() ) {
		return window.openStationWindowSystem as WindowSystemApi;
	}
	if ( ! scriptUrl ) {
		const fn = window.openStationWindowSystem;
		if ( fn ) {
			return fn;
		}
		throw new Error(
			'[openstation] ensureWindowSystemLoaded(): no bundle URL configured and `window.openStationWindowSystem` is not pre-registered.',
		);
	}
	if ( ! inflight ) {
		inflight = injectScript( scriptUrl );
	}
	await inflight;
	return window.openStationWindowSystem as WindowSystemApi;
}
