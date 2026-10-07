import type { UserListItem, UserStats } from './types';
export type ContributionKind = keyof UserStats;
const DAY = 86400000;

export function registeredAt( row: UserListItem ): number {
	const raw = row.registered_date;
	if ( ! raw ) {
		return NaN;
	}
	return Date.parse( /(?:Z|[+-]\d\d:\d\d)$/i.test( raw ) ? raw : `${ raw }Z` );
}
export function contribution( row: UserListItem, kind: ContributionKind ): number {
	const value = row.openstation_user_stats?.[ kind ];
	return typeof value === 'number' && Number.isFinite( value ) && value > 0 ? value : 0;
}
export function contributors( rows: UserListItem[], kind: ContributionKind ): UserListItem[] {
	return rows.filter( ( row ) => contribution( row, kind ) > 0 ).sort( ( a, b ) => contribution( b, kind ) - contribution( a, kind ) || a.name.localeCompare( b.name ) || a.id - b.id );
}
export function activityModel( rows: UserListItem[], now = Date.now() ) {
	const known = rows.filter( ( row ) => row.openstation_user_stats );
	const totals = { posts: 0, pages: 0, comments: 0 };
	for ( const row of known ) {
		for ( const kind of [ 'posts', 'pages', 'comments' ] as const ) {
			totals[ kind ] += contribution( row, kind );
		}
	}
	const registered = rows.filter( ( row ) => registeredAt( row ) > 0 && registeredAt( row ) <= now ).sort( ( a, b ) => registeredAt( b ) - registeredAt( a ) );
	const logins = rows.filter( ( row ) => typeof row.openstation_last_login === 'number' && row.openstation_last_login > 0 && row.openstation_last_login * 1000 <= now ).sort( ( a, b ) => b.openstation_last_login! - a.openstation_last_login! );
	const end = Math.floor( now / DAY ) * DAY + DAY;
	const start = end - 56 * DAY;
	const weeks = Array.from( { length: 8 }, () => [ 0 ] );
	for ( const row of registered ) {
		const bucket = Math.floor( ( registeredAt( row ) - start ) / ( 7 * DAY ) );
		if ( bucket >= 0 && bucket < 8 ) {
			weeks[ bucket ][ 0 ]++;
		}
	}
	return {
		totals, known: known.length,
		contributors: known.filter( ( row ) => contribution( row, 'posts' ) + contribution( row, 'pages' ) + contribution( row, 'comments' ) > 0 ).length,
		online: rows.filter( ( row ) => row.openstation_presence === 'online' ),
		away: rows.filter( ( row ) => row.openstation_presence === 'inactive' ),
		unknownPresence: rows.filter( ( row ) => ! [ 'online', 'inactive', 'offline' ].includes( row.openstation_presence || '' ) ).length,
		recent: registered.filter( ( row ) => registeredAt( row ) >= now - 30 * DAY ).length,
		registered, logins,
		active30: logins.filter( ( row ) => row.openstation_last_login! * 1000 >= now - 30 * DAY ).length,
		unrecorded: rows.length - logins.length,
		start: start / 1000, end: end / 1000, weeks,
	};
}

export interface ActivitySnapshot extends ReturnType< typeof activityModel > {
	total: number;
	onlineCount: number;
	awayCount: number;
	leaders: Record< ContributionKind, UserListItem[] >;
}
