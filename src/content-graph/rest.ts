import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import { restErrorFromResponse } from '../core/api-client';
import type {
	CommentStats,
	ContentGraphConfig,
	GraphPayload,
	PostDetail,
	PostTypeDescriptor,
	TermStats,
	UserStats,
} from './types';

declare global {
	interface Window {
		openStationWindowConfig?: Record< string, unknown >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';
const SOURCE = 'desktop-mode/content-graph';

export function getConfig(): ContentGraphConfig {
	const map = window.openStationWindowConfig ?? {};
	const cfg = map[ WINDOW_ID ] as ContentGraphConfig | undefined;
	if ( ! cfg ) {
		throw new Error(
			'Corkboard config missing — openstation_register_window args lost in transit.',
		);
	}
	return cfg;
}

function authHeaders( cfg: ContentGraphConfig ): Record< string, string > {
	return {
		Accept: 'application/json',
		'X-WP-Nonce': cfg.restNonce,
	};
}

export async function fetchPostTypes(
	cfg: ContentGraphConfig,
): Promise< PostTypeDescriptor[] > {
	const res = await trackedFetch(
		`${ cfg.apiBase }/post-types`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `post-types: ${ res.status }` );
	}
	return ( await res.json() ) as PostTypeDescriptor[];
}

export async function fetchGraph(
	cfg: ContentGraphConfig,
	types: string[],
): Promise< GraphPayload > {
	const url = new URL( `${ cfg.apiBase }/nodes` );

	url.searchParams.set( 'types', types.join( ',' ) );
	const res = await trackedFetch(
		url.toString(),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `nodes: ${ res.status }` );
	}
	return ( await res.json() ) as GraphPayload;
}

export async function fetchPostDetail(
	cfg: ContentGraphConfig,
	id: number,
): Promise< PostDetail > {
	const res = await trackedFetch(
		`${ cfg.apiBase }/post/${ id }`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `post/${ id }: ${ res.status }` );
	}
	return ( await res.json() ) as PostDetail;
}

export async function fetchUserStats(
	cfg: ContentGraphConfig,
	userId: number,
): Promise< UserStats > {
	const res = await trackedFetch(
		joinRestUrl( cfg.restRoot, `desktop-mode/v1/user-stats/${ userId }` ),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `user-stats/${ userId }: ${ res.status }` );
	}
	return ( await res.json() ) as UserStats;
}

export async function fetchTermStats(
	cfg: ContentGraphConfig,
	taxonomy: string,
	termId: number,
): Promise< TermStats > {
	const res = await trackedFetch(
		joinRestUrl(
			cfg.restRoot,
			`desktop-mode/v1/term-stats/${ encodeURIComponent( taxonomy ) }/${ termId }`,
		),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `term-stats/${ taxonomy }/${ termId }: ${ res.status }` );
	}
	return ( await res.json() ) as TermStats;
}

export async function fetchCommentStats(
	cfg: ContentGraphConfig,
	commentId: number,
): Promise< CommentStats > {
	const res = await trackedFetch(
		joinRestUrl( cfg.restRoot, `desktop-mode/v1/comment-stats/${ commentId }` ),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw await restErrorFromResponse( res, `comment-stats/${ commentId }: ${ res.status }` );
	}
	return ( await res.json() ) as CommentStats;
}
