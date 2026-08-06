/**
 * OpenStation — local notifications.
 *
 * `wp.os.notify( opts )` is the public surface for any plugin
 * that needs to ping the user with a notification. v1 uses the
 * browser's `Notification` API directly — no server round-trip, no
 * push subscription. The shape of `opts` is forward-compatible with
 * Web Push: when v2 lands, the same call routes through the SW
 * `showNotification` for visibility from a background tab.
 *
 * Design rules:
 *
 *   - **Permission is requested lazily.** The first `notify()` call
 *     prompts; subsequent calls reuse the answer. Plugins that need
 *     a pre-flight check can call `requestNotificationPermission()`
 *     at boot.
 *   - **A toast fallback runs on denial.** Plugins always get *some*
 *     visible signal even when permission is denied. Returning a
 *     dismiss function (same shape as `showToast`) means callers
 *     never have to branch on permission state in their own code.
 *   - **Activity bus parity with toast.** Mirrors
 *     `os/toast-requested` / `os/toast-shown` —
 *     plugins that want to mute, amplify, or audit notifications
 *     register a filter and get the same lifecycle they already
 *     know from the toast surface.
 */

import { activity } from '../activity';
import { showToast } from '../toast';
import { updatePwaState } from './state';

export interface NotifyOptions {
	/** Required headline. Becomes `Notification.title`. */
	title: string;
	/** Optional body line under the title. */
	body?: string;
	/** Optional absolute URL of an icon to show in the notification. */
	icon?: string;
	/**
	 * Replace-on-tag ID. Two notifications with the same `tag` collapse
	 * into one in the OS panel — useful for unread-count style alerts
	 * that should overwrite themselves rather than stack.
	 */
	tag?: string;
	/**
	 * When `true`, the notification stays until the user explicitly
	 * dismisses it (Chromium / Edge). Otherwise the OS auto-dismisses
	 * after its default timeout.
	 */
	requireInteraction?: boolean;
	/** Click handler. Receives the underlying `Notification` instance. */
	onClick?: ( notification: Notification ) => void;
	/** Free-form context — passed through the activity bus filter. */
	meta?: Record< string, unknown >;
}

/**
 * Activity-bus payload routed through `os/notification-requested`.
 * Plugins filter on this to mute/amplify/cancel.
 */
export interface NotifyIntent extends NotifyOptions {
	/**
	 * Originating app id for filter scoping. Convention: the plugin's
	 * Vite bundle / module slug. Optional — anonymous shell-internal
	 * notifications omit it.
	 */
	source?: string;
	/** Filter sets to `true` to suppress the notification. */
	cancel?: boolean;
}

/**
 * Show a notification. Returns a dismiss callback the caller can
 * invoke early.
 *
 * Behaviour matrix:
 *
 *   - permission `'granted'`     → real Notification, fire-and-forget;
 *                                  if the constructor throws (e.g. a
 *                                  gesture requirement) → toast fallback.
 *   - permission `'default'`     → ask + then `'granted'` path; on
 *                                  decline falls through to toast.
 *   - permission `'denied'`      → toast fallback.
 *   - no `Notification` support  → toast fallback.
 *
 * The activity bus is published in every branch so audit / telemetry
 * plugins see the same signal regardless of the rendered surface.
 */
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
		// Some browsers throw when calling `new Notification` directly
		// from a non-user gesture (e.g. Safari on iOS). Return `null`
		// so notify() falls back to the toast surface (which also
		// publishes `notification-shown` with `fallback: 'toast'`).
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

/**
 * Eagerly request permission. Resolves with the final state. Useful
 * for plugins that want to gate their own UI on whether notifications
 * will work, without firing a silent first notification just to find
 * out.
 */
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

/** Synchronous read of the current permission state. */
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
