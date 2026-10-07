import { activity } from '../activity';
import { showToast } from '../toast';
import { updatePwaState } from './state';

export interface NotifyOptions {

	title: string;

	body?: string;

	icon?: string;

	tag?: string;

	requireInteraction?: boolean;

	onClick?: ( notification: Notification ) => void;

	meta?: Record< string, unknown >;
}

export interface NotifyIntent extends NotifyOptions {

	source?: string;

	cancel?: boolean;
}

export function notify( options: NotifyOptions ): () => void {
	const intent: NotifyIntent = activity.filter(
		'os/notification-requested',
		{ ...options },
	) as NotifyIntent;

	if ( ! intent || intent.cancel === true || ! intent.title ) {
		return () => undefined;
	}

	let dismissed = false;
	let dismissNative: ( () => void ) | null = null;
	let dismissToast: ( () => void ) | null = null;

	const dismiss = (): void => {
		if ( dismissed ) {
			return;
		}
		dismissed = true;
		if ( dismissNative ) {
			dismissNative();
		}
		if ( dismissToast ) {
			dismissToast();
		}
	};

	const fallback = (): void => {
		dismissToast = showToast( {
			message: intent.body
				? intent.title + ' — ' + intent.body
				: intent.title,
		} );
		activity.publish( 'os/notification-shown', {
			...intent,
			fallback: 'toast',
		} );
	};

	if ( typeof window === 'undefined' || typeof Notification === 'undefined' ) {
		fallback();
		return dismiss;
	}

	const perm = Notification.permission;
	if ( perm === 'granted' ) {
		dismissNative = renderNative( intent );
		if ( ! dismissNative ) {
			fallback();
		}
		return dismiss;
	}
	if ( perm === 'denied' ) {
		fallback();
		return dismiss;
	}

	void Notification.requestPermission().then( ( result ) => {
		if ( dismissed ) {
			return;
		}
		if ( result === 'granted' ) {
			updatePwaState( { notificationsEnabled: true } );
			dismissNative = renderNative( intent );
			if ( ! dismissNative ) {
				fallback();
			}
			return;
		}
		fallback();
	} );

	return dismiss;
}

function renderNative( intent: NotifyIntent ): ( () => void ) | null {
	let n: Notification | null = null;
	try {
		n = new Notification( intent.title, {
			body: intent.body,
			icon: intent.icon,
			tag: intent.tag,
			requireInteraction: intent.requireInteraction,
		} );
	} catch ( err ) {
		if ( typeof console !== 'undefined' ) {
			console.warn( '[openstation] Notification ctor threw:', err );
		}
		return null;
	}

	if ( intent.onClick ) {
		const handler = intent.onClick;
		n.onclick = () => {
			try {
				handler( n as Notification );
			} catch ( hErr ) {
				if ( typeof console !== 'undefined' ) {
					console.error(
						'[openstation] notification onClick threw:',
						hErr,
					);
				}
			}
		};
	}

	activity.publish( 'os/notification-shown', {
		...intent,
		fallback: null,
	} );

	return () => {
		if ( n ) {
			n.close();
		}
	};
}

export async function requestNotificationPermission(): Promise<
	'granted' | 'denied' | 'default' | 'unsupported'
	> {
	if ( typeof Notification === 'undefined' ) {
		return 'unsupported';
	}
	if ( Notification.permission !== 'default' ) {
		return Notification.permission;
	}
	const result = await Notification.requestPermission();
	if ( result === 'granted' ) {
		updatePwaState( { notificationsEnabled: true } );
	}
	return result;
}

export function getNotificationPermission():
	| 'granted'
	| 'denied'
	| 'default'
	| 'unsupported' {
	if ( typeof Notification === 'undefined' ) {
		return 'unsupported';
	}
	return Notification.permission;
}
