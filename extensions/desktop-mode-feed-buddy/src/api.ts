import type {
	DesktopApi,
	FeedBuddyConfig,
	FeedBuddyServerState,
	FeedItemsPage,
} from './types';

export const WINDOW_ID = 'feed-buddy-reader';
export const WIDGET_ID = 'feed-buddy/buddy-list';

export function desktop(): DesktopApi {
	const api = window.wp?.desktop;
	if ( ! api ) {
		throw new Error( 'SOL Inbound Monologue requires the Desktop Mode public API.' );
	}
	return api;
}

export function config(): FeedBuddyConfig {
	const value = desktop().getWindowConfig( WINDOW_ID );
	if ( ! value?.restBase || ! value.restNonce ) {
		throw new Error( 'SOL Inbound Monologue window config is missing.' );
	}
	return value;
}

interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	body?: unknown;
	signal?: AbortSignal;
	silent?: boolean;
	windowId?: string;
}

async function request< T >( path: string, options: RequestOptions = {} ): Promise< T > {
	const cfg = config();
	const url = new URL( path.replace( /^\//, '' ), cfg.restBase );
	const response = await desktop().fetch(
		url,
		{
			method: options.method ?? 'GET',
			credentials: 'same-origin',
			signal: options.signal,
			headers: {
				Accept: 'application/json',
				'X-WP-Nonce': cfg.restNonce,
				...( options.body !== undefined
					? { 'Content-Type': 'application/json' }
					: {} ),
			},
			body:
				options.body !== undefined
					? JSON.stringify( options.body )
					: undefined,
		},
		{
			windowId: options.windowId,
			source: 'feed-buddy',
			silent: options.silent,
		},
	);

	if ( ! response.ok ) {
		let message = `${ response.status } ${ response.statusText }`;
		try {
			const error = ( await response.json() ) as { message?: string };
			if ( error.message ) {
				message = error.message;
			}
		} catch {
			// The bounded status fallback above is sufficient.
		}
		throw new Error( message );
	}

	return ( await response.json() ) as T;
}

export function fetchState(
	options: { signal?: AbortSignal; silent?: boolean; windowId?: string } = {},
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >( 'state', options );
}

export function updatePreferences(
	soundEnabled: boolean,
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >( 'state', {
		method: 'PATCH',
		body: { preferences: { soundEnabled } },
		signal,
		windowId: WINDOW_ID,
	} );
}

export function addSubscription(
	url: string,
	group: string,
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >( 'subscriptions', {
		method: 'POST',
		body: { url, group },
		signal,
		windowId: WINDOW_ID,
	} );
}

export function updateSubscription(
	id: string,
	patch: { title?: string; group?: string; direction?: -1 | 1 },
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >(
		`subscriptions/${ encodeURIComponent( id ) }`,
		{
			method: 'PATCH',
			body: patch,
			signal,
			windowId: WINDOW_ID,
		},
	);
}

export function deleteSubscription(
	id: string,
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >(
		`subscriptions/${ encodeURIComponent( id ) }`,
		{
			method: 'DELETE',
			signal,
			windowId: WINDOW_ID,
		},
	);
}

export function fetchItems(
	feedId: string | null,
	signal?: AbortSignal,
): Promise< FeedItemsPage > {
	const params = new URLSearchParams();
	if ( feedId ) {
		params.set( 'feed_id', feedId );
	}
	params.set( 'cursor', '0' );
	return request< FeedItemsPage >( `items?${ params.toString() }`, {
		signal,
		windowId: WINDOW_ID,
	} );
}

export function updateReadState(
	body: {
		scope: 'item' | 'feed' | 'all';
		read: boolean;
		feedId?: string;
		itemIds?: string[];
	},
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >( 'read', {
		method: 'POST',
		body,
		signal,
		windowId: WINDOW_ID,
	} );
}

export function refreshFeeds(
	feedId: string | null,
	signal?: AbortSignal,
): Promise< FeedBuddyServerState > {
	return request< FeedBuddyServerState >( 'refresh', {
		method: 'POST',
		body: feedId ? { feedId } : {},
		signal,
		windowId: WINDOW_ID,
	} );
}
