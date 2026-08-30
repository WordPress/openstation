/**
 * Resolving a workspace template's tokens against the live navigation.
 *
 * A preset cannot name nav ids directly and stay useful. The id of the
 * Products menu is whatever `deriveWindowId()` made of its URL on this
 * install, WooCommerce may not be installed at all, and a site that
 * renamed its post types has different ids again. So a preset names
 * what it is ABOUT — `'post_type=product'`, `'sensei'` — and this
 * module finds whatever the site actually has under that name.
 *
 * The consequence worth stating: a preset degrades instead of
 * breaking. The Woo template on a site without WooCommerce resolves to
 * the handful of core menus its tokens still match, opens the windows
 * it can find, and skips the rest. Nobody gets a desk full of
 * permission errors.
 */

import type { NavItem } from '../nav/types';
import type { WorkspaceLaunch } from './types';

/**
 * Every string a token is tested against for one item, lowercased.
 *
 * The title is in the list on purpose: a plugin whose menu slug says
 * nothing (`admin.php?page=wc-admin`) is still findable by the word a
 * human would use for it. It is also the reason tokens are matched as
 * substrings rather than parsed — `'product'` has to find both
 * `edit.php?post_type=product` and a menu titled "Products".
 */
function haystack( item: NavItem ): string {
	return [
		item.id,
		item.menu?.url ?? '',
		item.entry?.url ?? '',
		item.windowId ?? '',
		item.title,
	]
		.join( '\n' )
		.toLowerCase();
}

/** Whether one token names this item. */
export function itemMatchesToken( item: NavItem, token: string ): boolean {
	const needle = token.trim().toLowerCase();
	if ( ! needle ) {
		return false;
	}
	return haystack( item ).includes( needle );
}

/**
 * Ids of every item any of `tokens` names, in the order the items were
 * given so the result is stable across calls.
 *
 * Deduplicated: two tokens finding the same menu is the normal case
 * (`'product'` and `'woocommerce'` both find the Products menu on a
 * Woo site), not a mistake worth reporting.
 */
export function resolveAppIds(
	items: readonly NavItem[],
	tokens: readonly string[],
): string[] {
	if ( tokens.length === 0 ) {
		return [];
	}
	const out: string[] = [];
	const seen = new Set< string >();
	for ( const item of items ) {
		if ( seen.has( item.id ) ) {
			continue;
		}
		if ( tokens.some( ( token ) => itemMatchesToken( item, token ) ) ) {
			seen.add( item.id );
			out.push( item.id );
		}
	}
	return out;
}

/** One launch entry, resolved against the navigation. */
export interface ResolvedLaunch {
	/** The nav item that proved the app is installed. */
	item: NavItem;
	/**
	 * Admin-relative URL to open, or `''` when the item opens a native
	 * window instead (read `item.windowId` for that case).
	 */
	url: string;
	title: string;
}

/**
 * Turn a workspace's launch list into windows that can actually be
 * opened here. Entries whose `match` finds nothing are dropped.
 *
 * The explicit `url` wins when given, because a launch entry often
 * wants a page the menu itself does not open: the Longreads desk opens
 * `post-new.php`, and the only thing proving that page exists is the
 * Posts menu it hangs off.
 */
export function resolveLaunches(
	items: readonly NavItem[],
	launches: readonly WorkspaceLaunch[],
): ResolvedLaunch[] {
	const out: ResolvedLaunch[] = [];
	for ( const launch of launches ) {
		const item = items.find( ( candidate ) =>
			itemMatchesToken( candidate, launch.match ),
		);
		if ( ! item ) {
			continue;
		}
		out.push( {
			item,
			url: launch.url ?? item.menu?.url ?? item.entry?.url ?? '',
			title: launch.title ?? item.title,
		} );
	}
	return out;
}
