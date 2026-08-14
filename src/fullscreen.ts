/**
 * Browser fullscreen for the whole shell.
 *
 * This used to live only in `assets/js/admin-bar.js`, wired to the
 * admin bar's fullscreen button. With the bar hidden by default that
 * button is not on screen, so the capability needed a home inside the
 * shell — this is it, and the System tile's row is its front door.
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
