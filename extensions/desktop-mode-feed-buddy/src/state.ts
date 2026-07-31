import { desktop } from './api';
import type {
	FeedBuddyClientState,
	FeedBuddyServerState,
	FeedSubscription,
	FeedSummary,
	SharedStore,
} from './types';

let sharedStore: SharedStore< FeedBuddyClientState > | null = null;

export function getStore(): SharedStore< FeedBuddyClientState > {
	if ( sharedStore ) {
		return sharedStore;
	}
	sharedStore = desktop().createSharedStore< FeedBuddyClientState >(
		'feed-buddy/state',
		() => ( {
			server: null,
			selectedFeedId: null,
			items: [],
			itemsForFeedId: null,
			itemsLoading: false,
			stateLoading: false,
			error: null,
			managerOpen: false,
			newFeedIds: [],
			presenceMode: 'online',
			retroMode: false,
		} ),
	);
	return sharedStore;
}

export function applyServerState(
	next: FeedBuddyServerState,
	announceNew = false,
): string[] {
	const store = getStore();
	const increased = announceNew
		? unreadIncreases( store.state.server, next )
		: [];
	store.state.server = next;
	store.state.newFeedIds = increased;
	if (
		store.state.selectedFeedId &&
		! next.subscriptions.some(
			( subscription ) => subscription.id === store.state.selectedFeedId,
		)
	) {
		store.state.selectedFeedId = null;
	}
	store.state.error = null;
	store.notify();
	return increased;
}

export function setError( error: unknown ): void {
	const store = getStore();
	store.state.error =
		error instanceof Error ? error.message : String( error ?? 'Unknown error' );
	store.notify();
}

export function clearNewFeedIds(): void {
	const store = getStore();
	if ( store.state.newFeedIds.length === 0 ) {
		return;
	}
	store.state.newFeedIds = [];
	store.notify();
}

export function selectFeed( feedId: string | null ): void {
	const store = getStore();
	store.state.selectedFeedId = feedId;
	store.notify();
}

export function summariesById(
	state: FeedBuddyServerState | null,
): Map< string, FeedSummary > {
	return new Map( ( state?.summaries ?? [] ).map( ( summary ) => [ summary.id, summary ] ) );
}

export function groupSubscriptions(
	subscriptions: FeedSubscription[],
): Array< { group: string; subscriptions: FeedSubscription[] } > {
	const groups = new Map< string, FeedSubscription[] >();
	for ( const subscription of subscriptions ) {
		const group = subscription.group.trim() || 'Feeds';
		const current = groups.get( group ) ?? [];
		current.push( subscription );
		groups.set( group, current );
	}
	return Array.from( groups, ( [ group, entries ] ) => ( {
		group,
		subscriptions: entries,
	} ) );
}

export function unreadIncreases(
	previous: FeedBuddyServerState | null,
	next: FeedBuddyServerState,
): string[] {
	if ( ! previous ) {
		return [];
	}
	const before = summariesById( previous );
	return next.summaries
		.filter( ( summary ) => summary.unread > ( before.get( summary.id )?.unread ?? 0 ) )
		.map( ( summary ) => summary.id );
}
