import type { Bounds, FreeWindowRequest, FreeWindowResult } from './protocol';

export const DEFAULT_SIZE = { width: 1100, height: 760 };

export const MIN_SIZE = { width: 420, height: 320 };

export function screenNameFrom( pageTitle: string, fallback: string ): string {
	const raw = String( pageTitle || '' ).trim();
	if ( ! raw ) {
		return fallback;
	}
	const head = raw.split( '‹' )[ 0 ]?.trim();
	return head || raw;
}

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

	createWindow: ( opts: CreateWindowOptions ) => FreeWindowHandle;

	getBounds: ( windowId: string ) => Bounds | null;

	saveBounds: ( windowId: string, bounds: Bounds ) => void;

	onDocked: ( windowId: string ) => void;

	onFreed: ( windowId: string ) => void;

	onActivity?: () => void;

	isAllowedUrl?: ( url: string ) => boolean;
}

export class FreeWindows {
	private readonly windows = new Map< string, FreeWindowHandle >();

	private quitting = false;

	constructor( private readonly deps: FreeWindowsDeps ) {}

	list(): string[] {
		return Array.from( this.windows.keys() );
	}

	any(): boolean {
		return this.windows.size > 0;
	}

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

		win.on( 'page-title-updated', ( ...args: unknown[] ) => {
			const event = args[ 0 ] as { preventDefault?: () => void } | undefined;

			event?.preventDefault?.();
			if ( req.native ) {
				win.setTitle( title );
				return;
			}
			win.setTitle( screenNameFrom( args[ 1 ] as string, title ) );
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

				this.deps.onDocked( windowId );
			}
		} );

		return { ok: true, windowId, reused: false };
	}

	dock( windowId: string ): boolean {
		const win = this.windows.get( String( windowId ) );
		if ( ! win || win.isDestroyed() ) {
			return false;
		}
		win.close();
		return true;
	}

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

	closeAll(): void {
		this.quitting = true;
		for ( const win of this.windows.values() ) {
			if ( ! win.isDestroyed() ) {
				win.destroy();
			}
		}
		this.windows.clear();
	}

	reset(): void {
		this.closeAll();
		this.quitting = false;
	}
}
