import type { WindowManager } from '../window-manager';
import type { Window as DesktopWindow } from '../window';
import { injectRestNonce } from '../inject-rest-nonce';
import { noteAuthFailure } from '../auth-recovery';
import { activity } from '../activity';
import type { ActivityChannelMap } from '../activity';
import { __, sprintf } from '../i18n';

export interface TrackedFetchImplOpts {
	windowId?: string;
	window?: DesktopWindow;
	silent?: boolean;

	source?: string;
}

export function trackedFetch(
	manager: WindowManager,
	input: RequestInfo | URL,
	requestInit?: RequestInit,
	opts?: TrackedFetchImplOpts,
): Promise< Response > {
	const finalInit = injectRestNonce( input, requestInit );

	const promise = window.fetch( input, finalInit );

	void promise.then(
		( res ) => {
			if ( res.status === 401 || res.status === 403 ) {
				let url: string;
				if ( typeof input === 'string' ) {
					url = input;
				} else if ( input instanceof URL ) {
					url = input.href;
				} else {
					url = input.url;
				}
				noteAuthFailure( res.status, url );
			}
		},
		() => {

		},
	);

	let named: DesktopWindow | null = opts?.window ?? null;
	if ( ! named && opts?.windowId ) {
		named = manager.getById( opts.windowId ) ?? null;
	}
	const target = named ?? manager.getFocused() ?? null;

	const attributed = named ?? ( opts?.silent ? null : target );
	void promise.then(
		( res ) => publishSettled( input, finalInit, opts, attributed, { res } ),
		( err: unknown ) =>
			publishSettled( input, finalInit, opts, attributed, { err } ),
	);
	if ( opts?.silent ) {
		return promise;
	}
	if ( target && typeof target.trackActivity === 'function' ) {
		void target
			.trackActivity(
				promise.then( ( res ) => {
					if ( ! res.ok ) {
						throw new Error( httpErrorMessage( res ) );
					}
					return res;
				} ),
			)
			.catch( () => {

			} );
	}
	return promise;
}

function publishSettled(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	opts: TrackedFetchImplOpts | undefined,
	target: DesktopWindow | null,
	outcome: { res: Response } | { err: unknown },
): void {
	try {
		let url: string;
		if ( typeof input === 'string' ) {
			url = input;
		} else if ( input instanceof URL ) {
			url = input.href;
		} else {
			url = input.url;
		}
		const method =
			init?.method ??
			( typeof input === 'object' && 'method' in input ? input.method : 'GET' );
		const base = {
			url,
			method: String( method || 'GET' ).toUpperCase(),
			windowId: target?.id ?? null,
			silent: opts?.silent === true,
			...( opts?.source ? { source: opts.source } : {} ),
		};
		let payload: ActivityChannelMap[ 'os/request-settled' ];
		if ( 'res' in outcome ) {
			payload = { ...base, status: outcome.res.status, ok: outcome.res.ok };
		} else {
			payload = { ...base, error: errorText( outcome.err ) };
			if ( wasAborted( input, init, outcome.err ) ) {
				payload.aborted = true;
			}
		}
		activity.publish( 'os/request-settled', payload );
	} catch {

	}
}

function errorText( err: unknown ): string {
	const message = ( err as { message?: unknown } | null )?.message;
	return typeof message === 'string' ? message : String( err );
}

function wasAborted(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	err: unknown,
): boolean {
	if ( init?.signal?.aborted ) {
		return true;
	}
	if ( input instanceof Request && input.signal?.aborted ) {
		return true;
	}
	return ( err as { name?: unknown } | null )?.name === 'AbortError';
}

function httpErrorMessage( res: Response ): string {
	const status = res.statusText
		? `${ res.status } ${ res.statusText }`
		: String( res.status );

	return sprintf( __( 'Request failed (HTTP %s).' ), status );
}
