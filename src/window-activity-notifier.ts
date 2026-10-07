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
