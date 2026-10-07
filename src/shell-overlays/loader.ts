declare global {

	interface Window {

		openStationShellOverlays?: boolean;
	}
}

let inflight: Promise< void > | null = null;

function isLoaded(): boolean {
	return !! window.openStationShellOverlays;
}

function injectScript( scriptUrl: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const existing = document.querySelector< HTMLScriptElement >(
			'script[data-os-shell-overlays="1"]',
		);
		const finish = (): void => {
			if ( isLoaded() ) {
				resolve();
				return;
			}
			reject(
				new Error(
					'[openstation] shell-overlays bundle loaded but did not set `window.openStationShellOverlays`.',
				),
			);
		};
		if ( existing ) {
			if ( isLoaded() ) {
				finish();
			} else {
				existing.addEventListener( 'load', finish );
				existing.addEventListener( 'error', () =>
					reject( new Error( 'failed to load shell-overlays bundle' ) ),
				);
			}
			return;
		}
		const s = document.createElement( 'script' );
		s.src = scriptUrl;
		s.async = true;
		s.dataset.osShellOverlays = '1';
		s.addEventListener( 'load', finish );
		s.addEventListener( 'error', () =>
			reject( new Error( 'failed to load shell-overlays bundle' ) ),
		);
		document.head.appendChild( s );
	} );
}

export function preloadShellOverlays( scriptUrl: string ): void {
	if ( ! scriptUrl || isLoaded() || inflight ) {
		return;
	}
	inflight = injectScript( scriptUrl ).catch( ( err ) => {
		inflight = null;
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] shell-overlays preload failed; will retry on first overlay use:',
				err,
			);
		}
	} );
}

export function ensureShellOverlaysLoaded(
	scriptUrl: string,
): Promise< void > {
	if ( isLoaded() ) {
		return Promise.resolve();
	}
	if ( ! scriptUrl ) {
		return Promise.resolve();
	}
	if ( ! inflight ) {
		inflight = injectScript( scriptUrl );
	}
	return inflight;
}

export function shellOverlaysBundleUrl(): string {
	const cfg = ( window as unknown as {
		openStationConfig?: { shellOverlaysBundleUrl?: string };
	} ).openStationConfig;
	return cfg?.shellOverlaysBundleUrl ?? '';
}

export function openWithShellOverlays(
	isStillCurrent: () => boolean,
	fn: () => void,
): void {
	const url = shellOverlaysBundleUrl();
	if ( isLoaded() || ! url ) {
		fn();
		return;
	}
	void ensureShellOverlaysLoaded( url )
		.then( () => {
			if ( ! isStillCurrent() ) {
				return;
			}
			fn();
		} )
		.catch( ( err ) => {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] shell-overlays failed to load; menu/dialog suppressed:',
					err,
				);
			}
		} );
}
