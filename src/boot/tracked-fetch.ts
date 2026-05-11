/**
 * Boot-time `wp.desktop.fetch` implementation.
 *
 * The runtime side of the framework's tracked fetch. Plugin-side
 * code reaches the function through `wp.desktop.fetch`
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
 *
 * @since 0.8.1
 */

import type { WindowManager } from '../window-manager';
import type { Window as DesktopWindow } from '../window';
import { injectRestNonce } from '../inject-rest-nonce';

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

/**
 * @since 0.8.1 (extracted from desktop.ts)
 */
export function trackedFetch(
	manager: WindowManager,
	input: RequestInfo | URL,
	requestInit?: RequestInit,
	opts?: TrackedFetchImplOpts,
): Promise< Response > {
	const finalInit = injectRestNonce( input, requestInit );
	// eslint-disable-next-line no-restricted-syntax -- this IS the framework fetch wrapper exposed as `wp.desktop.fetch`; it's the one legitimate place to call the raw global.
	const promise = window.fetch( input, finalInit );
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
