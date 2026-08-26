/**
 * Window activity notifier — tells each iframe window when it gains
 * or loses focus.
 *
 * The chromeless bridge inside every iframe window uses the signal to
 * adapt its cadence to being backgrounded — today that means
 * stretching Core's Heartbeat to its 120 s maximum while the window
 * is unfocused (each iframe is a full wp-admin page whose 15 s editor
 * heartbeat otherwise keeps firing from windows the user isn't
 * looking at; Core's own visibility backoff only reacts to the TAB
 * being hidden, which a background desktop window never is).
 *
 * Transport: `{ type: 'os-window-active', active: boolean }` posted
 * to the window's iframe on the `os-window-focused` /
 * `os-window-blurred` document events. An `os-bridge-ready` ping —
 * sent by the bridge after every in-window navigation — re-seeds the
 * fresh document with its current state, so a background window that
 * navigates doesn't come back on the fast cadence.
 */
import type { WindowManager } from './window-manager';

export function installWindowActivityNotifier( manager: WindowManager ): void {
	const send = ( windowId: string, active: boolean ): void => {
		const win = manager.getById( windowId );
		if ( ! win || ! win.iframe || ! win.iframe.contentWindow ) {
			return;
		}
		try {
			win.iframe.contentWindow.postMessage(
				{ type: 'os-window-active', active },
				window.location.origin,
			);
		} catch {
			/* iframe mid-navigation — its os-bridge-ready re-seeds */
		}
	};

	document.addEventListener( 'os-window-focused', ( e: Event ) => {
		const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
		if ( detail && typeof detail.windowId === 'string' ) {
			send( detail.windowId, true );
		}
	} );

	document.addEventListener( 'os-window-blurred', ( e: Event ) => {
		const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
		if ( detail && typeof detail.windowId === 'string' ) {
			send( detail.windowId, false );
		}
	} );

	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== window.location.origin ) {
			return;
		}
		const data = e.data as { type?: string } | null;
		if ( ! data || data.type !== 'os-bridge-ready' ) {
			return;
		}
		const win = manager.findByIframeSource( e.source );
		if ( ! win ) {
			return;
		}
		send( win.id, manager.getFocused()?.id === win.id );
	} );
}
