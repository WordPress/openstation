/**
 * If `url` points off-site relative to the current shell origin, open
 * it in a fresh browser tab with `noopener,noreferrer` and return
 * `true`. Returns `false` for same-origin URLs (the caller falls
 * through to its iframe / native-window opener) and for unparseable
 * URLs (the caller's own error path handles those).
 *
 * Used by every opener the user can trigger from the desktop shell —
 * dock click, dock peek "+" card, desktop icon double-click — because
 * an off-site URL routed into the iframe path would either:
 *
 *   1. Get rejected by `withChromelessParam()` (same-origin gate) and
 *      land the iframe on `about:blank` with no affordance for the user
 *      to recover. This is the failure mode that surfaced on
 *      WordPress.com, where the admin menu's "Hosting" entry points at
 *      `https://wordpress.com/hosting/<site>` — a different origin from
 *      the wp-admin host — and the user saw a blank window.
 *
 *   2. Load successfully but be refused by the remote origin's
 *      `X-Frame-Options` / CSP `frame-ancestors` header (every modern
 *      first-party portal sets one). The user would see a load error
 *      inside the iframe with no native browser UI for retry / open-
 *      in-new-tab.
 *
 * Routing off-site URLs straight to a new browser tab matches what
 * classic admin does when the same menu item is clicked (the WP.com
 * admin bar uses `target="_blank"` for `wordpress.com` links).
 *
 * @param url Candidate URL — may be a bare path, a slug, or a full URL.
 * @return true if a new tab was opened, false otherwise.
 */
export function tryOpenExternalUrl( url: string ): boolean {
	try {
		const parsed = new URL( url, window.location.origin );
		if ( parsed.origin === window.location.origin ) {
			return false;
		}
		window.open( parsed.toString(), '_blank', 'noopener,noreferrer' );
		return true;
	} catch {
		return false;
	}
}
