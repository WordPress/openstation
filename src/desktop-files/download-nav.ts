/**
 * OpenStation — download navigation helper.
 *
 * Triggers a browser download of an authenticated URL via a
 * transient same-origin anchor. No `fetch`-to-blob buffering (a
 * multi-hundred-MB zip must never transit JS memory); the cookie
 * rides the navigation and the `_wpnonce` query param satisfies
 * the REST CSRF check. `Content-Disposition: attachment` on the
 * server makes the navigation a download rather than a page load.
 */

export function navigateToDownload( url: string ): void {
	const a = document.createElement( 'a' );
	a.href = url;
	// Hint only — the server's attachment disposition is the real
	// mechanism (and wins on filename).
	a.setAttribute( 'download', '' );
	a.style.display = 'none';
	document.body.appendChild( a );
	a.click();
	a.remove();
}
