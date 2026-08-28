/**
 * OpenStation — "does this URL do something?"
 *
 * Shared by everything that fetches a page the user has not clicked
 * yet: the service worker's speculative documents, and the dock's
 * hover prewarming. Both load a real admin URL ahead of a click, so
 * both have exactly the same obligation — **speculation must never
 * act** — and both should answer the question the same way.
 *
 * It lives in its own module rather than in `sw-policy.ts` so the shell
 * can import the predicate without pulling service-worker policy code
 * into its bundle.
 */

/**
 * Query keys that mean a URL *does something*.
 *
 * Anything carrying an action or a nonce is a request to change state —
 * activating a plugin, emptying a trash, applying an update — and
 * fetching it ahead of a click the user has not made yet would perform
 * it.
 */
export const ACTING_QUERY_KEYS = [
	'action',
	'action2',
	'_wpnonce',
	'nonce',
	'delete_all',
] as const;

/**
 * Admin screens that act merely by being loaded.
 *
 * A query key is not the only way a URL does something. `post-new.php`
 * creates an auto-draft the moment it renders, so fetching it early
 * mints a fresh orphan post — invisible to the user, cleaned up by Core
 * only after seven days. The same holds for every `*-new.php` screen
 * that provisions before it paints, so the rule is written against the
 * filename rather than a list of individual pages.
 *
 * Matched on the path's last segment, so a subdirectory install or a
 * renamed admin folder is handled the same way.
 *
 * @param pathname URL pathname.
 */
export function actsOnLoad( pathname: string ): boolean {
	const file = pathname.slice( pathname.lastIndexOf( '/' ) + 1 );
	return /-new\.php$/.test( file );
}

/**
 * Whether fetching `url` ahead of a click could change something.
 *
 * @param url Parsed URL.
 */
export function urlActs( url: URL ): boolean {
	if ( actsOnLoad( url.pathname ) ) {
		return true;
	}
	for ( const key of ACTING_QUERY_KEYS ) {
		if ( url.searchParams.has( key ) ) {
			return true;
		}
	}
	return false;
}
