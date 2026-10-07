import type { Hormones, TreeSnapshot } from './types';

const AGE_SATURATION_DAYS = 3650;

const SAPLING_CLOCK_PER_DAY = 1 / 250;

function clamp01( v: number ): number {
	return Math.min( 1, Math.max( 0, v ) );
}

function sat( v: number, k: number ): number {
	return v <= 0 ? 0 : v / ( v + k );
}

export function ageCurve( days: number ): number {
	if ( days <= 0 ) {
		return 0;
	}
	const log01 = clamp01(
		Math.log1p( days ) / Math.log1p( AGE_SATURATION_DAYS ),
	);
	return Math.min( log01, days * SAPLING_CLOCK_PER_DAY );
}

export function buildHormones( snapshot: TreeSnapshot ): Hormones {
	const posts = Math.max( 0, snapshot.totalPosts );
	const comments = Math.max( 0, snapshot.totalComments );
	const traffic = Math.max( 0, snapshot.traffic );
	const users = Math.max( 0, snapshot.activeUsers );
	const performance = clamp01( snapshot.performance );

	const energy =
		0.35 * sat( posts, 120 ) +
		0.25 * sat( comments, 400 ) +
		0.25 * sat( traffic, 2000 ) +
		0.15 * sat( users, 8 );
	const vigor01 = clamp01( energy * ( 0.6 + 0.4 * performance ) );

	const bloom01 = clamp01( sat( comments / Math.max( 1, posts ), 4 ) );

	const wind01 = clamp01( 0.2 + 0.8 * sat( traffic, 5000 ) );

	const pages = Math.max( 0, snapshot.totalPages );

	return {
		age01: ageCurve( snapshot.siteAgeDays ),
		vigor01,
		foliage01: clamp01( sat( posts, 150 ) ),
		health01: clamp01( snapshot.seoHealth ),
		bloom01,
		wind01,

		structure01: clamp01( sat( pages, 40 ) ),

		vitality01: performance,
		spark: Math.min( 40, Math.round( users ) ),
	};
}
