/**
 * Content Graph — REST client.
 *
 * Thin layer over `trackedFetch` that talks to the
 * `desktop-mode/v1/content-graph/*` routes. `tagged: source` so the
 * activity bus and per-window spinner can attribute requests
 * correctly (per AGENTS.md).
 *
 * @public
 * @since 0.8.2
 */

import { trackedFetch } from '../tracked-fetch';
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
		desktopModeWindowConfig?: Record< string, unknown >;
	}
}

const WINDOW_ID = 'desktop-mode-content-graph';
const SOURCE = 'desktop-mode/content-graph';

export function getConfig(): ContentGraphConfig {
	const map = window.desktopModeWindowConfig ?? {};
	const cfg = map[ WINDOW_ID ] as ContentGraphConfig | undefined;
	if ( ! cfg ) {
		throw new Error(
			'Content Graph config missing — desktop_mode_register_window args lost in transit.',
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
		throw new Error( `post-types: ${ res.status }` );
	}
	return ( await res.json() ) as PostTypeDescriptor[];
}

export async function fetchGraph(
	cfg: ContentGraphConfig,
	types: string[],
): Promise< GraphPayload > {
	const url = new URL( `${ cfg.apiBase }/nodes` );
	if ( types.length > 0 ) {
		url.searchParams.set( 'types', types.join( ',' ) );
	}
	const res = await trackedFetch(
		url.toString(),
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `nodes: ${ res.status }` );
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
		throw new Error( `post/${ id }: ${ res.status }` );
	}
	return ( await res.json() ) as PostDetail;
}

/**
 * Reach into My WordPress's pre-computed dossier endpoints. They
 * already aggregate everything the contextual panel needs (counts,
 * recent posts, milestones, activity histogram), gated on the same
 * `is_user_logged_in()` checks we already use. Avoids the need for
 * content-graph to re-implement the per-entity stats roll-ups.
 */
export async function fetchUserStats(
	cfg: ContentGraphConfig,
	userId: number,
): Promise< UserStats > {
	const res = await trackedFetch(
		`${ cfg.restRoot }desktop-mode/v1/user-stats/${ userId }`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `user-stats/${ userId }: ${ res.status }` );
	}
	return ( await res.json() ) as UserStats;
}

export async function fetchTermStats(
	cfg: ContentGraphConfig,
	taxonomy: string,
	termId: number,
): Promise< TermStats > {
	const res = await trackedFetch(
		`${ cfg.restRoot }desktop-mode/v1/term-stats/${ encodeURIComponent(
			taxonomy,
		) }/${ termId }`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error(
			`term-stats/${ taxonomy }/${ termId }: ${ res.status }`,
		);
	}
	return ( await res.json() ) as TermStats;
}

export async function fetchCommentStats(
	cfg: ContentGraphConfig,
	commentId: number,
): Promise< CommentStats > {
	const res = await trackedFetch(
		`${ cfg.restRoot }desktop-mode/v1/comment-stats/${ commentId }`,
		{ headers: authHeaders( cfg ) },
		{ source: SOURCE, windowId: WINDOW_ID },
	);
	if ( ! res.ok ) {
		throw new Error( `comment-stats/${ commentId }: ${ res.status }` );
	}
	return ( await res.json() ) as CommentStats;
}
