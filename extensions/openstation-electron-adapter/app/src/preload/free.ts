/**
 * OpenStation Desktop — preload for a freed window.
 *
 * A freed window shows one of two things:
 *
 *   - a **chromeless admin page** (`?openstation_chromeless=1`) — the
 *     same document the in-shell iframe was showing;
 *   - a **solo shell** (`?openstation_solo=<id>`) — the OpenStation
 *     shell booted to paint exactly one window, used for native
 *     windows that have no admin URL of their own.
 *
 * Either way the page needs to know two things: that it is running
 * inside a freed native window (so it can stand down affordances that
 * only make sense on the OpenStation desk, and let the OS frame own
 * the window controls), and which window it is. That is the entire
 * surface here.
 *
 * It deliberately does NOT re-expose the shell bridge. A freed window
 * cannot free further windows: allowing it would turn one clear "this
 * window is out on the desktop" relationship into a tree nobody can
 * reason about, and the shell is the only side that knows how to dock
 * a window back.
 */

import { contextBridge, ipcRenderer } from 'electron';

import { CHANNELS, osLabelFor } from '../lib/protocol';

/** Window id, learned from the main process once the page has loaded. */
let windowId = '';
/** Callbacks waiting for that id. */
const waiting: Array< ( id: string ) => void > = [];

ipcRenderer.on(
	CHANNELS.EVENT_FRAME_INIT,
	( _event, payload: { windowId?: string } ) => {
		windowId = String( payload?.windowId || '' );
		while ( waiting.length ) {
			const cb = waiting.shift();
			try {
				cb?.( windowId );
			} catch ( err ) {
				console.error( '[openstation-desktop] frame-init listener threw:', err );
			}
		}
	},
);

/*
 * Claim this page as deliberately hosted.
 *
 * A chromeless admin page normally only exists inside an OpenStation
 * window iframe, so the chromeless bridge treats a *top-level* one as
 * an accident — a stale bookmark, a bad redirect — and rescues the
 * user by stripping the flag and reloading as classic admin. A freed
 * window is the one legitimate exception: it is top-level on purpose,
 * and closing the OS window is the way back, so it needs no rescue.
 *
 * Without this the freed window strips its own flag, reloads, bounces
 * through the portal, and paints a whole second OpenStation desktop
 * inside a window that was meant to hold one screen.
 *
 * Set from the preload so it lands before the page's own scripts, and
 * again on every in-window navigation — which a query flag could not
 * survive.
 */
contextBridge.exposeInMainWorld( 'openStationChromelessHost', true );

contextBridge.exposeInMainWorld( 'openStationDesktopFrame', {
	/** Presence of this object means "you are a freed native window". */
	isFreedWindow: true,

	/** 'darwin' | 'win32' | 'linux' | … */
	platform: process.platform,

	/** "Mac" / "Windows PC" / "Linux desktop". */
	osLabel: osLabelFor( process.platform ),

	/**
	 * The OpenStation window id this native window was freed from.
	 * Empty until the main process reports it — use `onReady` if you
	 * need it during boot.
	 *
	 * @return Window id, or '' before init.
	 */
	getWindowId: (): string => windowId,

	/**
	 * @param cb Called once the window id is known (immediately if it already is).
	 */
	onReady: ( cb: ( id: string ) => void ): void => {
		if ( windowId ) {
			cb( windowId );
			return;
		}
		waiting.push( cb );
	},
} );
