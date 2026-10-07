import type { MobileApi } from './types';

let inflight: Promise< MobileApi > | null = null;

function loaded(): MobileApi | undefined {
	return window.openStationMobile;
}

function injectScript( scriptUrl: string ): Promise< MobileApi > {
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-mobile="1"]',
		);
		const finish = (): void => {
			const api = loaded();
			if ( api ) {
				resolve( api );
				return;
			}
			reject(
				new Error(
					'[openstation] mobile bundle loaded but did not set `window.openStationMobile`.',
				),
			);
		};
		const fail = (): void =>
			reject( new Error( 'failed to load the mobile bundle' ) );
		if ( existing ) {
			if ( loaded() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', fail );
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osMobile = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', fail );
		document.head.appendChild( s );
	} );
}

export function mobileBundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { mobileBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.mobileBundleUrl ?? '';
}

export function ensureMobileLoaded( scriptUrl: string ): Promise< MobileApi > {
	const api = loaded();
	if ( api ) {
		return Promise.resolve( api );
	}
	if ( ! scriptUrl ) {
		return Promise.reject(
			new Error(
				'[openstation] no `mobileBundleUrl` in the shell config — ' +
					'is `mobile[.min].js` built and the config key wired?',
			),
		);
	}
	if ( ! inflight ) {
		inflight = injectScript( scriptUrl ).catch( ( err ) => {
			inflight = null;
			throw err;
		} );
	}
	return inflight;
}
