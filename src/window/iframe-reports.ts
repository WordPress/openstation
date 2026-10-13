/**
 * Relay of the chromeless bridge's error and network reports.
 *
 * The chromeless bridge wraps `fetch` / `XMLHttpRequest` and listens
 * for `error` / `unhandledrejection` inside every admin page the shell
 * frames, posting `os-iframe-network` and `os-iframe-error` to the
 * parent. Two kinds of frame carry such a page:
 *
 *   - an iframe window's own `Window.iframe` (`src/window/iframe-bridge.ts`);
 *   - an admin page embedded in a NATIVE window's body — an
 *     `iframeContent` window, or `embedAdminPage()` (the Posts app's
 *     editor tab) — whose `Window.iframe` is null
 *     (`src/native-windows.ts`).
 *
 * Both hand verified messages (same origin, from their own frame) to
 * {@link relayIframeReport}, so the two paths dispatch the same hooks
 * with the same payloads. Before the native path called it, an
 * embedded page's reports were dropped: the block editor's REST,
 * autosave and Heartbeat traffic and its JavaScript errors never
 * reached `os.iframe.network-completed` / `os.iframe.error`.
 */

import { doAction, HOOKS } from '../hooks';

/**
 * Dispatch the hook for a bridge report, annotated with the owning
 * window. The caller has already checked the message's origin and
 * source.
 *
 * @param windowId Window the reporting frame belongs to.
 * @param data     The message's `data`.
 * @return Whether `data` was a report (and a hook fired).
 */
export function relayIframeReport( windowId: string, data: unknown ): boolean {
	if ( ! data || typeof data !== 'object' ) {
		return false;
	}
	const d = data as Record< string, unknown >;

	// `os-iframe-error` from inside the page's error +
	// unhandledrejection handlers. Shape matches `HOOKS.IFRAME_ERROR`.
	if ( d.type === 'os-iframe-error' ) {
		doAction( HOOKS.IFRAME_ERROR, {
			windowId,
			kind: d.kind === 'unhandledrejection' ? 'unhandledrejection' : 'error',
			message: typeof d.message === 'string' ? d.message : '',
			filename: typeof d.filename === 'string' ? d.filename : null,
			lineno: typeof d.lineno === 'number' ? d.lineno : null,
			colno: typeof d.colno === 'number' ? d.colno : null,
			stack: typeof d.stack === 'string' ? d.stack : null,
		} );
		return true;
	}

	// Network completion from the fetch + XHR wrappers. Every completed
	// call (success or failure) fires here. `status === 0` is a
	// network-level failure before a response arrived; `failed` is
	// pre-computed inside the page so subscribers don't re-derive the
	// success / 4xx / 5xx / network boundary.
	if ( d.type === 'os-iframe-network' ) {
		const payload: Record< string, unknown > = {
			windowId,
			method: typeof d.method === 'string' ? d.method : 'GET',
			url: typeof d.url === 'string' ? d.url : '',
			status: typeof d.status === 'number' ? d.status : 0,
			duration: typeof d.duration === 'number' ? d.duration : 0,
			failed: !! d.failed,
		};
		// `requestHeaders` / `responseHeaders` only ride along when
		// devtools have asked the page to observe (via
		// `wp.os.devtools.onRequest( id, cb, { observe: true } )`).
		// Default deliveries stay summary-only for privacy.
		if ( d.requestHeaders && typeof d.requestHeaders === 'object' ) {
			payload.requestHeaders = d.requestHeaders;
		}
		if ( d.responseHeaders && typeof d.responseHeaders === 'object' ) {
			payload.responseHeaders = d.responseHeaders;
		}
		doAction( HOOKS.IFRAME_NETWORK_COMPLETED, payload );
		return true;
	}

	return false;
}
