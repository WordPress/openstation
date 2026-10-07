import {
	registerCommand,
	unregisterByOwner,
	type DesktopCommand,
} from './../commands';
import { tryNativeUrlRemap } from './../native-url-remap';
import type { HarvestedCommand } from './../types';
import type { WindowManager } from './../window-manager';
import { deriveWindowId, sanitizeIconSvg } from './../utils';

function devLog( ...args: unknown[] ) {
	const mode = ( typeof import.meta !== 'undefined' && ( import.meta as any ).env ) ? ( import.meta as any ).env.MODE : undefined;
	if ( mode !== 'production' ) {
		console.log( ...args );
	}
}

const OWNER_PREFIX = 'iframe:';

function ownerFor( windowId: string ): string {
	return OWNER_PREFIX + windowId;
}

function iconFor( harvested: HarvestedCommand ): string {
	if ( harvested.icon && typeof harvested.icon === 'string' && harvested.icon.startsWith( 'dashicons-' ) ) {
		return harvested.icon;
	}
	return harvested.kind === 'navigate'
		? 'dashicons-external'
		: 'dashicons-arrow-right-alt';
}

function slugFor( windowId: string, name: string ): string {
	const safeName = name.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' );
	const safeWin = windowId.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' );
	return `win-${ safeWin }-${ safeName }`;
}

export interface IframeCommandBridgeOptions {
	manager: WindowManager;
	adminUrl: string;
}

const CLOSE_GRACE_MS = 250;

export class IframeCommandBridge {
	private readonly manager: WindowManager;
	private readonly adminUrl: string;

	private streamingWindowId: string | null = null;

	private focusedWindowId: string | null = null;

	private paletteOpen = false;
	private closeGraceTimer: number | null = null;

	constructor( opts: IframeCommandBridgeOptions ) {
		this.manager = opts.manager;
		this.adminUrl = opts.adminUrl;
	}

	public install(): void {
		document.addEventListener( 'os-window-focused', ( e: Event ) => {
			const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
			if ( detail && typeof detail.windowId === 'string' ) {
				this.onFocused( detail.windowId );
			}
		} );
		document.addEventListener( 'os-window-closed', ( e: Event ) => {
			const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
			if ( detail && typeof detail.windowId === 'string' ) {
				unregisterByOwner( ownerFor( detail.windowId ) );
				if ( this.streamingWindowId === detail.windowId ) {
					this.streamingWindowId = null;
				}
				if ( this.focusedWindowId === detail.windowId ) {
					this.focusedWindowId = null;
				}
			}
		} );

		document.addEventListener( 'os-palette-opened', () => {
			this.onPaletteOpened();
		} );
		document.addEventListener( 'os-palette-closed', () => {
			this.onPaletteClosed();
		} );

		document.addEventListener( 'os-window-changed', ( e: Event ) => {
			const detail = ( e as CustomEvent< { windowId?: string; reason?: string; state?: string } > ).detail;
			if ( ! detail || typeof detail.windowId !== 'string' ) {
				return;
			}
			if ( detail.reason !== 'state' ) {
				return;
			}
			if ( detail.state !== 'minimized' ) {
				return;
			}
			if ( this.streamingWindowId === detail.windowId ) {
				this.stopStreaming();
			}
			if ( this.focusedWindowId === detail.windowId ) {
				this.focusedWindowId = null;
			}
		} );
		window.addEventListener( 'message', ( e: MessageEvent ) => {
			if ( e.origin !== window.location.origin ) {
				return;
			}
			const data = e.data as { type?: string; commands?: HarvestedCommand[] } | null;
			if ( ! data || typeof data.type !== 'string' ) {
				return;
			}

			if ( data.type === 'os-bridge-ready' ) {
				const win = this.manager.findByIframeSource( e.source );
				if ( win && win.id === this.streamingWindowId ) {
					this.sendSubscribe( win.id );
				}
				return;
			}

			if ( data.type !== 'os-commands-list' ) {
				return;
			}
			if ( ! Array.isArray( data.commands ) ) {
				return;
			}

			const win = this.manager.findByIframeSource( e.source );
			if ( ! win ) {
				return;
			}

			if ( win.id !== this.streamingWindowId ) {
				return;
			}
			this.applyList( win.id, data.commands );
		} );

		const focused = this.manager.getFocused();
		if ( focused ) {
			this.focusedWindowId = focused.id;
		}
	}

	private onFocused( windowId: string ): void {
		const alreadyStreamingRight =
			! this.paletteOpen || this.streamingWindowId === windowId;
		if ( this.focusedWindowId === windowId && alreadyStreamingRight ) {
			return;
		}

		if ( this.focusedWindowId && this.focusedWindowId !== windowId ) {
			unregisterByOwner( ownerFor( this.focusedWindowId ) );
		}

		if ( this.streamingWindowId && this.streamingWindowId !== windowId ) {
			this.stopStreaming();
		}

		this.focusedWindowId = windowId;

		if ( this.paletteOpen ) {
			this.startStreaming( windowId );
		}
	}

	private onPaletteOpened(): void {
		this.paletteOpen = true;
		if ( this.closeGraceTimer !== null ) {
			window.clearTimeout( this.closeGraceTimer );
			this.closeGraceTimer = null;
		}
		if ( this.focusedWindowId ) {
			this.startStreaming( this.focusedWindowId );
		}
	}

	private onPaletteClosed(): void {
		this.paletteOpen = false;
		if ( this.closeGraceTimer !== null ) {
			window.clearTimeout( this.closeGraceTimer );
		}
		this.closeGraceTimer = window.setTimeout( () => {
			this.closeGraceTimer = null;
			this.stopStreaming();
		}, CLOSE_GRACE_MS );
	}

	private startStreaming( windowId: string ): void {
		if ( this.streamingWindowId === windowId ) {
			return;
		}
		this.stopStreaming();
		this.streamingWindowId = windowId;
		this.sendSubscribe( windowId );
	}

	private stopStreaming(): void {
		if ( ! this.streamingWindowId ) {
			return;
		}
		const prev = this.manager.getById( this.streamingWindowId );
		this.streamingWindowId = null;
		if ( prev && prev.iframe && prev.iframe.contentWindow ) {
			try {
				prev.iframe.contentWindow.postMessage(
					{ type: 'os-commands-unsubscribe' },
					window.location.origin,
				);
			} catch {

			}
		}
	}

	private sendSubscribe( windowId: string ): void {
		const win = this.manager.getById( windowId );
		if ( ! win ) {
			return;
		}
		if ( ! win.iframe ) {
			return;
		}
		if ( ! win.iframe.contentWindow ) {
			return;
		}
		try {
			win.iframe.contentWindow.postMessage(
				{ type: 'os-commands-subscribe' },
				window.location.origin,
			);
		} catch ( err ) {
			devLog( '[os-cmd:parent] sendSubscribe: postMessage threw', err );
		}
	}

	private applyList( windowId: string, commands: HarvestedCommand[] ): void {
		const owner = ownerFor( windowId );
		unregisterByOwner( owner );

		for ( const cmd of commands ) {
			if ( ! cmd || ! cmd.name || ! cmd.label ) {
				continue;
			}
			const slug = slugFor( windowId, cmd.name );
			const safeSvg = typeof cmd.iconSvg === 'string' && cmd.iconSvg !== ''
				? sanitizeIconSvg( cmd.iconSvg )
				: '';

			const def: DesktopCommand = {
				slug,
				label: cmd.label,
				icon: iconFor( cmd ),
				iconSvg: safeSvg !== '' ? safeSvg : undefined,
				owner,

				eager: true,
				run: cmd.kind === 'navigate' && cmd.url
					? this.runNavigate( cmd.url, cmd.label, iconFor( cmd ) )
					: this.runProxy( windowId, cmd.name ),
			};

			try {
				registerCommand( def );
			} catch ( err ) {
				console.error(
					'[openstation] iframe-bridge: dropping bad command',
					def,
					err,
				);
			}
		}
	}

	private runNavigate(
		url: string,
		title: string,
		icon: string,
	): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			ctx.close();

			if ( tryNativeUrlRemap( url ) ) {
				return;
			}
			const id = deriveWindowId( url, this.adminUrl );
			this.manager.open( { id, baseId: id, url, title, icon } );
		};
	}

	private runProxy(
		windowId: string,
		name: string,
	): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			ctx.close();
			const win = this.manager.getById( windowId );
			if ( ! win || ! win.iframe || ! win.iframe.contentWindow ) {
				return;
			}
			try {
				win.iframe.contentWindow.postMessage(
					{ type: 'os-commands-invoke', name },
					window.location.origin,
				);
			} catch {

			}
			this.manager.focus( win );
		};
	}
}
