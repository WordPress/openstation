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
 * @since 0.16.0
 */

import {
	registerCommand,
	unregisterByOwner,
	type DesktopCommand,
} from './../commands';
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

export class IframeCommandBridge {
	private readonly manager: WindowManager;
	private readonly adminUrl: string;
	private subscribedWindowId: string | null = null;

	constructor( opts: IframeCommandBridgeOptions ) {
		this.manager = opts.manager;
		this.adminUrl = opts.adminUrl;
	}

	/** Wire up the focus / close / message listeners. Idempotent. */
	public install(): void {
		devLog( '[wpd-cmd:parent] IframeCommandBridge installing' );
		document.addEventListener( 'wp-desktop-window-focused', ( e: Event ) => {
			const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
			if ( detail && typeof detail.windowId === 'string' ) {
				devLog( '[wpd-cmd:parent] window-focused: %s', detail.windowId );
				this.onFocused( detail.windowId );
			}
		} );
		document.addEventListener( 'wp-desktop-window-closed', ( e: Event ) => {
			const detail = ( e as CustomEvent< { windowId?: string } > ).detail;
			if ( detail && typeof detail.windowId === 'string' ) {
				unregisterByOwner( ownerFor( detail.windowId ) );
				if ( this.subscribedWindowId === detail.windowId ) {
					this.subscribedWindowId = null;
				}
			}
		} );

		// A minimized window is visually gone — showing its commands
		// in the palette would confuse the user ("where would that
		// even run?"). Evict on minimize; on restore, the window
		// manager fires a fresh `wp-desktop-window-focused` which flows
		// through `onFocused` and rebuilds the list.
		document.addEventListener( 'wp-desktop-window-changed', ( e: Event ) => {
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
			if ( this.subscribedWindowId === detail.windowId ) {
				const removed = unregisterByOwner( ownerFor( detail.windowId ) );
				devLog( '[wpd-cmd:parent] minimized %s → evicted %d commands', detail.windowId, removed );
				// Clear so a restore-fired focus event re-subscribes
				// instead of short-circuiting on the `already
				// subscribed` check.
				this.subscribedWindowId = null;
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
			if ( data.type === 'wp-desktop-bridge-ready' ) {
				const win = this.manager.findByIframeSource( e.source );
				devLog(
					'[wpd-cmd:parent] bridge-ready from window=%s (subscribedTo=%s)',
					win ? win.id : 'unknown',
					this.subscribedWindowId,
				);
				if ( win && win.id === this.subscribedWindowId ) {
					this.sendSubscribe( win.id );
				}
				return;
			}

			if ( data.type !== 'wp-desktop-commands-list' ) {
				return;
			}
			if ( ! Array.isArray( data.commands ) ) {
				devLog( '[wpd-cmd:parent] commands-list: payload not an array', data );
				return;
			}
			// Attribute the list to whichever window's iframe sent it.
			const win = this.manager.findByIframeSource( e.source );
			if ( ! win ) {
				devLog(
					'[wpd-cmd:parent] commands-list: could not match source to any window',
				);
				return;
			}
			// Only accept lists from the currently subscribed window.
			// Background iframes shouldn't be streaming (they were told
			// to unsubscribe), but if one does — stale or misbehaving
			// — we don't want its commands leaking into the palette.
			if ( win.id !== this.subscribedWindowId ) {
				devLog(
					'[wpd-cmd:parent] commands-list: ignoring list from non-subscribed window %s (subscribed=%s)',
					win.id,
					this.subscribedWindowId,
				);
				return;
			}
			devLog(
				'[wpd-cmd:parent] commands-list: %d cmds from window "%s"',
				data.commands.length,
				win.id,
				data.commands,
			);
			this.applyList( win.id, data.commands );
		} );

		// Seed against whatever window is focused at install time.
		const focused = this.manager.getFocused();
		devLog( '[wpd-cmd:parent] install: initial focused window=%s', focused ? focused.id : null );
		if ( focused ) {
			this.onFocused( focused.id );
		}
	}

	private onFocused( windowId: string ): void {
		if ( this.subscribedWindowId === windowId ) {
			devLog( '[wpd-cmd:parent] onFocused: already subscribed to %s, skipping', windowId );
			return;
		}

		// Tell the previously focused iframe to stop streaming.
		if ( this.subscribedWindowId ) {
			const prev = this.manager.getById( this.subscribedWindowId );
			if ( prev && prev.iframe && prev.iframe.contentWindow ) {
				try {
					prev.iframe.contentWindow.postMessage(
						{ type: 'wp-desktop-commands-unsubscribe' },
						window.location.origin,
					);
				} catch {
					/* swallow */
				}
			}
			const removed = unregisterByOwner( ownerFor( this.subscribedWindowId ) );
			devLog( '[wpd-cmd:parent] onFocused: evicted %d commands from prior window %s', removed, this.subscribedWindowId );
		}

		this.subscribedWindowId = windowId;

		this.sendSubscribe( windowId );
	}

	private sendSubscribe( windowId: string ): void {
		const win = this.manager.getById( windowId );
		if ( ! win ) {
			devLog( '[wpd-cmd:parent] sendSubscribe: no window found for id %s', windowId );
			return;
		}
		if ( ! win.iframe ) {
			devLog( '[wpd-cmd:parent] sendSubscribe: window %s is native (no iframe) — nothing to subscribe', windowId );
			return;
		}
		if ( ! win.iframe.contentWindow ) {
			devLog( '[wpd-cmd:parent] sendSubscribe: iframe for %s has no contentWindow yet', windowId );
			return;
		}
		try {
			win.iframe.contentWindow.postMessage(
				{ type: 'wp-desktop-commands-subscribe' },
				window.location.origin,
			);
			devLog( '[wpd-cmd:parent] sendSubscribe: sent subscribe to iframe for %s', windowId );
		} catch ( err ) {
			devLog( '[wpd-cmd:parent] sendSubscribe: postMessage threw', err );
		}
	}

	private applyList( windowId: string, commands: HarvestedCommand[] ): void {
		const owner = ownerFor( windowId );
		unregisterByOwner( owner );

		let registered = 0;
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
			registerCommand( def );
			registered++;
		}
		devLog( '[wpd-cmd:parent] applyList: registered %d/%d commands for owner %s', registered, commands.length, owner );
	}

	private runNavigate(
		url: string,
		title: string,
		icon: string,
	): DesktopCommand[ 'run' ] {
		return ( _args, ctx ) => {
			ctx.close();
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
					{ type: 'wp-desktop-commands-invoke', name },
					window.location.origin,
				);
			} catch {
				/* swallow */
			}
			this.manager.focus( win );
		};
	}
}
