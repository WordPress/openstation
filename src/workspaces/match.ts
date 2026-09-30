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

/**
 * A registered native window — an OpenStation app (Trash, Station
 * Home, the native Posts, Users and Plugins apps, Preferences…) — as a
 * launch entry can name it even when it has no navigation item of its
 * own. Most native apps are reached from somewhere other than the dock
 * (a desktop icon, the System menu, a remapped admin URL), so the
 * navigation alone does not know them.
 */
export interface NativeWindowRef {
	id: string;
	title: string;
	icon: string;
}

/** Every native window the server registered for this user. */
export function registeredNativeWindows(): NativeWindowRef[] {
	const list = ( window as unknown as { openStationConfig?: { nativeWindows?: unknown } } ).openStationConfig
		?.nativeWindows;
	if ( ! Array.isArray( list ) ) {
		return [];
	}
	return list
		.filter( ( e ): e is Record< string, unknown > => !! e && 'string' === typeof ( e as { id?: unknown } ).id )
		.map( ( e ) => ( {
			id: e.id as string,
			title: 'string' === typeof e.title ? e.title : ( e.id as string ),
			icon: 'string' === typeof e.icon ? e.icon : '',
		} ) );
}

/** A native window as the nav item a resolved launch carries. */
function nativeAsItem( native: NativeWindowRef ): NavItem {
	return { id: native.id, kind: 'app', title: native.title, icon: native.icon, windowId: native.id } as NavItem;
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
	/** Carried through from the entry — see `WorkspaceLaunch`. */
	gridSpan?: WorkspaceLaunch[ 'gridSpan' ];
	place?: WorkspaceLaunch[ 'place' ];
}

/**
 * Turn a workspace's launch list into windows that can actually be
 * opened here. Entries whose `match` finds nothing are dropped.
 *
 * The explicit `url` wins when given, because a launch entry often
 * wants a page the menu itself does not open: the Publishing desk opens
 * `post-new.php`, and the only thing proving that page exists is the
 * Posts menu it hangs off.
 */
export function resolveLaunches(
	items: readonly NavItem[],
	launches: readonly WorkspaceLaunch[],
	natives: readonly NativeWindowRef[] = registeredNativeWindows(),
): ResolvedLaunch[] {
	const out: ResolvedLaunch[] = [];
	for ( const launch of launches ) {
		// The navigation first; then a native window registered under
		// exactly that id — an app with no dock item of its own (Station
		// Home, the native Posts app…) is still an app the desk opens.
		const native = natives.find( ( n ) => n.id === launch.match );
		const item =
			items.find( ( candidate ) => itemMatchesToken( candidate, launch.match ) ) ??
			( native ? nativeAsItem( native ) : undefined );
		if ( ! item ) {
			continue;
		}
		out.push( {
			item,
			url: launch.url ?? item.menu?.url ?? item.entry?.url ?? '',
			title: launch.title ?? item.title,
			...( launch.gridSpan ? { gridSpan: launch.gridSpan } : {} ),
			...( launch.place ? { place: launch.place } : {} ),
		} );
	}
	return out;
}

/** One app a workspace can put on a desk — see {@link workspaceAppCatalog}. */
export interface WorkspaceApp {
	id: string;
	title: string;
	icon: string;
	/**
	 * The screens it opens, admin-relative: its main page first, then
	 * its tabs. Empty for an app that is a window of its own.
	 */
	pages: Array< { title: string; url: string } >;
	/** Whether it has a dock icon a workspace can keep or hide. */
	dock: boolean;
}

/** Never offered: the tool workspaces are made with. */
const NOT_AN_APP = new Set( [ 'openstation-workspaces' ] );

/** An admin URL as the admin-relative path a workspace stores. */
function relativeAdminUrl( url: string, base: string ): string {
	if ( base && url.startsWith( base ) ) {
		return url.slice( base.length );
	}
	const i = url.indexOf( '/wp-admin/' );
	return i >= 0 ? url.slice( i + '/wp-admin/'.length ) : url;
}

/**
 * Every app a workspace can use on this site, native or not.
 *
 * - **Every navigation item that opens something**: admin menus with
 *   their tabs, plugin launchers, desktop icons — and Trash, an app in a
 *   control's tile. An app opens the way its dock icon does: the menu's
 *   main page, through the same native remap a click takes, so "Posts"
 *   is the Posts window with All Posts, Add Post, Categories and Tags.
 * - **Every registered native window with no dock item of its own**
 *   (Preferences, …): opened as a window, never on the dock.
 *
 * Left out: controls that are actions (System, Workspaces, Mio, Exit)
 * — every desk keeps those — the Workspaces app itself, and a native
 * window that is only what an admin menu opens (the native Posts app
 * stands in for `edit.php`): listing it again would be Posts twice.
 *
 * @param items    The live navigation.
 * @param natives  Registered native windows.
 * @param standIns Native window ids that replace an admin screen.
 * @param adminUrl To make URLs admin-relative.
 */
export function workspaceAppCatalog(
	items: readonly NavItem[],
	natives: readonly NativeWindowRef[],
	standIns: ReadonlySet< string >,
	adminUrl: string,
): WorkspaceApp[] {
	const out: WorkspaceApp[] = [];
	const covered = new Set< string >();
	for ( const item of items ) {
		if ( item.locked || item.transient || NOT_AN_APP.has( item.id ) ) {
			continue;
		}
		if ( 'control' === item.kind && ! item.windowId ) {
			continue;
		}
		const pages: WorkspaceApp[ 'pages' ] = [];
		if ( item.menu?.url ) {
			pages.push( { title: item.menu.selfLabel || item.title, url: relativeAdminUrl( item.menu.url, adminUrl ) } );
			for ( const sub of item.menu.submenu ?? [] ) {
				if ( sub.url && ! sub.offSite ) {
					pages.push( { title: sub.title, url: relativeAdminUrl( sub.url, adminUrl ) } );
				}
			}
		}
		if ( ! pages.length && ! item.windowId ) {
			continue;
		}
		covered.add( item.id );
		if ( item.windowId ) {
			covered.add( item.windowId );
		}
		out.push( { id: item.id, title: item.title, icon: item.icon, pages, dock: true } );
	}
	for ( const native of natives ) {
		if ( covered.has( native.id ) || standIns.has( native.id ) || NOT_AN_APP.has( native.id ) ) {
			continue;
		}
		covered.add( native.id );
		out.push( { id: native.id, title: native.title, icon: native.icon, pages: [], dock: false } );
	}
	return out;
}
