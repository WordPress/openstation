/**
 * Browser fullscreen for the whole shell.
 *
 * The System tile's "Fullscreen" row is its front door. Lives here
 * rather than in `assets/js/admin-bar.js` so it is reachable with the
 * admin bar hidden, which is the default.
 *
 * Note this is BROWSER fullscreen (the whole document leaves the
 * browser chrome behind), not a window's focus mode, which is a
 * different thing the window manager owns under the same word.
 */

/** Is the document currently fullscreen? */
export function isFullscreen(): boolean {
	return document.fullscreenElement !== null;
}

/**
 * Toggle fullscreen on the document element.
 *
 * Both directions can reject — the request needs a user gesture, and
 * some environments (an iframe without `allow="fullscreen"`, a policy)
 * refuse outright. The promise is swallowed rather than surfaced: a
 * failed toggle leaves the user exactly where they were, which is a
 * complete outcome, and there is nothing they could do with the error.
 */
export function toggleFullscreen(): void {
	if ( isFullscreen() ) {
		void document.exitFullscreen?.().catch( () => {} );
		return;
	}
	void document.documentElement.requestFullscreen?.().catch( () => {} );
}
