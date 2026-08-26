/**
 * Focus Timer — a thin, typed accessor over the slice of OpenStation's
 * public runtime API this widget uses: the window manager, to list open
 * windows for the "link a window" picker and to shake the linked one
 * when time is up.
 *
 * A widget bundle talks to the shell through the `window.wp.os`
 * runtime global rather than importing the shell's singletons directly,
 * so it stays decoupled from build-time internals.
 */

/** A live open window, as exposed by the window manager. */
export interface DesktopWindow {
	readonly id: string;
	readonly config: { title?: string; icon?: string; url?: string };
	readonly element: HTMLElement;
	/** Public attention nudge — a short horizontal shake. */
	shake?(): void;
}

interface WindowManager {
	getAll(): DesktopWindow[];
	getById( id: string ): DesktopWindow | undefined;
}

interface DesktopApi {
	windowManager?: WindowManager;
	showToast?( opts: { message: string; type?: string } ): unknown;
}

function desktopApi(): DesktopApi | undefined {
	return ( window as unknown as { wp?: { os?: DesktopApi } } ).wp
		?.os;
}

/** All open windows, in the window manager's own order. */
export function listWindows(): DesktopWindow[] {
	try {
		return desktopApi()?.windowManager?.getAll() ?? [];
	} catch {
		return [];
	}
}

export function getWindow( id: string ): DesktopWindow | undefined {
	try {
		return desktopApi()?.windowManager?.getById( id );
	} catch {
		return undefined;
	}
}

/**
 * Shake a window by id. Returns true if the window existed and a shake
 * was requested. Silently no-ops when the window is gone (the user
 * closed the linked window) or the runtime predates `Window.shake()`.
 */
export function shakeWindow( id: string ): boolean {
	const win = getWindow( id );
	if ( ! win || typeof win.shake !== 'function' ) {
		return false;
	}
	win.shake();
	return true;
}

/** Show a transient toast via the shell (no-op if unavailable). */
export function toast( message: string ): void {
	desktopApi()?.showToast?.( { message } );
}
