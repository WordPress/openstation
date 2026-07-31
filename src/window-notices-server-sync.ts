/**
 * Server-driven window-notices sync.
 *
 * Notices are pure declarative data — the PHP side ships the full
 * entry through the payload (id, message, tone, dismissibility,
 * match), and this module mirrors the list onto the live registry by
 * calling {@link registerWindowNotice} for each. Re-runs on every
 * `desktop-mode-plugins-changed` payload so plugin activation /
 * deactivation reflects without an F5.
 */

import {
	registerWindowNotice,
	unregisterWindowNotice,
	listWindowNotices,
	type WindowNoticeMatch,
} from './window-notices';
import type { DesktopWindowNoticeServerEntry } from './types';
import type { Window as DesktopWindow } from './window';

function buildMatcher(
	match: DesktopWindowNoticeServerEntry[ 'match' ],
): WindowNoticeMatch | undefined {
	if ( ! match ) {
		return undefined;
	}
	const ids = new Set< string >();
	if ( typeof match.window === 'string' && match.window !== '' ) {
		ids.add( match.window );
	}
	if ( Array.isArray( match.windows ) ) {
		for ( const id of match.windows ) {
			if ( typeof id === 'string' && id !== '' ) {
				ids.add( id );
			}
		}
	}
	const needle =
		typeof match.urlContains === 'string' && match.urlContains !== ''
			? match.urlContains.toLowerCase()
			: null;

	if ( ids.size === 0 && needle === null ) {
		return undefined;
	}

	return ( w: DesktopWindow ) => {
		if ( ids.size > 0 && ! ids.has( w.id ) ) {
			return false;
		}
		if ( needle !== null ) {
			const url =
				typeof w.config.url === 'string' ? w.config.url.toLowerCase() : '';
			if ( ! url.includes( needle ) ) {
				return false;
			}
		}
		return true;
	};
}

/**
 * Reconcile the live `registerWindowNotice()` registry against a
 * fresh server-shipped list. Adds any newly-declared entries,
 * updates changed ones, removes entries the server no longer ships.
 */
export function applyServerWindowNotices(
	entries: DesktopWindowNoticeServerEntry[],
): void {
	const wanted = new Set< string >();

	for ( const entry of entries ) {
		if ( ! entry || typeof entry.id !== 'string' || ! entry.id ) {
			continue;
		}
		wanted.add( entry.id.toLowerCase() );
		// register* replaces an existing entry with the same id, so
		// it doubles as an update path.
		registerWindowNotice( {
			id: entry.id,
			message: entry.message,
			tone: entry.tone,
			dismissible: entry.dismissible !== false,
			icon: entry.icon,
			match: buildMatcher( entry.match ),
			order: typeof entry.order === 'number' ? entry.order : undefined,
			// `owner` tag marks every server-shipped notice so a
			// targeted cleanup is trivial if/when we surface a sweep
			// helper later. Matches the convention used by the
			// command / settings-tab sync modules.
			owner: '__server__',
		} );
	}

	// Drop entries the server no longer ships (plugin deactivated
	// mid-session). Only sweep entries we recognise as
	// server-shipped via the owner tag — JS-registered notices
	// (`wp.desktop.registerWindowNotice` from a non-server caller)
	// keep their lifecycle.
	for ( const existing of listWindowNotices() ) {
		if ( existing.owner !== '__server__' ) {
			continue;
		}
		if ( ! wanted.has( existing.id ) ) {
			unregisterWindowNotice( existing.id );
		}
	}
}
