import { describe, expect, it } from 'vitest';
import {
	groupSubscriptions,
	summariesById,
	unreadIncreases,
} from '../../src/state';
import type {
	FeedBuddyServerState,
	FeedSubscription,
} from '../../src/types';

function subscription(
	id: string,
	group: string,
	order: number,
): FeedSubscription {
	return {
		id,
		url: `https://example.com/${ id }.xml`,
		title: `Feed ${ id }`,
		group,
		order,
		addedAt: '2026-07-28T12:00:00Z',
	};
}

function serverState(
	subscriptions: FeedSubscription[],
	unread: Record< string, number >,
): FeedBuddyServerState {
	return {
		subscriptions,
		summaries: subscriptions.map( ( entry ) => ( {
			id: entry.id,
			status: 'online',
			unread: unread[ entry.id ] ?? 0,
			lastFetchedAt: '2026-07-28T12:00:00Z',
			error: null,
		} ) ),
		groups: [ ...new Set( subscriptions.map( ( entry ) => entry.group ) ) ],
		preferences: { soundEnabled: false },
	};
}

describe( 'SOL Inbound Monologue shared-state projections', () => {
	it( 'groups subscriptions without changing their server order', () => {
		const subscriptions = [
			subscription( 'one', 'NEWS', 0 ),
			subscription( 'two', 'BLOGS', 1 ),
			subscription( 'three', 'NEWS', 2 ),
		];

		expect( groupSubscriptions( subscriptions ) ).toEqual( [
			{
				group: 'NEWS',
				subscriptions: [ subscriptions[ 0 ], subscriptions[ 2 ] ],
			},
			{
				group: 'BLOGS',
				subscriptions: [ subscriptions[ 1 ] ],
			},
		] );
	} );

	it( 'uses the default group for blank labels', () => {
		expect( groupSubscriptions( [ subscription( 'one', '  ', 0 ) ] )[ 0 ].group )
			.toBe( 'Feeds' );
	} );

	it( 'reports only feeds whose unread count increased', () => {
		const subscriptions = [
			subscription( 'one', 'NEWS', 0 ),
			subscription( 'two', 'BLOGS', 1 ),
		];
		const previous = serverState( subscriptions, { one: 1, two: 4 } );
		const next = serverState( subscriptions, { one: 2, two: 1 } );

		expect( unreadIncreases( previous, next ) ).toEqual( [ 'one' ] );
		expect( unreadIncreases( null, next ) ).toEqual( [] );
	} );

	it( 'indexes summaries by subscription id', () => {
		const state = serverState( [ subscription( 'one', 'NEWS', 0 ) ], {
			one: 3,
		} );
		expect( summariesById( state ).get( 'one' )?.unread ).toBe( 3 );
	} );
} );
