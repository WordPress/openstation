/**
 * OpenStation Desktop — site-address parsing.
 *
 * Pure string work, deliberately kept out of `main.ts` so the rules
 * below can be tested without an Electron runtime. This is the code
 * that reads whatever a person typed into a first-run text box, and
 * people type a lot of things.
 */

/**
 * Normalize whatever the user typed into a site origin we can load.
 *
 * Accepts `example.com`, `example.com/`, `http://localhost:8889`, and
 * full admin URLs, which is the common paste: someone copies the
 * address bar while sitting in wp-admin. Trimming back to the site
 * root is what turns that paste into a working connection instead of
 * an error message telling them to try harder.
 *
 * Bare hostnames get `https://`. Anyone on plain HTTP — local
 * development, mostly — types the scheme, and typing it is a cheaper
 * price than silently downgrading someone's production site.
 *
 * @param input Raw user input.
 * @return Normalized base URL without a trailing slash, or '' if unusable.
 */
export function normalizeSiteUrl( input: string ): string {
	const raw = String( input || '' ).trim();
	if ( ! raw ) {
		return '';
	}

	const withScheme = /^https?:\/\//i.test( raw ) ? raw : `https://${ raw }`;

	let url: URL;
	try {
		url = new URL( withScheme );
	} catch {
		return '';
	}

	if ( ! url.hostname ) {
		return '';
	}

	// Drop anything past the site root the user may have pasted —
	// `/wp-admin/…`, `/openstation/`, a login URL, a query string.
	//
	// Computed into a local rather than written back through
	// `url.pathname`: the setter re-normalizes an empty path to `/`,
	// which put a trailing slash back on every result and made
	// `shellEntryUrl()` build `https://example.com//openstation/`.
	const path = url.pathname
		.replace( /\/(wp-admin|wp-login\.php|openstation|desktop-mode)(\/.*)?$/i, '/' )
		.replace( /\/+$/, '' );

	return url.origin + path;
}

/**
 * The URL the shell window should load for a configured site.
 *
 * `/openstation/` is the plugin's own front door: it signs the user in
 * if needed, turns OpenStation on for their account on first visit,
 * and forwards into whichever window they last had focused. Pointing
 * the app at `/wp-admin/` instead would work but would skip all three.
 *
 * @param siteUrl Normalized site base URL.
 * @return Entry URL, or '' when no site is configured.
 */
export function shellEntryUrl( siteUrl: string ): string {
	const site = String( siteUrl || '' ).replace( /\/+$/, '' );
	return site ? `${ site }/openstation/` : '';
}

/**
 * Whether a URL is one this app may open in a window it owns.
 *
 * Freed windows load URLs chosen by the *page*, and a page is exactly
 * the thing an attacker might have a foothold in. So the main process
 * re-checks what the preload already checked: http(s) only, and on the
 * site the user connected to.
 *
 * @param url     URL to test.
 * @param siteUrl The configured site.
 * @return True when the URL is safe to open.
 */
export function isSameSiteUrl( url: string, siteUrl: string ): boolean {
	const site = String( siteUrl || '' ).replace( /\/+$/, '' );
	if ( ! site ) {
		return false;
	}
	let target: URL;
	let base: URL;
	try {
		target = new URL( String( url || '' ) );
		base = new URL( site );
	} catch {
		return false;
	}
	if ( ! /^https?:$/.test( target.protocol ) ) {
		return false;
	}
	return target.host === base.host && target.protocol === base.protocol;
}

/** What to do with a navigation a window we own is about to make. */
export type NavigationVerdict = 'allow' | 'external' | 'block';

/**
 * Where a same-tab navigation should end up.
 *
 * `setWindowOpenHandler` decides this for `window.open()`; nothing
 * decided it for an ordinary link, a `location.href =`, or a redirect,
 * so those went wherever the page said. That mattered more than it
 * looks: a preload survives navigation, so a window that followed a
 * link off the site was still holding `window.openStationDesktopHost`
 * — handing the host bridge to a document nobody paired with.
 *
 * The rule is the same one every other URL here is held to. On the
 * site, it is a window of the desktop and stays. Some other http(s)
 * address is a link to the wider web and belongs in the browser, the
 * way `routeNewWindow()` already treats an off-site popup. Anything
 * else — `file:`, `data:`, a custom scheme — is not a destination this
 * app has any business following.
 *
 * @param url     Where the window wants to go.
 * @param siteUrl The connected site.
 * @return The verdict.
 */
export function navigationVerdict(
	url: string,
	siteUrl: string,
): NavigationVerdict {
	if ( isSameSiteUrl( url, siteUrl ) ) {
		return 'allow';
	}
	return /^https?:\/\//i.test( String( url || '' ) ) ? 'external' : 'block';
}
