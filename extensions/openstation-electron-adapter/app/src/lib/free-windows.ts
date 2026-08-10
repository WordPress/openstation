/**
 * OpenStation Desktop — the freed-window registry.
 *
 * "Set it free" takes one window out of the OpenStation desk and gives
 * it to the real one. This module owns every native window created that
 * way, keyed by the OpenStation window id it came from, so the shell
 * and the OS never disagree about what is where:
 *
 *   - freeing a window that is already free focuses it instead of
 *     opening a second copy;
 *   - closing the native window docks it back into the shell (the
 *     shell is told, and un-minimizes its own copy);
 *   - quitting closes them all without firing a storm of dock-back
 *     messages at a renderer that is also going away.
 *
 * The window *factory* is injected. Not for ceremony: the registry's
 * job is bookkeeping — who is out, what happens when one closes, what
 * geometry it reopens at — and none of that needs a compositor to
 * verify. `tests/free-windows.test.ts` drives it with fakes.
 */

import type { Bounds, FreeWindowRequest, FreeWindowResult } from './protocol';

/** Bounds used when nothing better is known. */
export const DEFAULT_SIZE = { width: 1100, height: 760 };
/** Smallest a freed window may be dragged to. */
export const MIN_SIZE = { width: 420, height: 320 };

/**
 * The slice of Electron's `BrowserWindow` this registry uses. Narrow
 * on purpose — a fake in a test should be a few lines, not a mock of
 * the whole class.
 */
export interface FreeWindowHandle {
	isDestroyed(): boolean;
	isMinimized(): boolean;
	isFullScreen(): boolean;
	getBounds(): Bounds;
	restore(): void;
	focus(): void;
	close(): void;
	destroy(): void;
	on( event: string, listener: ( ...args: unknown[] ) => void ): unknown;
	once( event: string, listener: ( ...args: unknown[] ) => void ): unknown;
	setTitle( title: string ): void;
}

/** Options handed to the factory for one freed window. */
export interface CreateWindowOptions {
	windowId: string;
	url: string;
	title: string;
	width: number;
	height: number;
	x?: number;
	y?: number;
	minWidth: number;
	minHeight: number;
}

export interface FreeWindowsDeps {
	/** Creates and loads the native window. */
	createWindow: ( opts: CreateWindowOptions ) => FreeWindowHandle;
	/** Remembered geometry lookup. */
	getBounds: ( windowId: string ) => Bounds | null;
	/** Geometry persistence. */
	saveBounds: ( windowId: string, bounds: Bounds ) => void;
	/** Called with the window id when a freed window closes. */
	onDocked: ( windowId: string ) => void;
	/** Called with the window id once a freed window paints. */
	onFreed: ( windowId: string ) => void;
	/** Called on any user interaction with a freed window. */
	onActivity?: () => void;
	/** Rejects a URL the app must not open. */
	isAllowedUrl?: ( url: string ) => boolean;
}

export class FreeWindows {
	private readonly windows = new Map< string, FreeWindowHandle >();
	/** Set during app shutdown so close handlers stay quiet. */
	private quitting = false;

	/**
	 * @param deps Injected collaborators.
	 */
	constructor( private readonly deps: FreeWindowsDeps ) {}

	/** @return Ids of every currently freed window. */
	list(): string[] {
		return Array.from( this.windows.keys() );
	}

	/** @return Whether anything is freed right now. */
	any(): boolean {
		return this.windows.size > 0;
	}

	/**
	 * Free a window onto the desktop, or focus it if it already is.
	 *
	 * @param req Request from the shell.
	 * @return Result for the shell.
	 */
	free( req: Partial< FreeWindowRequest > ): FreeWindowResult {
		const windowId = String( req?.windowId || '' );
		const url = String( req?.url || '' );
		if ( ! windowId || ! url ) {
			return {
				ok: false,
				windowId,
				reused: false,
				error: 'windowId and url are required',
			};
		}
		// The preload already checked the scheme. Re-checking here is
		// not redundancy for its own sake: the page choosing this URL
		// is exactly the thing an attacker might have a foothold in,
		// and the main process is the last gate before a window opens.
		if ( this.deps.isAllowedUrl && ! this.deps.isAllowedUrl( url ) ) {
			return {
				ok: false,
				windowId,
				reused: false,
				error: 'url is not on the connected site',
			};
		}

		const existing = this.windows.get( windowId );
		if ( existing && ! existing.isDestroyed() ) {
			if ( existing.isMinimized() ) {
				existing.restore();
			}
			existing.focus();
			return { ok: true, windowId, reused: true };
		}

		const remembered = this.deps.getBounds( windowId );
		const width = Math.max(
			MIN_SIZE.width,
			Math.round( remembered?.width || req.width || DEFAULT_SIZE.width ),
		);
		const height = Math.max(
			MIN_SIZE.height,
			Math.round( remembered?.height || req.height || DEFAULT_SIZE.height ),
		);
		const title = String( req.title || 'OpenStation' );

		const win = this.deps.createWindow( {
			windowId,
			url,
			title,
			width,
			height,
			x: remembered?.x,
			y: remembered?.y,
			minWidth: MIN_SIZE.width,
			minHeight: MIN_SIZE.height,
		} );

		this.windows.set( windowId, win );

		// The page owns its own title — the admin screen sets it, and
		// in-window navigation changes it. Let it through rather than
		// pinning whatever we were handed at free time.
		win.on( 'page-title-updated', ( ...args: unknown[] ) => {
			const event = args[ 0 ] as { preventDefault?: () => void } | undefined;
			event?.preventDefault?.();
			win.setTitle( ( args[ 1 ] as string ) || title );
		} );

		const rememberBounds = () => {
			if ( ! win.isDestroyed() && ! win.isMinimized() && ! win.isFullScreen() ) {
				this.deps.saveBounds( windowId, win.getBounds() );
			}
		};
		win.on( 'resized', rememberBounds );
		win.on( 'moved', rememberBounds );
		win.on( 'focus', () => this.deps.onActivity?.() );

		win.once( 'ready-to-show', () => {
			this.deps.onFreed( windowId );
		} );

		win.on( 'closed', () => {
			this.windows.delete( windowId );
			if ( ! this.quitting ) {
				// Closing the native window is how you put it back.
				this.deps.onDocked( windowId );
			}
		} );

		return { ok: true, windowId, reused: false };
	}

	/**
	 * Dock a freed window back into the shell by closing it.
	 *
	 * A one-liner on purpose: the `closed` handler is what notifies the
	 * shell, so there is exactly one dock-back path whether the close
	 * came from this method or from the user hitting the OS close
	 * button.
	 *
	 * @param windowId OpenStation window id.
	 * @return Whether a window was found and closed.
	 */
	dock( windowId: string ): boolean {
		const win = this.windows.get( String( windowId ) );
		if ( ! win || win.isDestroyed() ) {
			return false;
		}
		win.close();
		return true;
	}

	/**
	 * @param windowId OpenStation window id.
	 * @return Whether a window was found and focused.
	 */
	focus( windowId: string ): boolean {
		const win = this.windows.get( String( windowId ) );
		if ( ! win || win.isDestroyed() ) {
			return false;
		}
		if ( win.isMinimized() ) {
			win.restore();
		}
		win.focus();
		return true;
	}

	/** Close everything without docking anything back. Used on quit. */
	closeAll(): void {
		this.quitting = true;
		for ( const win of this.windows.values() ) {
			if ( ! win.isDestroyed() ) {
				win.destroy();
			}
		}
		this.windows.clear();
	}

	/**
	 * Re-arm after a `closeAll()` that was not a quit — switching
	 * sites, for instance, where the app keeps running.
	 */
	reset(): void {
		this.closeAll();
		this.quitting = false;
	}
}
