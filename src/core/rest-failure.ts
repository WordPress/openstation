/**
 * What to tell the user when a request failed.
 *
 * Every feature REST client throws a `RestError` (`./api-client`) that
 * carries the status, the `WP_Error` code and the server's own message.
 * This module turns that error into a sentence, once, so a surface never
 * has to choose between one generic line for every failure and its own
 * copy of the same status switch.
 *
 * The order of preference, and why:
 *
 * 1. **The server's message wins for a refusal.** A `WP_Error` message
 *    from our routes or Core's is already localized and already names
 *    the object ("Only the note owner can change it.", "Sorry, you are
 *    not allowed to do that."). Nothing the client could write knows
 *    more.
 * 2. **The client adds a line only for what the server cannot say**: the
 *    request never arrived (offline), the reply was not the route's
 *    JSON (unreadable), the nonce died (expired session). Those have no
 *    server message worth showing.
 * 3. **Otherwise the caller's own generic line, plus the status**, so a
 *    500 with a stack-trace fragment for a body still ends as words.
 *
 * Two things this module does NOT do. It does not decide whether to
 * show anything: a background poller keeps its silence by not calling
 * it. And it does not replace the shell-wide reactions to a failure —
 * the window's activity indicator already turns red on any failed
 * tracked request, and any 401/403 already accelerates the auth probe
 * that raises Core's login modal when the session really is gone
 * (`src/boot/tracked-fetch.ts`). The "session expired" line here is
 * the courtesy explanation next to that mechanism, not the mechanism.
 */

import { __, sprintf } from '../i18n';
import { isRestError, type RestError } from './api-client';
import type { ToastOptions } from '../toast';

/** Which class of failure a request ended in. */
export type RestFailureKind =
	/** `fetch()` rejected: offline, DNS, a blocked request. */
	| 'offline'
	/** 401, or the `rest_cookie_invalid_nonce` 403: the login is gone. */
	| 'session'
	/** A 2xx whose body was empty or not JSON. */
	| 'unreadable'
	/** 404: the object is not there any more. */
	| 'gone'
	/** Any other 4xx: the server said no. */
	| 'refused'
	/** 5xx: the server broke. */
	| 'server'
	/** Not a request failure at all, or nothing known about it. */
	| 'unknown';

export interface RestFailureDescription {
	/** The sentence to show. */
	message: string;
	/**
	 * The cause on its own, without the caller's line: the server's
	 * message, the offline / session / unreadable line, or the status
	 * sentence. `''` when nothing is known. For callers that compose
	 * their own summary around it.
	 */
	reason: string;
	/** Which class of failure produced it. */
	kind: RestFailureKind;
	/** Toast type: an unreadable reply or a dropped connection is a warning, a refusal an error. */
	type: 'error' | 'warning';
}

export interface DescribeRestFailureOptions {
	/**
	 * The line the surface shows when nothing better is known — its
	 * existing generic string, so migrating a call never loses a
	 * message it had. Also the sentence a 5xx or a message-less
	 * refusal is built on.
	 */
	fallback: string;
	/**
	 * A verb to put in front of the reason, for a surface with several
	 * actions where the reason alone would not say which one failed:
	 * `lead: 'Could not revoke'` reads "Could not revoke: Sorry, you are
	 * not allowed to do that." With no reason known, `fallback` shows
	 * instead, so the colon never dangles.
	 */
	lead?: string;
}

/** The matching `RestError` code WordPress sends for a dead nonce. */
const INVALID_NONCE_CODE = 'rest_cookie_invalid_nonce';

const offlineMessage = (): string =>
	__( 'Could not reach the site. Check your connection and try again.', 'desktop-mode' );

/**
 * `fetch()` rejects with a `TypeError` when the request never got an
 * answer. Also true when the browser says it is offline, whatever the
 * error was.
 */
export function isOffline( err: unknown ): boolean {
	if ( typeof navigator !== 'undefined' && navigator.onLine === false ) {
		return true;
	}
	return err instanceof TypeError;
}

/** Which class of failure this error is. */
export function restFailureKind( err: unknown ): RestFailureKind {
	if ( isRestError( err ) ) {
		if ( err.code === INVALID_NONCE_CODE || err.status === 401 ) {
			return 'session';
		}
		if ( err.status >= 200 && err.status < 300 ) {
			return 'unreadable';
		}
		if ( err.status === 404 ) {
			return 'gone';
		}
		if ( err.status >= 500 ) {
			return 'server';
		}
		if ( err.status >= 400 ) {
			return 'refused';
		}
		return 'unknown';
	}
	if ( isOffline( err ) ) {
		return 'offline';
	}
	return 'unknown';
}

/**
 * The human part of a failure, with no sentence of our own around it:
 * the server's `WP_Error` message when there is one, the offline line
 * when the request never arrived, else `''`.
 *
 * For a caller that composes a summary of its own (a count of items
 * moved, then the first reason). A caller that wants a whole sentence
 * uses {@link describeRestFailure}.
 */
export function restFailureText( err: unknown ): string {
	if ( isRestError( err ) ) {
		return err.serverMessage;
	}
	if ( isOffline( err ) ) {
		return offlineMessage();
	}
	return err instanceof Error ? err.message : '';
}

/**
 * Turn a failed request into what to say.
 *
 * ```ts
 * showToast( describeRestFailure( err, {
 *     fallback: __( 'Could not move the note to the Trash.' ),
 * } ) );
 * ```
 */
export function describeRestFailure(
	err: unknown,
	options: DescribeRestFailureOptions,
): RestFailureDescription {
	const { fallback, lead } = options;
	const kind = restFailureKind( err );
	const type: RestFailureDescription[ 'type' ] =
		kind === 'offline' || kind === 'unreadable' ? 'warning' : 'error';

	// The cause on its own, and whether it stands as the whole message
	// or wants the caller's line in front of it.
	let reason = '';
	let standsAlone = true;
	switch ( kind ) {
		case 'offline':
			reason = offlineMessage();
			break;
		case 'session':
			reason = __( 'Your session has expired. Reload the page and try again.', 'desktop-mode' );
			break;
		case 'unreadable':
			reason = __(
				'The site sent an unreadable reply. Reload the page to check whether the change went through.',
				'desktop-mode',
			);
			break;
		case 'gone':
		case 'refused':
		case 'server': {
			const error = err as RestError;
			if ( error.serverMessage ) {
				reason = error.serverMessage;
			} else if ( kind === 'gone' ) {
				reason = __( 'It no longer exists. Reload the page to catch up.', 'desktop-mode' );
				standsAlone = false;
			} else if ( kind === 'server' ) {
				reason = sprintf(
					/* translators: %d: HTTP status code. */
					__( 'The server answered with error %d.', 'desktop-mode' ),
					error.status,
				);
				standsAlone = false;
			} else {
				reason = sprintf(
					/* translators: %d: HTTP status code. */
					__( 'The server refused the request (HTTP %d).', 'desktop-mode' ),
					error.status,
				);
				standsAlone = false;
			}
			break;
		}
		case 'unknown':
		default:
			reason = restFailureText( err );
			break;
	}

	let message: string;
	if ( lead ) {
		message = reason ? `${ lead }: ${ reason }` : fallback;
	} else if ( ! reason ) {
		message = fallback;
	} else if ( standsAlone ) {
		message = reason;
	} else {
		message = `${ fallback } ${ reason }`;
	}
	return { message, reason, kind, type };
}

/**
 * Show a failed request as a toast through whatever `showToast` the
 * caller has — the app runtime's `ctx.host.toast`, the shell's own —
 * and do nothing when it has none.
 */
export function toastRestFailure(
	toast: ( ( toastOptions: ToastOptions ) => unknown ) | undefined,
	err: unknown,
	options: DescribeRestFailureOptions & { duration?: number },
): void {
	if ( ! toast ) {
		return;
	}
	const { duration, ...describe } = options;
	const failure = describeRestFailure( err, describe );
	const toastOptions: ToastOptions = { message: failure.message, type: failure.type };
	if ( duration ) {
		toastOptions.duration = duration;
	}
	toast( toastOptions );
}
