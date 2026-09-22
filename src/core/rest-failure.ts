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
 * A structured hint from the server becomes an action rather than
 * prose: `data.settings_tab` (the shape the AI Copilot route already
 * sends) turns into an "Open Preferences" button on the toast.
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
	/** Which class of failure produced it. */
	kind: RestFailureKind;
	/** Toast type: an unreadable reply or a dropped connection is a warning, a refusal an error. */
	type: 'error' | 'warning';
	/** A way to the fix, when the server named one as data. */
	action?: { label: string; onClick: () => void };
}

export interface DescribeRestFailureOptions {
	/**
	 * The line the surface shows when nothing better is known — its
	 * existing generic string, so migrating a call never loses a
	 * message it had. Also the sentence a 5xx or a message-less
	 * refusal is built on.
	 */
	fallback: string;
}

/** The matching `RestError` code WordPress sends for a dead nonce. */
const INVALID_NONCE_CODE = 'rest_cookie_invalid_nonce';

/**
 * The console-line prefix the feature clients have always written:
 * `[openstation] files REST 403: openstation_files_forbidden …`. A
 * `RestError` carries the human part as `serverMessage`; a plain
 * `Error` shaped like this (older code, test doubles) gets the prefix
 * and the code slug stripped instead.
 */
const CONSOLE_PREFIX = /^\[openstation\] [\w-]+ REST \d+:\s*/;
const ERROR_CODE_SLUG = /^[a-z0-9]+(?:_[a-z0-9]+)+\s+/;

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
 * the server's `WP_Error` message when there is one, else `''`.
 *
 * Callers that prefix their own verb ("Could not invite: %s") use
 * this; callers that want a whole sentence use
 * {@link describeRestFailure}.
 */
export function restFailureText( err: unknown ): string {
	if ( isRestError( err ) ) {
		return err.serverMessage;
	}
	if ( err instanceof Error && CONSOLE_PREFIX.test( err.message ) ) {
		return err.message
			.replace( CONSOLE_PREFIX, '' )
			.replace( ERROR_CODE_SLUG, '' )
			.trim();
	}
	if ( isOffline( err ) ) {
		return __( 'Could not reach the site. Check your connection and try again.', 'desktop-mode' );
	}
	return err instanceof Error ? err.message : '';
}

/**
 * The Preferences opener the shell publishes, if this bundle runs
 * inside the shell. A settings hint with no opener is not an action.
 */
function settingsOpener(): ( ( opts: { tabId: string } ) => void ) | null {
	const os = ( window as { wp?: { os?: { openOsSettings?: unknown } } } ).wp?.os;
	return typeof os?.openOsSettings === 'function'
		? ( os.openOsSettings as ( opts: { tabId: string } ) => void )
		: null;
}

/** `data.settings_tab` from the error body, when it is a non-empty string. */
function settingsTabOf( err: RestError ): string {
	const data = err.data as { settings_tab?: unknown } | undefined;
	return typeof data?.settings_tab === 'string' ? data.settings_tab : '';
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
	const { fallback } = options;
	const kind = restFailureKind( err );

	switch ( kind ) {
		case 'offline':
			return {
				kind,
				type: 'warning',
				message: __(
					'Could not reach the site. Check your connection and try again.',
					'desktop-mode',
				),
			};
		case 'session':
			return {
				kind,
				type: 'error',
				message: __(
					'Your session has expired. Reload the page and try again.',
					'desktop-mode',
				),
			};
		case 'unreadable':
			return {
				kind,
				type: 'warning',
				message: __(
					'The site sent an unreadable reply. Reload the page to check whether the change went through.',
					'desktop-mode',
				),
			};
		case 'gone':
		case 'refused':
		case 'server':
			break;
		case 'unknown':
		default: {
			const text = restFailureText( err );
			return { kind, type: 'error', message: text || fallback };
		}
	}

	// A RestError with a status. The server's own words first.
	const error = err as RestError;
	const description: RestFailureDescription = {
		kind,
		type: 'error',
		message: '',
	};
	if ( error.serverMessage ) {
		description.message = error.serverMessage;
	} else if ( kind === 'gone' ) {
		description.message = sprintf(
			/* translators: %s: the surface's own line, e.g. "Could not restore the note." */
			__( '%s It no longer exists. Reload the page to catch up.', 'desktop-mode' ),
			fallback,
		);
	} else if ( kind === 'server' ) {
		description.message = sprintf(
			/* translators: 1: the surface's own line, e.g. "Could not restore the note." 2: HTTP status code. */
			__( '%1$s The server answered with error %2$d.', 'desktop-mode' ),
			fallback,
			error.status,
		);
	} else {
		description.message = sprintf(
			/* translators: 1: the surface's own line, e.g. "Could not restore the note." 2: HTTP status code. */
			__( '%1$s The server refused the request (HTTP %2$d).', 'desktop-mode' ),
			fallback,
			error.status,
		);
	}

	const tabId = settingsTabOf( error );
	const open = tabId ? settingsOpener() : null;
	if ( tabId && open ) {
		description.action = {
			label: __( 'Open Preferences', 'desktop-mode' ),
			onClick: () => open( { tabId } ),
		};
	}
	return description;
}
