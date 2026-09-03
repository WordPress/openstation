/**
 * Which ADMIN a path belongs to: the site root up to and including the
 * first `/wp-admin/`, plus the `network/` or `user/` segment when
 * there is one — the client-side twin of `self_admin_url()`. The
 * segment is the part a site-root comparison gets wrong: the network
 * admin sits UNDER the main site's admin, sharing its prefix.
 *
 * This is the SHELL's copy of the rule. `src/chromeless-bridge.js`
 * carries its own inline `adminScope()` because the bridge must stay a
 * self-contained plain script (its test evals the raw source) — the
 * two are pinned against one shared URL table in
 * `tests/vitest/admin-scope.test.ts`, which is what keeps them from
 * drifting the way an earlier second copy did.
 */

/** Admin scope of a pathname, or '' when the path is not an admin one. */
export function adminScopeOf( pathname: string ): string {
	const i = pathname.indexOf( '/wp-admin/' );
	if ( i === -1 ) {
		return '';
	}
	const rest = pathname.slice( i + 10 );
	const sub = /^(network|user)\//.exec( rest );
	return pathname.slice( 0, i + 10 ) + ( sub ? sub[ 0 ] : '' );
}

/**
 * Admin scope of a URL, resolved against `base` — and `null` when the
 * URL is cross-origin from it (another origin has no scope HERE: it
 * cannot be framed, hopped through a view transition, or hosted on a
 * scoped desktop).
 */
export function adminScopeOfUrl( url: string, base: string ): string | null {
	try {
		const parsed = new URL( url, base );
		if ( parsed.origin !== new URL( base ).origin ) {
			return null;
		}
		const scope = adminScopeOf( parsed.pathname );
		return scope === '' ? null : scope;
	} catch {
		return null;
	}
}
