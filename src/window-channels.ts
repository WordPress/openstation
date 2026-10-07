import { HOOKS, doAction } from './hooks';
import { createSharedStore } from './shared-store';

export type WindowChannelMeta = {
	channel: string;
	windowId: string;
};

export type WindowChannelCb = (
	payload: unknown,
	meta: WindowChannelMeta,
) => void;

type PendingSend = {
	channel: string;
	payload: unknown;
	flush: () => void;
};

type SubRoot = Map< string, Map< string, Set< WindowChannelCb > > >;

interface WindowChannelsState {
	parentSubs: SubRoot;
	nativeSubs: SubRoot;
	readyWindows: Set< string >;
	loadingWindows: Set< string >;
	pendingSends: Map< string, PendingSend[] >;
}

const channelsStore = createSharedStore< WindowChannelsState >(
	'desktop-mode/window-channels',
	() => ( {
		parentSubs: new Map(),
		nativeSubs: new Map(),
		readyWindows: new Set(),
		loadingWindows: new Set(),
		pendingSends: new Map(),
	} ),
);

function bucket(
	root: SubRoot,
	windowId: string,
	channel: string,
	create: boolean,
): Set< WindowChannelCb > | undefined {
	let perWindow = root.get( windowId );
	if ( ! perWindow ) {
		if ( ! create ) {
			return undefined;
		}
		perWindow = new Map();
		root.set( windowId, perWindow );
	}
	let bucketSet = perWindow.get( channel );
	if ( ! bucketSet ) {
		if ( ! create ) {
			return undefined;
		}
		bucketSet = new Set();
		perWindow.set( channel, bucketSet );
	}
	return bucketSet;
}

function dispatch(
	root: SubRoot,
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	const meta: WindowChannelMeta = { channel, windowId };
	const exact = bucket( root, windowId, channel, false );
	if ( exact ) {
		for ( const cb of Array.from( exact ) ) {
			try {
				cb( payload, meta );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[openstation] window-channel subscriber for "${ channel }" threw:`,
						err,
					);
				}
			}
		}
	}
	const wildcard = bucket( root, windowId, '*', false );
	if ( wildcard ) {
		for ( const cb of Array.from( wildcard ) ) {
			try {
				cb( payload, meta );
			} catch ( err ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						`[openstation] window-channel wildcard subscriber for "${ windowId }" threw:`,
						err,
					);
				}
			}
		}
	}
}

export function addParentSubscriber(
	windowId: string,
	channel: string,
	cb: WindowChannelCb,
): () => void {
	const set = bucket(
		channelsStore.state.parentSubs,
		windowId,
		channel,
		true,
	)!;
	set.add( cb );
	let removed = false;
	return () => {
		if ( removed ) {
			return;
		}
		removed = true;
		set.delete( cb );
	};
}

export function dispatchFromWindow(
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	dispatch( channelsStore.state.parentSubs, windowId, channel, payload );
}

export function addNativeSubscriber(
	windowId: string,
	channel: string,
	cb: WindowChannelCb,
): () => void {
	const set = bucket(
		channelsStore.state.nativeSubs,
		windowId,
		channel,
		true,
	)!;
	set.add( cb );
	let removed = false;
	return () => {
		if ( removed ) {
			return;
		}
		removed = true;
		set.delete( cb );
	};
}

export function dispatchToNative(
	windowId: string,
	channel: string,
	payload: unknown,
): void {
	dispatch( channelsStore.state.nativeSubs, windowId, channel, payload );
}

export function isWindowContentReady( windowId: string ): boolean {
	return channelsStore.state.readyWindows.has( windowId );
}

export function isWindowContentLoading( windowId: string ): boolean {
	return channelsStore.state.loadingWindows.has( windowId );
}

export function markWindowContentLoading( windowId: string ): void {
	const { loadingWindows } = channelsStore.state;
	if ( loadingWindows.has( windowId ) ) {
		return;
	}
	loadingWindows.add( windowId );
	doAction( HOOKS.WINDOW_CONTENT_LOADING, { windowId } );
	if ( typeof document !== 'undefined' ) {
		document.dispatchEvent(
			new CustomEvent( 'os-window-content-loading', {
				detail: { windowId },
			} ),
		);
	}
}

export function markWindowContentReady( windowId: string ): void {
	const { readyWindows, loadingWindows, pendingSends } = channelsStore.state;
	if ( ! readyWindows.has( windowId ) ) {
		readyWindows.add( windowId );
		const queued = pendingSends.get( windowId );
		if ( queued ) {
			pendingSends.delete( windowId );
			for ( const m of queued ) {
				try {
					m.flush();
				} catch ( err ) {
					if ( typeof console !== 'undefined' ) {
						console.error(
							`[openstation] flushing queued window-send for "${ m.channel }" threw:`,
							err,
						);
					}
				}
			}
		}
	}

	if ( loadingWindows.delete( windowId ) ) {
		doAction( HOOKS.WINDOW_CONTENT_LOADED, { windowId } );
		if ( typeof document !== 'undefined' ) {
			document.dispatchEvent(
				new CustomEvent( 'os-window-content-loaded', {
					detail: { windowId },
				} ),
			);
		}
	}
}

export function enqueueWindowSend(
	windowId: string,
	channel: string,
	payload: unknown,
	flush: () => void,
): void {
	const { pendingSends } = channelsStore.state;
	let q = pendingSends.get( windowId );
	if ( ! q ) {
		q = [];
		pendingSends.set( windowId, q );
	}
	q.push( { channel, payload, flush } );
}

export function clearWindowChannels( windowId: string ): void {
	const s = channelsStore.state;
	s.parentSubs.delete( windowId );
	s.nativeSubs.delete( windowId );
	s.readyWindows.delete( windowId );
	s.loadingWindows.delete( windowId );
	s.pendingSends.delete( windowId );
}

export function _resetWindowChannelsForTests(): void {
	const s = channelsStore.state;
	s.parentSubs.clear();
	s.nativeSubs.clear();
	s.readyWindows.clear();
	s.loadingWindows.clear();
	s.pendingSends.clear();
}
