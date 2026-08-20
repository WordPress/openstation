/**
 * Iframe → shell palette bridge for `wp.data.select('core/commands')`.
 *
 * Subscribes to the currently focused iframe window's WordPress command
 * registry and re-publishes each command as a slash-command in the shell
 * palette. Navigation-shaped commands are rewritten to open a new desktop
 * window instead of navigating the iframe out of chromeless mode;
 * everything else is proxied back into the iframe on user selection.
 *
 * Ownership & lifecycle:
 *
 *   - Every command registered here carries an `owner` tag of the form
 *     `iframe:<windowId>`. When focus shifts we unregister the stale
 *     owner's entries before subscribing the new one, so the palette
 *     never shows stale commands from a background window.
 *   - On window close we evict the corresponding owner.
 *   - Live updates from the focused iframe repopulate its slice
 *     incrementally via the same owner, which means a command added or
 *     removed inside the iframe (Gutenberg entering the editor,
 *     distraction-free toggled, etc.) shows up in the palette without
 *     any user interaction.
 *
 * Streaming is gated on palette visibility. Harvesting is not free for
 * the iframe: while subscribed, the chromeless bridge keeps a React
 * tree mounted whose command-loader hooks re-render on every
 * `wp.data` store tick — in the block editor that means every
 * keystroke. So the bridge only subscribes the focused window while a
 * palette is actually open (`os-palette-opened` / `os-palette-closed`
 * document events, dispatched by the AI Assistant overlay and the
 * palette registry), and tells the iframe to tear the harvester down
 * again when it closes. Two deliberate wrinkles:
 *
 *   - The unsubscribe after close is sent on a short grace delay.
 *     Picking a command closes the palette BEFORE `run()` posts
 *     `os-commands-invoke`, and the iframe clears its callback cache
 *     on unsubscribe — an immediate unsubscribe would race the invoke
 *     and silently no-op loader commands ("Duplicate block").
 *   - Closing the palette does NOT unregister the harvested commands.
 *     The last snapshot stays registered so reopening paints the
 *     palette instantly while a fresh harvest streams in; focus
 *     changes and window closes still evict stale owners.
 */

import {
	registerCommand,
	unregisterByOwner,
	type DesktopCommand,
} from './../commands';
import { tryNativeUrlRemap } from './../native-url-remap';
import type { HarvestedCommand } from './../types';
import type { WindowManager } from './../window-manager';
import { deriveWindowId, sanitizeIconSvg } from './../utils';

// Small development logging helper to avoid raw `console.log` scattered
// throughout the file and to satisfy the `no-console` ESLint rule in
// production builds. Logs only when Vite/ESM `import.meta.env.MODE` is
// not `production`. Remove when the bridge is stable and well-tested.
function devLog( ...args: unknown[] ) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mode = ( typeof import.meta !== 'undefined' && ( import.meta as any ).env ) ? ( import.meta as any ).env.MODE : undefined;
	if ( mode !== 'production' ) {
		// eslint-disable-next-line no-console
		console.log( ...args );
	}
}

const OWNER_PREFIX = 'iframe:';

function ownerFor( windowId: string ): string {
	return OWNER_PREFIX + windowId;
}

function iconFor( harvested: HarvestedCommand ): string {
	// Core commands ship `icon` as a React element from @wordpress/icons,
	// which structured-clone refuses. The chromeless bridge only forwards
	// string icons, so everything else falls back to a sensible default
	// per classification.
	if ( harvested.icon && typeof harvested.icon === 'string' && harvested.icon.startsWith( 'dashicons-' ) ) {
		return harvested.icon;
	}
	return harvested.kind === 'navigate'
		? 'dashicons-external'
		: 'dashicons-arrow-right-alt';
}

/**
 * Build a slug for a harvested command. WordPress command names look like
 * `core/create-new-post`, which isn't a legal palette slug. We namespace
 * per window so multiple open windows can expose commands sharing the
 * same underlying name without colliding in the single shared registry.
 */
function slugFor( windowId: string, name: string ): string {
	const safeName = name.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' );
	const safeWin = windowId.toLowerCase().replace( /[^a-z0-9_-]+/g, '-' );
	return `win-${ safeWin }-${ safeName }`;
}

export interface IframeCommandBridgeOptions {
	manager: WindowManager;
	adminUrl: string;
}

/**
 * How long to keep the focused iframe's harvester streaming after the
 * palette closes. Long enough for a close-then-run command pick to post
 * its `os-commands-invoke` first; short enough that typing resumes on a
 * quiet editor almost immediately.
 */
const CLOSE_GRACE_MS = 250;

export class IframeCommandBridge {
	private readonly manager: WindowManager;
	private readonly adminUrl: string;
	/** Window whose iframe we've told to stream (subscribe sent, no unsubscribe yet). */
	private streamingWindowId: string | null = null;
	/** Last window reported focused, streaming or not. */
	private focusedWindowId: string | null = null;
	/** Whether a Cmd+K palette is currently open. */
	private paletteOpen = false;
	private closeGraceTimer: number | null = null;

	constructor( opts: IframeCommandBridgeOptions ) {
		this.manager = opts.manager;
		this.adminUrl = opts.adminUrl;
	}

	/** Wire up the focus / close / message listeners. Idempotent. */
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
					// The iframe is gone — nothing to post an
					// unsubscribe to.
					this.streamingWindowId = null;
				}
				if ( this.focusedWindowId === detail.windowId ) {
					this.focusedWindowId = null;
				}
			}
		} );

		// A palette opening is what makes harvesting worth paying for;
		// its closing is what makes it pure overhead. See the header
		// comment for why the stop is grace-delayed and why harvested
		// commands stay registered across a close.
		document.addEventListener( 'os-palette-opened', () => {
			this.onPaletteOpened();
		} );
		document.addEventListener( 'os-palette-closed', () => {
			this.onPaletteClosed();
		} );

		// When the focused window is minimized, stop its stream and
		// clear the focus guard — the window's commands stay registered
		// in the palette until the window is closed or refocused. On
		// restore, the window manager fires a fresh
		// `os-window-focused` which flows through `onFocused`
		// and rebuilds the list.
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
				// Clear so a restore-fired focus event re-subscribes
				// instead of short-circuiting on the `already
				// focused` check.
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

			// Iframe signaled it's ready — if this source is the iframe
			// of the currently focused window, (re)send subscribe. This
			// covers the race where onFocused fires before the iframe's
			// message listener has attached (navigation inside a window,
			// slow editor boot, etc.).
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
			// Attribute the list to whichever window's iframe sent it.
			const win = this.manager.findByIframeSource( e.source );
			if ( ! win ) {
				return;
			}
			// Only accept lists from the currently streaming window.
			// Background iframes shouldn't be streaming (they were told
			// to unsubscribe), but if one does — stale or misbehaving
			// — we don't want its commands leaking into the palette.
			if ( win.id !== this.streamingWindowId ) {
				return;
			}
			this.applyList( win.id, data.commands );
		} );

		// Seed the focus tracker against whatever window is focused at
		// install time. No subscribe yet — that waits for a palette.
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

		// Focus moved to a different window: the stale window's palette
		// entries must go regardless of palette visibility, exactly as
		// before streaming was palette-gated.
		if ( this.focusedWindowId && this.focusedWindowId !== windowId ) {
			unregisterByOwner( ownerFor( this.focusedWindowId ) );
		}

		// Stop any stream still flowing from another window — including
		// one lingering in the post-close grace window.
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

	/** Tell the streaming iframe (if any) to tear its harvester down. */
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
				/* swallow */
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
				// Harvested commands are contextual by construction —
				// they come from whichever window has focus. Surface
				// them eagerly so the user sees "Duplicate block" /
				// "Toggle distraction free" without having to type `/`
				// first.
				eager: true,
				run: cmd.kind === 'navigate' && cmd.url
					? this.runNavigate( cmd.url, cmd.label, iconFor( cmd ) )
					: this.runProxy( windowId, cmd.name ),
			};
			// External commands flow in over postMessage; one
			// malformed entry shouldn't kill the whole batch. Log
			// and continue so the rest still register.
			try {
				registerCommand( def );
			} catch ( err ) {
				// eslint-disable-next-line no-console
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
			// Honor native URL remaps (e.g. Posts → native Posts
			// window) the same way the shell harvester does — see
			// `src/commands/shell-harvester.ts` for the rationale.
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
				/* swallow */
			}
			this.manager.focus( win );
		};
	}
}
