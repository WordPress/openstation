/**
 * Desktop Mode — Games REST client.
 *
 * Thin typed wrappers over the `desktop-mode/v1/games/*` routes.
 * Works from any bundle: the REST root + nonce are read off
 * `wp.desktop.config` at call time and every request routes through
 * `trackedFetch` (activity bus + window spinner attribution).
 */

import { joinRestUrl } from '../rest-url';
import { trackedFetch } from '../tracked-fetch';
import type {
	GameChallengeRow,
	GameScoreRow,
	GameScoreSubmission,
} from './types';

const SOURCE = 'desktop-mode/games';

function restEnv(): { restUrl: string; restNonce: string } {
	const wpGlobal = window.wp as
		| { desktop?: { config?: { restUrl?: string; restNonce?: string } } }
		| undefined;
	const config = wpGlobal?.desktop?.config;
	return {
		restUrl: config?.restUrl || '/wp-json/',
		restNonce: config?.restNonce || '',
	};
}

async function call< T >(
	path: string,
	init: RequestInit = {},
	opts: { windowId?: string; silent?: boolean } = {},
): Promise< T > {
	const { restUrl, restNonce } = restEnv();
	const headers = new Headers( init.headers ?? {} );
	headers.set( 'X-WP-Nonce', restNonce );
	if ( init.body && ! headers.has( 'Content-Type' ) ) {
		headers.set( 'Content-Type', 'application/json' );
	}
	const res = await trackedFetch(
		joinRestUrl( restUrl, path ),
		{ ...init, headers, credentials: 'same-origin' },
		{ source: SOURCE, windowId: opts.windowId, silent: opts.silent },
	);
	const body: unknown = await res.json().catch( () => null );
	if ( ! res.ok ) {
		const message =
			( body as { message?: string } | null )?.message ||
			`Games request failed (${ res.status })`;
		const error = new Error( message ) as Error & { status?: number };
		error.status = res.status;
		throw error;
	}
	return body as T;
}

/** GET a leaderboard page. Pass `userId` to restrict to one player. */
export function fetchScores(
	game: string,
	args: {
		page?: number;
		perPage?: number;
		orderby?: 'score' | 'created';
		order?: 'asc' | 'desc';
		userId?: number;
	} = {},
): Promise< { scores: GameScoreRow[]; total: number } > {
	const params = new URLSearchParams( {
		page: String( args.page ?? 1 ),
		per_page: String( args.perPage ?? 25 ),
		orderby: args.orderby ?? 'score',
		order: args.order ?? 'desc',
	} );
	if ( args.userId ) {
		params.set( 'user_id', String( args.userId ) );
	}
	return call( `desktop-mode/v1/games/${ game }/scores?${ params }` );
}

/** POST the current user's finished run to the leaderboard. */
export function submitScore(
	game: string,
	submission: GameScoreSubmission,
	opts: { windowId?: string } = {},
): Promise< { id: number } > {
	return call(
		`desktop-mode/v1/games/${ game }/scores`,
		{
			method: 'POST',
			body: JSON.stringify( {
				score: submission.score,
				meta: submission.meta ?? {},
			} ),
		},
		opts,
	);
}

/**
 * GET the current user's play time: lifetime totals
 * (`game id => seconds`), daily buckets
 * (`game id => { 'YYYY-MM-DD' => seconds }`, rolling window), and
 * the server's current day key (site timezone).
 */
export function fetchPlaytime(): Promise< {
	playtime: Record< string, number >;
	daily: Record< string, Record< string, number > >;
	today: string;
} > {
	return call( 'desktop-mode/v1/games/playtime' );
}

/**
 * POST a play-time increment (whole seconds) for the current user.
 * Sent `silent` by the tracker's periodic flush so the once-a-minute
 * ping doesn't blink the window spinner.
 */
export function recordPlaytime(
	game: string,
	seconds: number,
	opts: { windowId?: string; silent?: boolean } = {},
): Promise< { total: number } > {
	return call(
		`desktop-mode/v1/games/${ game }/playtime`,
		{
			method: 'POST',
			body: JSON.stringify( { seconds } ),
		},
		opts,
	);
}

/** GET challenges involving the current user. */
export function fetchChallenges(
	args: { box?: 'incoming' | 'outgoing' | 'all'; state?: string } = {},
): Promise< { challenges: GameChallengeRow[] } > {
	const params = new URLSearchParams( { box: args.box ?? 'all' } );
	if ( args.state ) {
		params.set( 'state', args.state );
	}
	return call( `desktop-mode/v1/games/challenges?${ params }` );
}

/** POST a new score-to-beat challenge. */
export function createChallenge( args: {
	game: string;
	recipientId: number;
	score: number;
	meta?: Record< string, string | number >;
} ): Promise< { challenge: GameChallengeRow } > {
	return call( 'desktop-mode/v1/games/challenges', {
		method: 'POST',
		body: JSON.stringify( {
			game: args.game,
			recipient_id: args.recipientId,
			score: args.score,
			meta: args.meta ?? {},
		} ),
	} );
}

/** POST an accept for a pending incoming challenge. */
export function acceptChallenge(
	id: number,
): Promise< { challenge: GameChallengeRow } > {
	return call( `desktop-mode/v1/games/challenges/${ id }/accept`, {
		method: 'POST',
	} );
}

/** POST a decline for a pending incoming challenge. */
export function declineChallenge(
	id: number,
): Promise< { challenge: GameChallengeRow } > {
	return call( `desktop-mode/v1/games/challenges/${ id }/decline`, {
		method: 'POST',
	} );
}

/** POST the recipient's run result for an accepted challenge. */
export function completeChallenge(
	id: number,
	submission: GameScoreSubmission,
	opts: { windowId?: string } = {},
): Promise< { challenge: GameChallengeRow } > {
	return call(
		`desktop-mode/v1/games/challenges/${ id }/complete`,
		{
			method: 'POST',
			body: JSON.stringify( {
				score: submission.score,
				meta: submission.meta ?? {},
			} ),
		},
		opts,
	);
}
