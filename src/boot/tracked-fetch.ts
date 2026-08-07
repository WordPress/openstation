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
	if ( opts?.silent ) {
		return promise;
	}
	let target: DesktopWindow | null | undefined = opts?.window;
	if ( ! target && opts?.windowId ) {
		target = manager.getById( opts.windowId ) ?? null;
	}
	if ( ! target ) {
		target = manager.getFocused();
	}
	if ( target && typeof target.trackActivity === 'function' ) {
		// Track but don't replace the original promise — callers
		// expect identical resolution semantics. `trackActivity`
		// attaches its own `.then`/`catch` without consuming the
		// rejection (it re-throws), so fire-and-forget here.
		void target.trackActivity( promise ).catch( () => {
			/* swallow — caller's await sees the rejection */
		} );
	}
	return promise;
}
