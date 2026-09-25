/**
 * Boot-time `wp.os.fetch` implementation.
 *
 * The runtime side of the framework's tracked fetch. Plugin-side
 * code reaches the function through `wp.os.fetch`
 * (or the `trackedFetch` helper in `src/tracked-fetch.ts` which
 * looks the function up at runtime); this module owns the
 * implementation.
 *
 * Resolution order for "which window's title bar pulses":
 *   1. `opts.window`   — explicit Window reference.
 *   2. `opts.windowId` — id looked up via `manager.getById`.
 *   3. focused window  — `manager.getFocused()`.
 *
 * `opts.silent: true` skips the indicator entirely (used
 * internally by background polls — heartbeat, presence,
 * recycle-bin count).
 *
 * Returns the same Response Promise the native fetch would have,
 * so callers can `.then(r => r.json())` / `await` / catch
 * unchanged.
 *
 * Extracted from `src/desktop.ts` during the architecture-0.8.1
 * boot decomposition (phase 5).
 */

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
	/**
	 * Free-form attribution tag carried through to the activity
	 * bus (e.g. `'desktop-mode/files'`). Plugins building debug
	 * widgets can group requests by this label.
	 */
	source?: string;
}

export function trackedFetch(
	manager: WindowManager,
	input: RequestInfo | URL,
	requestInit?: RequestInit,
	opts?: TrackedFetchImplOpts,
): Promise< Response > {
	const finalInit = injectRestNonce( input, requestInit );
	// eslint-disable-next-line no-restricted-syntax -- this IS the framework fetch wrapper exposed as `wp.os.fetch`; it's the one legitimate place to call the raw global.
	const promise = window.fetch( input, finalInit );
	// Session-expiry fast path: a 401/403 through the framework
	// fetch asks Heartbeat for an auth verdict now instead of
	// waiting out the regular tick schedule. Observed on a side
	// branch — the caller's promise resolution is untouched, and
	// network-level rejections are not auth signals.
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
			/* rejection handled by the caller's own chain */
		},
	);
	// The window the caller named, if it is still open.
	let named: DesktopWindow | null = opts?.window ?? null;
	if ( ! named && opts?.windowId ) {
		named = manager.getById( opts.windowId ) ?? null;
	}
	const target = named ?? manager.getFocused() ?? null;
	// The activity-bus half of what this wrapper promises. The
	// window's activity PHASE is the ring in the title bar; this is
	// the broadcast a debug or audit widget subscribes to, and the
	// only place `opts.source` has ever had anywhere to go.
	//
	// Published for silent requests too: `silent` asks the chrome to
	// stay still, which is a different question from whether the
	// request happened. The flag rides along so a subscriber that
	// only wants foreground traffic can filter on it.
	//
	// The window a request is attributed to is the one whose ring it
	// moves. A silent request moves none, so it is attributed only to
	// a window the caller named: the focused one is just where the
	// user last clicked, and would claim every background poll.
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
		// Track but don't replace the original promise — callers
		// expect identical resolution semantics. `trackActivity`
		// attaches its own `.then`/`catch` without consuming the
		// rejection (it re-throws), so fire-and-forget here.
		//
		// What IS tracked is a derived promise, not this one: `fetch`
		// resolves normally for 4xx/5xx, so handing the raw promise to
		// the indicator paints the green "Saved" check (and announces
		// it to screen readers) for a response the server refused.
		// Rejecting on `! res.ok` settles the indicator as `failed`
		// with the status as its tooltip, while the caller still gets
		// `promise` untouched and does its own response handling.
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
				/* swallow — caller's await sees the real outcome */
			} );
	}
	return promise;
}

/**
 * The `os/request-settled` broadcast, off the hot path of the
 * caller's own chain.
 *
 * A network-level rejection carries no status and no `ok` — there
 * was no response — so those keys are left off rather than faked
 * as `0` / `false`, which a subscriber could not tell apart from a
 * server that really answered. A cancelled request is flagged
 * `aborted`, so a subscriber counting failures can leave out the
 * ones the caller called off itself (a search field aborts one per
 * keystroke).
 *
 * The whole body is wrapped because this runs on EVERY request the
 * shell makes. `publish` goes through `wp.hooks`, so it throws if
 * the global is missing, and it calls subscribers synchronously, so
 * a plugin's bad callback throws here too; building the payload
 * throws on a rejection value with no string form. Any of them would
 * surface as an unhandled rejection hanging off the caller's fetch —
 * an observability channel breaking the thing it observes. A failed
 * broadcast loses one bus event and nothing else.
 */
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
		/* a broken subscriber or payload does not get to fail the request */
	}
}

/**
 * A rejection's message. Read off the value rather than gated on
 * `instanceof Error`, because an abort rejects with a `DOMException`,
 * which is not an `Error` in every environment.
 */
function errorText( err: unknown ): string {
	const message = ( err as { message?: unknown } | null )?.message;
	return typeof message === 'string' ? message : String( err );
}

/**
 * Whether the caller cancelled the request rather than it failing.
 * The signal is the reliable answer: `abort( reason )` rejects with
 * the reason itself, not an `AbortError`.
 */
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

/**
 * Tooltip text for an HTTP error response. Includes the reason
 * phrase when the server sent one — "500 Internal Server Error"
 * says more than "500", and HTTP/2 responses carry no phrase at all.
 */
function httpErrorMessage( res: Response ): string {
	const status = res.statusText
		? `${ res.status } ${ res.statusText }`
		: String( res.status );
	/* translators: %s: HTTP status code, optionally followed by the reason phrase (e.g. "500 Internal Server Error"). */
	return sprintf( __( 'Request failed (HTTP %s).' ), status );
}
