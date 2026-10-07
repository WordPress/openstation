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

export function applyServerWindowNotices(
	entries: DesktopWindowNoticeServerEntry[],
): void {
	const wanted = new Set< string >();

	for ( const entry of entries ) {
		if ( ! entry || typeof entry.id !== 'string' || ! entry.id ) {
			continue;
		}
		wanted.add( entry.id.toLowerCase() );

		registerWindowNotice( {
			id: entry.id,
			message: entry.message,
			tone: entry.tone,
			dismissible: entry.dismissible !== false,
			icon: entry.icon,
			match: buildMatcher( entry.match ),
			order: typeof entry.order === 'number' ? entry.order : undefined,

			owner: '__server__',
		} );
	}

	for ( const existing of listWindowNotices() ) {
		if ( existing.owner !== '__server__' ) {
			continue;
		}
		if ( ! wanted.has( existing.id ) ) {
			unregisterWindowNotice( existing.id );
		}
	}
}
