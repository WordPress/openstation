const SPECULATE_MESSAGE = 'os-speculate-doc';

const lastAskedAt = new Map< string, number >();

const ASK_THROTTLE_MS = 1_000;

export function speculateDocument( url: string ): void {
	if (
		typeof navigator === 'undefined' ||
		! ( 'serviceWorker' in navigator ) ||
		! navigator.serviceWorker.controller
	) {
		return;
	}
	let absolute: string;
	try {
		const parsed = new URL( url, window.location.href );
		if ( parsed.origin !== window.location.origin ) {
			return;
		}
		absolute = parsed.toString();
	} catch {
		return;
	}
	const now = Date.now();
	const previous = lastAskedAt.get( absolute );
	if ( previous !== undefined && now - previous < ASK_THROTTLE_MS ) {
		return;
	}
	lastAskedAt.set( absolute, now );
	try {
		navigator.serviceWorker.controller.postMessage( {
			type: SPECULATE_MESSAGE,
			url: absolute,
		} );
	} catch {

	}
}

export function _resetSpeculation(): void {
	lastAskedAt.clear();
}

const REMEMBER_MESSAGE = 'os-remember-session';

export function rememberRestoreTargets( urls: string[] ): void {
	if (
		typeof navigator === 'undefined' ||
		! ( 'serviceWorker' in navigator ) ||
		! navigator.serviceWorker.controller
	) {
		return;
	}
	const absolute: string[] = [];
	for ( const url of urls ) {
		try {
			const parsed = new URL( url, window.location.href );
			if ( parsed.origin === window.location.origin ) {
				absolute.push( parsed.toString() );
			}
		} catch {

		}
	}
	try {
		navigator.serviceWorker.controller.postMessage( {
			type: REMEMBER_MESSAGE,
			urls: absolute,
		} );
	} catch {

	}
}
