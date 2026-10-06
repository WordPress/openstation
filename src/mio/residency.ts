/**
 * Opt-in, per-instance residency. One owner, one layer, cancellable
 * handoffs — and a chat PER WINDOW.
 *
 * The mascot is one creature, so it lives in one window at a time: the
 * focused one (the owner). A conversation belongs to its window, not to
 * the mascot: opening a chat in one window never closes another's, and
 * focusing another window leaves every open chat where it is, still
 * working. Only the master switch, a window's own MIO toggle, losing AI
 * availability, or the window going away closes a chat.
 */
import { addAction, doAction, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { registerMioWindowToggle } from './window-toggle';
import { MioCalloutController } from './callout';
import { followMioChat } from './chat-placement';
import { MioSession } from './assistant/session';
import { createMioTransport } from './assistant/transport';
import type { MioChatHandle } from './assistant/chat';
import type { MioWindowContext, MioWindowLease } from './assistant/types';
import type { MioHandle } from './types';

interface Resident {
	dispose?: () => void;
	enabled: boolean;
	thinking: boolean;
	calloutVisible: boolean;
	callout?: MioCalloutController;
	toggle?: ReturnType<typeof registerMioWindowToggle>;
	id: string;
	context: MioWindowContext;
	frame: HTMLElement;
	button: HTMLElement;
	session: MioSession;
	observer: ResizeObserver;
	/** This window's open conversation, or null. */
	chat: MioChatHandle | null;
	/** The body padded for this window's side-docked chat, while open. */
	sideBody: HTMLElement | null;
}

interface ResidencyOptions {
	shell: HTMLElement;
	focused: () => string | null;
	layer: () => HTMLElement | null;
	handle: () => MioHandle | null;
	enabled: () => boolean;
	chatAvailable?: () => boolean;
	wallpaperVisible?: () => boolean;
	/**
	 * The shell tour is holding Mio on the desk. No window takes it,
	 * however focused, and it shows on the wallpaper whatever the
	 * user's setting says: the tour walks Mio beside its cards, which
	 * point at the dock and the desk, and a Mio that moved into the
	 * Preferences window the tour itself opened was clamped inside it.
	 */
	held?: () => boolean;
	ready: () => Promise<void>;
}

export class MioResidency {
	private residents = new Map<string, Resident>();
	private attachmentObserver = new MutationObserver( () => {
		for ( const resident of this.residents.values() ) {
			if ( ! resident.context.host.isConnected || ! resident.frame.isConnected ) {
				resident.dispose?.();
			}
		}
	} );
	private owner: Resident | null = null;
	/** The mascot's anchor beside the OWNER's open chat — one mascot, one anchor. */
	private chatPlacement: ReturnType<typeof followMioChat> | null = null;
	private thinkingOwner: string | null = null;
	private revision = 0;
	private transitioning = false;
	private targetLayer: HTMLElement | null = null;
	private moving: Promise<void> = Promise.resolve();
	private animation: Animation | null = null;
	private deskPosition: { x: number; y: number } | null = null;

	public constructor( private options: ResidencyOptions ) {
		for ( const name of [
			'os-window-focused',
			'os-window-closed',
		] ) {
			document.addEventListener( name, () => this.refresh() );
		}
		for ( const hook of [ HOOKS.WINDOW_MINIMIZED, HOOKS.WINDOW_RESTORED, HOOKS.DESKTOP_SWITCHED, HOOKS.WINDOW_DESKTOP_CHANGED ] ) {
			addAction( hook, 'openstation/mio-residency', () => this.refresh() );
		}
	}

	private canChat(): boolean {
		return this.options.enabled() && ( this.options.chatAvailable?.() ?? true );
	}

	public getWindowId(): string | null {
		return this.owner?.id ?? null;
	}

	public register( id: string, context: MioWindowContext ): MioWindowLease {
		const win = document.getElementById( `wp-window-${ id }` );
		const body = win?.querySelector<HTMLElement>( '.os-window__body' );
		if (
			! win ||
			! body ||
			! context.host.isConnected ||
			! body.contains( context.host ) ||
			! context.title.trim() ||
			typeof context.prompt !== 'function'
		) {
			throw new Error( 'MIO requires an explicit context belonging to a live window body.' );
		}
		if ( this.residents.has( id ) ) {
			throw new Error(
				'This window already registered MIO. Dispose its lease before replacing it.',
			);
		}
		const frame = document.createElement( 'div' );
		frame.className = 'os-mio-residence';
		frame.hidden = true;
		win.appendChild( frame );
		const measure = (): void => {
			frame.style.top = `${ body.offsetTop }px`;
			frame.style.left = `${ body.offsetLeft }px`;
			frame.style.width = `${ body.clientWidth }px`;
			frame.style.height = `${ body.clientHeight }px`;
			if ( body.dataset.osMioSideChat ) {
				sizeSideChat( body );
			}
		};
		const observer = new ResizeObserver( measure );
		observer.observe( body );
		measure();
		const button = document.createElement( 'os-button' );
		button.className = 'os-mio-chat-launcher';
		button.hidden = ! this.canChat();
		button.setAttribute( 'variant', 'ghost' );
		button.textContent = __( 'Ask MIO' );
		button.setAttribute( 'aria-haspopup', 'dialog' );
		frame.appendChild( button );
		const resident: Resident = {
			enabled: context.enabled !== false,
			thinking: false,
			calloutVisible: false,
			id,
			context,
			frame,
			button,
			observer,
			chat: null,
			sideBody: null,
			// A conversation keeps working when its window loses focus:
			// the user may be reading another window while this one's
			// answer arrives. It stops with the switches, not with focus.
			session: new MioSession(
				{ ...context, windowId: id },
				createMioTransport( id ),
				() =>
					this.canChat() && resident.enabled &&
					context.host.isConnected,
			),
		};
		resident.callout = new MioCalloutController( context.host, frame, this.options.handle, ( visible ) => {
			resident.calloutVisible = visible;
			this.syncVisibility();
		} );
		this.residents.set( id, resident );
		this.attachmentObserver.observe( document.body, { childList: true, subtree: true } );
		const setEnabled = ( enabled: boolean ): void => {
			if ( this.residents.get( id ) !== resident || resident.enabled === enabled ) {
				return;
			}
			resident.enabled = enabled;
			if ( ! enabled ) {
				resident.session.cancel();
				this.closeChatOf( resident );
			}
			this.refresh();
			doAction( 'os.mio.window-enabled-changed', { windowId: id, enabled } );
		};
		resident.toggle = registerMioWindowToggle( id,
			() => ( { enabled: resident.enabled, available: this.options.enabled(), thinking: resident.thinking } ),
			() => setEnabled( ! resident.enabled ),
		);
		resident.session.subscribeThinking( ( thinking ) => {
			resident.thinking = thinking;
			resident.toggle?.update();
			this.syncThinking();
		} );
		const openChat = async (): Promise<void> => {
			if ( ! context.host.isConnected || ! this.canChat() || ! resident.enabled || this.options.focused() !== id || this.residents.get( id ) !== resident ) {
				return;
			}
			await this.options.ready();
			await window.wp?.os?.loadComponents( [ 'os-button', 'os-textarea' ] );
			await this.moving;
			if ( ! context.host.isConnected || ! this.canChat() || ! resident.enabled || this.owner !== resident || this.options.focused() !== id ) {
				return;
			}
			// This window's chat only — another window's stays open.
			this.closeChatOf( resident );
			resident.chat =
				window.openStationMountMioChat?.( frame, context.title, resident.session, () =>
					this.closeChatOf( resident, true ),
				) ?? null;
			button.hidden = resident.chat !== null;
			resident.callout?.setActive( false );
			const panel = frame.querySelector<HTMLElement>( '.os-mio-chat' );
			if ( panel && 'side' === context.chatLayout ) {
				// Docked: the panel takes the trailing edge at full height,
				// and the body gives up that width so the app reflows
				// beside it.
				panel.classList.add( 'os-mio-chat--side' );
				body.dataset.osMioSideChat = 'true';
				resident.sideBody = body;
				sizeSideChat( body );
			}
			this.anchorMascot();
			this.syncVisibility();
		};
		button.addEventListener( 'click', () => {
			void openChat().catch( ( error: unknown ) => {
				button.textContent =
					error instanceof Error ? error.message : __( 'MIO could not open.' );
			} );
		} );
		const dispose = (): void => {
			if ( this.residents.get( id ) !== resident ) {
				return;
			}
			this.closeChatOf( resident );
			this.residents.delete( id );
			resident.session.dispose();
			resident.callout?.dispose();
			resident.toggle?.dispose();
			observer.disconnect();
			this.refresh();
			// The layer may still be shrinking here. Move it out before removing its parent.
			const layer = this.options.layer();
			if ( layer && frame.contains( layer ) ) {
				this.options.shell.appendChild( layer );
				delete layer.dataset.mioWindow;
				delete layer.dataset.mioThinking;
			}
			frame.remove();
			if ( ! this.residents.size ) {
				this.attachmentObserver.disconnect();
			}
		};
		resident.dispose = dispose;
		this.refresh();
		return {
			showCallout: ( callout ) => resident.callout?.show( callout ),
			clearCallout: () => resident.callout?.clear(),
			isEnabled: () => resident.enabled,
			setEnabled,
			openChat,
			send: ( message ) => {
				if ( ! resident.chat ) {
					return false;
				}
				resident.chat.send( message );
				return true;
			},
			getOperations: () => resident.session.operations.list(),
			inspectOperation: ( callId, signal = new AbortController().signal ) => resident.session.operations.inspect( callId, signal ),
			dispose,
		};
	}

	/** Close every window's chat — the master switch going off. */
	public closeChat( focus = false ): void {
		for ( const resident of this.residents.values() ) {
			this.closeChatOf( resident, focus && resident === this.owner );
		}
		this.syncCallouts();
	}

	/**
	 * Close one window's chat, giving its body back its width. Returns
	 * focus to its launcher when asked (the chat's own close button).
	 */
	private closeChatOf( resident: Resident, focus = false ): void {
		if ( resident.sideBody ) {
			delete resident.sideBody.dataset.osMioSideChat;
			windowOf( resident.sideBody ).style.removeProperty( '--os-mio-side-chat-size' );
			resident.sideBody = null;
		}
		if ( resident === this.owner ) {
			this.chatPlacement?.close( focus );
			this.chatPlacement = null;
		}
		if ( resident.chat ) {
			resident.chat.destroy();
			resident.chat = null;
			resident.button.hidden = ! this.canChat();
			if ( focus ) {
				( resident.button.shadowRoot?.querySelector<HTMLButtonElement>( 'button' ) ?? resident.button ).focus();
			}
		}
		// A frame kept visible only for its chat hides with it.
		if ( resident !== this.owner ) {
			resident.frame.hidden = true;
		}
		this.syncCallouts();
	}

	/**
	 * Put the mascot beside the owner's open chat — or release it when
	 * the owner has none. One mascot, so only the owner's chat anchors
	 * it; another window's chat stays open without it.
	 */
	private anchorMascot(): void {
		this.chatPlacement?.close( false );
		this.chatPlacement = null;
		const panel = this.owner?.chat ? this.owner.frame.querySelector< HTMLElement >( '.os-mio-chat' ) : null;
		if ( this.owner && panel ) {
			this.chatPlacement = followMioChat( this.owner.frame, panel, this.options.handle );
		}
	}

	private syncVisibility(): void {
		const layer = this.options.layer();
		if ( layer ) {
			layer.dataset.mioVisible = String(
				this.owner
					? !! this.owner.chat || this.owner.calloutVisible
					: ( this.options.held?.() ?? false ) || ( this.options.wallpaperVisible?.() ?? true ),
			);
		}
	}

	private syncCallouts(): void {
		for ( const resident of this.residents.values() ) {
			resident.callout?.setActive( this.options.enabled() && resident.enabled && this.owner === resident && ! resident.chat && ! this.transitioning );
		}
		this.syncVisibility();
	}

	private syncThinking(): void {
		const id = this.owner?.thinking && this.options.enabled() && this.owner.enabled ? this.owner.id : null;
		const layer = this.options.layer();
		if ( layer ) {
			layer.dataset.mioThinking = String( id !== null );
		}
		if ( this.thinkingOwner !== id ) {
			if ( this.thinkingOwner ) {
				doAction( 'os.mio.thinking-changed', { windowId: this.thinkingOwner, thinking: false } );
			}
			this.thinkingOwner = id;
			if ( id ) {
				doAction( 'os.mio.thinking-changed', { windowId: id, thinking: true } );
			}
		}
	}

	public refresh(): void {
		const enabled = this.options.enabled();
		if ( ! this.canChat() ) {
			this.closeChat();
		}
		for ( const resident of this.residents.values() ) {
			resident.toggle?.update();
			resident.button.hidden = ! this.canChat() || resident.chat !== null;
			if ( ! this.canChat() ) {
				resident.session.cancel();
			}
		}
		if ( ! enabled ) {
			for ( const resident of this.residents.values() ) {
				resident.frame.hidden = true;
			}
		}
		const id = enabled && ! this.options.held?.() ? this.options.focused() : null;
		const candidate = id ? ( this.residents.get( id ) ?? null ) : null;
		const next = candidate?.enabled && candidate.context.host.isConnected ? candidate : null;
		const layer = this.options.layer();
		if (
			this.owner === next &&
			layer === this.targetLayer
		) {
			this.syncVisibility();
			return;
		}
		this.targetLayer = layer;
		const previous = this.owner;
		this.transitioning = true;
		// Focus moving on does not close anything: every open chat stays
		// in its window, and a turn in flight keeps going. Only the
		// mascot moves, and with it its anchor.
		this.chatPlacement?.close( false );
		this.chatPlacement = null;
		this.owner = next;
		this.syncCallouts();
		this.syncThinking();
		const revision = ++this.revision;
		this.animation?.cancel();
		this.animation = null;
		this.options.handle()?.setAnimating( false );
		if ( next && layer && ! layer.dataset.mioWindow ) {
			this.deskPosition = this.options.handle()?.getPosition() ?? null;
		}
		if ( next ) {
			next.frame.hidden = false;
			next.button.hidden = ! this.canChat();
		}
		const transition = async (): Promise<void> => {
			const animate = async ( from: number, to: number ): Promise<void> => {
				if (
					! layer?.animate ||
					window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
				) {
					return;
				}
				const pos = this.options.handle()?.getPosition();
				const rect = layer.getBoundingClientRect();
				layer.style.transformOrigin = pos
					? `${ pos.x - rect.left }px ${ pos.y - rect.top }px`
					: '50% 50%';
				this.animation = layer.animate(
					[
						{ transform: `scale(${ from })`, opacity: from },
						{ transform: `scale(${ to })`, opacity: to },
					],
					{ duration: 150, easing: 'ease-in-out', fill: 'forwards' },
				);
				await this.animation.finished;
			};
			try {
				await animate( 1, 0 );
				if ( revision !== this.revision ) {
					return;
				}
				// The owner's frame shows, and so does every frame holding
				// an open chat — a conversation stays on screen in its
				// window whoever has the focus.
				for ( const resident of this.residents.values() ) {
					resident.frame.hidden = resident !== next && ! resident.chat;
				}
				if ( layer ) {
					// Measure the full layout, never the zero-sized shrink transform.
					layer.style.opacity = '0';
					this.animation?.cancel();
					this.animation = null;
					( next?.frame ?? this.options.shell ).appendChild( layer );
					if ( next ) {
						layer.dataset.mioWindow = next.id;
						layer.dataset.mioThinking = String( next.thinking );
					} else {
						delete layer.dataset.mioWindow;
						delete layer.dataset.mioThinking;
					}
					const rect = layer.getBoundingClientRect();
					const pos = next
						? { x: rect.right - 82, y: rect.bottom - 95 }
						: this.deskPosition;
					if ( pos ) {
						this.options.handle()?.setPosition( pos.x, pos.y );
					}
				}
				doAction( 'os.mio.owner-changed', {
					windowId: next?.id ?? null,
					previousWindowId: previous?.id ?? null,
				} );
				// Paint the new body position during growth, not only after the reveal ends.
				this.options.handle()?.setAnimating( ! document.hidden );
				await animate( 0, 1 );
			} catch {
				// A newer focus change cancels the obsolete animation.
			} finally {
				if ( revision === this.revision ) {
					this.animation?.cancel();
					this.animation = null;
					layer?.style.removeProperty( 'opacity' );
					this.transitioning = false;
					this.anchorMascot();
					this.syncCallouts();
					this.options.handle()?.setAnimating( ! document.hidden );
				}
			}
		};
		this.moving = transition();
	}
}

/** The window element around a body — the parent of both the body and MIO's frame. */
function windowOf( body: HTMLElement ): HTMLElement {
	return body.closest< HTMLElement >( '[id^="wp-window-"]' ) ?? body.parentElement ?? body;
}

/**
 * The width a side-docked chat takes: 360px, or 45% of a narrower
 * window, never under 280px. Written as `--os-mio-side-chat-size` on
 * the WINDOW, which holds both the body (its padding reads it) and
 * MIO's frame (the panel reads it) — the two are siblings.
 */
function sizeSideChat( body: HTMLElement ): void {
	const width = body.clientWidth;
	const size = Math.max( Math.min( 360, Math.round( width * 0.45 ) ), Math.min( 280, width ) );
	windowOf( body ).style.setProperty( '--os-mio-side-chat-size', `${ size }px` );
}
