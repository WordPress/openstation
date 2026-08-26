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

/**
 * Whether a URL points at this machine.
 *
 * Used to decide who gets asked about a bad certificate: self-signed
 * certificates are ordinary in local development and nowhere else.
 *
 * @param url URL to test.
 * @return True for loopback hosts.
 */
export function isLoopbackUrl( url: string ): boolean {
	let target: URL;
	try {
		target = new URL( String( url || '' ) );
	} catch {
		return false;
	}
	const host = target.hostname.toLowerCase();
	return (
		'localhost' === host ||
		'127.0.0.1' === host ||
		'[::1]' === host ||
		'::1' === host ||
		host.endsWith( '.localhost' )
	);
}

/**
 * Where the shell's first navigation chain is allowed to settle.
 *
 * The address someone types is a guess; the server has the final word,
 * and its answer is often a redirect. `example.com` → `www.example.com`
 * and `http://` → `https://` are canonicalization, not a change of
 * destination, and a first load that refused them would not degrade the
 * feature — it would fail to connect at all. So the shell's opening
 * chain runs unguarded and whatever it lands on becomes the site.
 *
 * That adoption is load-bearing in a way worth being careful about: the
 * settled origin becomes the local agent's single allowed origin *and*
 * the allowlist every later navigation is held to. A chain that walked
 * somewhere else entirely would hand both to whoever it landed on.
 *
 * The rule is therefore the narrowest one that still covers real
 * canonicalization: the landed host must be the configured host, or the
 * two must be in a subdomain relationship. Scheme and port may move,
 * because an HTTPS upgrade is the most ordinary redirect there is; the
 * *name* may not. Deliberately a string relationship rather than a
 * public-suffix lookup — shipping and refreshing a PSL to decide a
 * first-run redirect would be a large dependency for a small question,
 * and "one is a dot-suffix of the other" already refuses the case that
 * matters (`example.com` never settles onto `example.com.attacker.test`,
 * which ends in `.attacker.test`).
 *
 * @param landedUrl      Where the chain actually ended up.
 * @param configuredSite The site as configured before it started.
 * @return The site to adopt, or '' to keep the configured one.
 */
export function settledSiteUrl(
	landedUrl: string,
	configuredSite: string,
): string {
	const landed = normalizeSiteUrl( landedUrl );
	const configured = normalizeSiteUrl( configuredSite );
	if ( ! landed || ! configured ) {
		return '';
	}

	let a: URL;
	let b: URL;
	try {
		a = new URL( landed );
		b = new URL( configured );
	} catch {
		return '';
	}

	const from = b.hostname.toLowerCase();
	const to = a.hostname.toLowerCase();
	const related =
		from === to ||
		to.endsWith( `.${ from }` ) ||
		from.endsWith( `.${ to }` );

	return related ? landed : '';
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
