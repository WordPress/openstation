import {
	addAction,
	applyFilters,
	doAction,
	removeAction,
} from './hooks';

export interface ActivityChannelMap {

	'os/toast-requested': {
		message: string;
		action?: { label: string; onClick: () => void };
		duration?: number;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};

	'os/toast-shown': {
		message: string;
		action?: { label: string; onClick: () => void };
		duration?: number;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};

	'os/notification-requested': {
		title: string;
		body?: string;
		icon?: string;
		tag?: string;
		requireInteraction?: boolean;
		source?: string;
		meta?: Record< string, unknown >;
		cancel?: boolean;
	};

	'os/notification-shown': {
		title: string;
		body?: string;
		icon?: string;
		tag?: string;
		requireInteraction?: boolean;
		source?: string;
		meta?: Record< string, unknown >;
		fallback: 'toast' | null;
	};

	'os/window-attention-requested': {
		windowId: string;
		mode: 'pulse' | 'shake' | 'bounce' | null;
		durationMs?: number;
		intensity?: 'subtle' | 'normal' | 'strong';
		source?: string;
		cancel?: boolean;
	};

	'os/badge-changed': {
		itemId: string;
		count: number;

		rail: 'dock' | 'taskbar' | 'icon';
	};

	'os/open-requested': {
		windowId: string;
		source: string;
	};

	'os/presence-changed': {
		userId: number;
		oldStatus: 'online' | 'inactive' | 'offline' | null;
		newStatus: 'online' | 'inactive' | 'offline';
		lastSeenMs: number;
		lastActiveMs: number;
	};

	'os/presence-snapshot-applied': {
		applied: number;
		transitions: number;
	};

	'os/game-score-recorded': {
		game: string;
		score: number;
		meta: Record< string, string | number >;
		windowId: string;
		challengeId?: number;
	};

	'os/upload-hud-complete': {
		filename: string;
		attachmentId: number;
	};

	'os/request-settled': {
		url: string;
		method: string;
		status?: number;
		ok?: boolean;
		error?: string;
		aborted?: true;
		windowId: string | null;
		source?: string;
		silent: boolean;
	};

	[ key: `${ string }/${ string }` ]: unknown;
}

const HOOK_PREFIX = 'os.activity.';

function hookName< K extends keyof ActivityChannelMap >( channel: K ): string {
	return HOOK_PREFIX + String( channel ).replace( /[^a-zA-Z0-9_.-]/g, '.' );
}

let subscribeSeq = 0;

export interface ActivityApi {

	publish< K extends keyof ActivityChannelMap >(
		channel: K,
		payload?: ActivityChannelMap[ K ],
	): void;

	subscribe< K extends keyof ActivityChannelMap >(
		channel: K,
		cb: ( payload: ActivityChannelMap[ K ] ) => void,
	): () => void;

	filter< K extends keyof ActivityChannelMap >(
		channel: K,
		value: ActivityChannelMap[ K ],
		...args: unknown[]
	): ActivityChannelMap[ K ];
}

export const activity: ActivityApi = {
	publish( channel, payload ) {
		doAction( hookName( channel ), payload );
	},
	subscribe( channel, cb ) {
		const ns = `os/activity-sub/${ ++subscribeSeq }`;
		const hook = hookName( channel );
		addAction( hook, ns, ( payload: unknown ) =>
			( cb as ( p: unknown ) => void )( payload ),
		);
		let removed = false;
		return () => {
			if ( removed ) {
				return;
			}
			removed = true;
			removeAction( hook, ns );
		};
	},
	filter( channel, value, ...args ) {
		return applyFilters( hookName( channel ), value, ...args ) as typeof value;
	},
};
