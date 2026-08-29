/**
 * OpenStation — unsaved-changes guard for in-window navigation.
 *
 * ## The window that could not leave its loading overlay
 *
 * Re-pointing a window's iframe is optimistic: the shell arms the
 * loading overlay and lights the destination tab *before* the frame
 * has gone anywhere, because the alternative is a click that looks
 * like it did nothing for as long as the server takes to answer.
 *
 * That optimism is wrong exactly once — when the document inside is
 * holding unsaved changes. The browser puts its own "Leave site?"
 * prompt in front of the navigation, the user answers **Cancel**,
 * and nothing further ever happens: no `load`, no `os-ready`, no
 * second chance to correct the guess. The window keeps the spinner
 * and the wrong tab highlight for the rest of its life, over content
 * that never moved.
 *
 * There is no signal that says "the user cancelled" — a cancelled
 * navigation is the absence of every event, and the document stays
 * alive and running either way while the browser fetches (so a timer
 * cannot tell the two apart either). So the shell asks the question
 * *before* it commits:
 *
 *   1. **Query.** {@link queryUnsavedGuard} posts
 *      `os-bridge-beforeunload-query` with a `requestId` and waits
 *      for the correlated `os-bridge-beforeunload-response`. Both
 *      bridges answer it by synthesising a `beforeunload` event —
 *      the same machinery `Window.close()` has always used to decide
 *      whether to raise its confirm dialog.
 *   2. **No guard** (the overwhelmingly common case) — commit and
 *      navigate, byte for byte the behaviour that was there before.
 *   3. **Guard armed** — navigate, but *withhold* the overlay and
 *      the tab highlight. A prompt is coming and its answer decides.
 *      Cancel leaves the window exactly as the user left it, which
 *      is the whole point. Leave produces a real unload, the iframe
 *      reports it as `os-iframe-unloading`, and the withheld commit
 *      runs then — late by the length of one request, which is the
 *      honest price of not being able to un-ring the bell.
 *
 * The shell deliberately does NOT raise its own dialog here the way
 * `close()` does. `close()` can: after `destroy()` the iframe is
 * removed from the DOM, and removal discards a document without
 * prompting. A navigation has no such exit — the native prompt fires
 * whatever we do, so a shell dialog in front of it would ask the
 * same question twice.
 */

import {
	UNSAVED_GUARD_COMMIT_WINDOW_MS,
	UNSAVED_GUARD_QUERY_TIMEOUT_MS,
} from './constants';
import type { Window } from './index';

/**
 * Monotonic counter behind the correlation id. Paired with a
 * timestamp so ids stay unique across a page that reloads its shell
 * bundle without reloading the document.
 */
let queryCounter = 0;

/**
 * The narrow slice of the DOM `Window` this module talks to. Named
 * apart from the shell's own {@link Window} class, which is what
 * `Window` means everywhere else in this folder.
 */
type ContentWindow = {
	postMessage( message: unknown, targetOrigin: string ): void;
};

/**
 * Ask the document inside an iframe whether anything would stop it
 * being navigated away from — `window.onbeforeunload`, or any
 * `beforeunload` listener that sets `returnValue` / calls
 * `preventDefault()`.
 *
 * Never rejects. Resolves `false` (nothing is holding on) for a
 * frame with no content window, a bridge that does not answer in
 * time, and a `postMessage` that throws — every one of which means
 * "carry on as if this guard did not exist".
 *
 * @param frame               The iframe to ask. Structural rather than
 *                            `HTMLIFrameElement` so tests can pass a stub.
 * @param frame.contentWindow The frame's content window — the only
 *                            member read.
 * @param opts                Options bag.
 * @param opts.timeoutMs      How long to wait for the answer.
 */
export function queryUnsavedGuard(
	frame: { contentWindow?: ContentWindow | null } | null | undefined,
	{
		timeoutMs = UNSAVED_GUARD_QUERY_TIMEOUT_MS,
	}: { timeoutMs?: number } = {},
): Promise< boolean > {
	const target = frame?.contentWindow;
	if ( ! target ) {
		return Promise.resolve( false );
	}

	queryCounter += 1;
	const requestId = `os-unsaved-guard-${ Date.now() }-${ queryCounter }`;

	return new Promise< boolean >( ( resolve ) => {
		let timer: number | null = null;
		let settled = false;

		const finish = ( prevented: boolean ): void => {
			if ( settled ) {
				return;
			}
			settled = true;
			window.removeEventListener( 'message', onMessage );
			if ( timer !== null ) {
				window.clearTimeout( timer );
			}
			resolve( prevented );
		};

		const onMessage = ( ev: MessageEvent ): void => {
			if ( ev.origin !== window.location.origin ) {
				return;
			}
			const data = ev?.data as {
				type?: unknown;
				requestId?: unknown;
				prevent?: unknown;
			} | null;
			if (
				! data ||
				typeof data !== 'object' ||
				data.type !== 'os-bridge-beforeunload-response' ||
				data.requestId !== requestId
			) {
				return;
			}
			finish( data.prevent === true );
		};

		window.addEventListener( 'message', onMessage );
		timer = window.setTimeout(
			() => finish( false ),
			timeoutMs,
		) as unknown as number;

		try {
			target.postMessage(
				{ type: 'os-bridge-beforeunload-query', requestId },
				window.location.origin,
			);
		} catch {
			finish( false );
		}
	} );
}

/**
 * Run an in-window navigation without stranding the window if the
 * page inside refuses to leave.
 *
 * `commit` is the optimistic paint — arm the loading overlay, light
 * the destination tab — and `navigate` is the act itself. On a page
 * with nothing to lose they run back to back, synchronously enough
 * that the user cannot tell a query happened. On a page holding
 * unsaved changes only `navigate` runs; `commit` is handed to the
 * window and released when (if) the frame reports it really left.
 *
 * @param win               The window being navigated.
 * @param handlers          The two halves of the navigation.
 * @param handlers.commit   Paints the pending navigation.
 * @param handlers.navigate Re-points the frame.
 */
export function navigateWithUnsavedGuard(
	win: Window,
	{ commit, navigate }: { commit: () => void; navigate: () => void },
): void {
	// A frame whose bridge has never announced itself cannot answer,
	// and waiting on it would put the query timeout in front of every
	// navigation in a bridge-less window. Behave exactly as the shell
	// did before the guard existed.
	if ( ! win._iframeBridgeReady || ! win.iframe ) {
		commit();
		navigate();
		return;
	}

	win._unsavedGuardPending = true;
	void queryUnsavedGuard( win.iframe ).then( ( prevented ) => {
		win._unsavedGuardPending = false;
		if ( win._isDestroyed ) {
			return;
		}
		if ( ! prevented ) {
			commit();
			navigate();
			return;
		}
		win._deferNavigationCommit( commit, UNSAVED_GUARD_COMMIT_WINDOW_MS );
		navigate();
	} );
}
