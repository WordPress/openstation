import { __, sprintf } from '../i18n';
import { isRestError, type RestError } from './api-client';
import type { ToastOptions } from '../toast';

export type RestFailureKind =

	| 'offline'

	| 'session'

	| 'unreadable'

	| 'gone'

	| 'refused'

	| 'server'

	| 'unknown';

export interface RestFailureDescription {

	message: string;

	reason: string;

	kind: RestFailureKind;

	type: 'error' | 'warning';
}

export interface DescribeRestFailureOptions {

	fallback: string;

	lead?: string;
}

const INVALID_NONCE_CODE = 'rest_cookie_invalid_nonce';

const offlineMessage = (): string =>
	__( 'Could not reach the site. Check your connection and try again.', 'desktop-mode' );

export function isOffline( err: unknown ): boolean {
	if ( typeof navigator !== 'undefined' && navigator.onLine === false ) {
		return true;
	}
	return err instanceof TypeError;
}

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

export function restFailureText( err: unknown ): string {
	if ( isRestError( err ) ) {
		return err.serverMessage;
	}
	if ( isOffline( err ) ) {
		return offlineMessage();
	}
	return err instanceof Error ? err.message : '';
}

export function describeRestFailure(
	err: unknown,
	options: DescribeRestFailureOptions,
): RestFailureDescription {
	const { fallback, lead } = options;
	const kind = restFailureKind( err );
	const type: RestFailureDescription[ 'type' ] =
		kind === 'offline' || kind === 'unreadable' ? 'warning' : 'error';

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

					__( 'The server answered with error %d.', 'desktop-mode' ),
					error.status,
				);
				standsAlone = false;
			} else {
				reason = sprintf(

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
