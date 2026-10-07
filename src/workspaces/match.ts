import type { NavItem } from '../nav/types';
import type { WorkspaceLaunch } from './types';

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

export function itemMatchesToken( item: NavItem, token: string ): boolean {
	const needle = token.trim().toLowerCase();
	if ( ! needle ) {
		return false;
	}
	return haystack( item ).includes( needle );
}

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

export interface ResolvedLaunch {

	item: NavItem;

	url: string;
	title: string;

	gridSpan?: WorkspaceLaunch[ 'gridSpan' ];
	place?: WorkspaceLaunch[ 'place' ];
}

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
			...( launch.gridSpan ? { gridSpan: launch.gridSpan } : {} ),
			...( launch.place ? { place: launch.place } : {} ),
		} );
	}
	return out;
}
