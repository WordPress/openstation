/**
 * OpenStation — speculative document requests.
 *
 * The shell's half of the hand-off described in `src/pwa/sw.ts`: ask
 * the service worker to fetch a window's document while the user is
 * still deciding, so the click that follows is answered from bytes
 * that already arrived.
 *
 * This is the one cost nothing else could reach. The shared asset
 * cache took the network out of a window's assets, but the document
 * itself carries nonces and per-request screen state, so it can never
 * be cached — and it is the majority of a window open (~2.1 s of a
 * ~3.8 s tab click on a live install). Fetching it early does not make
 * it cacheable; it makes the waiting happen before the click instead
 * of after it.
 *
 * Deliberately not "keep the tab alive": nothing rendered is retained.
 * No DOM, no live iframe, no memory beyond a response body the worker
 * drops after 30 seconds. The page is still built fresh — just early.
 */

/** Same shape the worker's message handler matches on. */
const SPECULATE_MESSAGE = 'os-speculate-doc';

/**
 * URLs asked for in this page's lifetime, so repeated hovers over the
 * same tab cost one request rather than one per pointer entry. The
 * worker de-duplicates too; this saves the postMessage.
 */
const asked = new Set< string >();

/**
 * Ask the service worker to fetch `url` ahead of a likely navigation.
 *
 * Silent no-op when there is no controlling worker (the feature is a
 * bonus, never a dependency), when the URL was already requested, or
 * when the URL is not same-origin.
 *
 * @param url Absolute or relative URL of the document to pre-fetch.
 */
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
	if ( asked.has( absolute ) ) {
		return;
	}
	asked.add( absolute );
	try {
		navigator.serviceWorker.controller.postMessage( {
			type: SPECULATE_MESSAGE,
			url: absolute,
		} );
	} catch {
		// A worker mid-update can reject a post; speculation is
		// best-effort and the click still works without it.
	}
}

/** Test seam — clears the per-page de-duplication set. */
export function _resetSpeculation(): void {
	asked.clear();
}

/** The worker persists this list and replays it on the next boot. */
const REMEMBER_MESSAGE = 'os-remember-session';

/**
 * Tell the worker which screens this session will restore, so it can
 * start fetching them on the *next* boot without waiting to be asked.
 *
 * This is the boot's serial problem, measured on a live install:
 *
 *     0ms ─── shell document requested
 *   3172ms ─── shell HTML arrives (the server spent 3.2s building it)
 *   3876ms ─── only now does a window document get requested
 *   6491ms ─── everything ready
 *
 * The window's document does not depend on a single byte of the
 * shell's, yet it cannot even be *asked for* until the shell's HTML has
 * arrived and its JavaScript has run and built an iframe. Two
 * independent server renders, run strictly one after the other.
 *
 * The shell cannot fix this from inside itself — by the time its code
 * is running, the 3.2 seconds are already spent. The worker can:
 * it is woken by the shell's own navigation, before any of that, and
 * it can start the window fetches right then. But it only knows what
 * to fetch if it was told last time, which is what this does.
 *
 * Sent on every session save, so the list tracks whatever the user
 * actually has open.
 *
 * @param urls Chromeless URLs of the windows to restore.
 */
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
			// Skip anything unparseable.
		}
	}
	try {
		navigator.serviceWorker.controller.postMessage( {
			type: REMEMBER_MESSAGE,
			urls: absolute,
		} );
	} catch {
		// Best-effort, exactly like the speculation itself.
	}
}
