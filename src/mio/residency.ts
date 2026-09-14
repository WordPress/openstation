/** Opt-in, per-instance residency. One owner, one layer, cancellable handoffs. */
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
}

interface ResidencyOptions {
	shell: HTMLElement;
	focused: () => string | null;
	layer: () => HTMLElement | null;
	handle: () => MioHandle | null;
	enabled: () => boolean;
	chatAvailable?: () => boolean;
	wallpaperVisible?: () => boolean;
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
	private chat: MioChatHandle | null = null;
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
			session: new MioSession(
				{ ...context, windowId: id },
				createMioTransport( id ),
				() =>
					this.canChat() && resident.enabled &&
					this.owner === resident &&
					this.options.focused() === id &&
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
			this.closeChat();
			this.chat =
				window.openStationMountMioChat?.( frame, context.title, resident.session, () =>
					this.closeChat( true ),
				) ?? null;
			button.hidden = this.chat !== null;
			resident.callout?.setActive( false );
			this.syncVisibility();
			const panel = frame.querySelector<HTMLElement>( '.os-mio-chat' );
			if ( panel ) {
				this.chatPlacement = followMioChat( frame, panel, this.options.handle );
			}
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
			getOperations: () => resident.session.operations.list(),
			inspectOperation: ( callId, signal = new AbortController().signal ) => resident.session.operations.inspect( callId, signal ),
			dispose,
		};
	}

	public closeChat( focus = false ): void {
		this.chatPlacement?.close( focus );
		this.chatPlacement = null;
		this.chat?.destroy();
		this.chat = null;
		if ( this.owner ) {
			this.owner.button.hidden = ! this.canChat();
			if ( focus ) {
				( this.owner.button.shadowRoot?.querySelector<HTMLButtonElement>( 'button' ) ?? this.owner.button ).focus();
			}
		}
		this.syncCallouts();
	}

	private syncVisibility(): void {
		const layer = this.options.layer();
		if ( layer ) {
			layer.dataset.mioVisible = String( this.owner ? !! this.chat || this.owner.calloutVisible : ( this.options.wallpaperVisible?.() ?? true ) );
		}
	}

	private syncCallouts(): void {
		for ( const resident of this.residents.values() ) {
			resident.callout?.setActive( this.options.enabled() && resident.enabled && this.owner === resident && ! this.chat && ! this.transitioning );
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
		if ( ! this.canChat() && this.chat ) {
			this.closeChat();
		}
		for ( const resident of this.residents.values() ) {
			resident.toggle?.update();
			resident.button.hidden = ! this.canChat() || ( resident === this.owner && this.chat !== null );
			if ( ! this.canChat() ) {
				resident.session.cancel();
			}
		}
		if ( ! enabled ) {
			for ( const resident of this.residents.values() ) {
				resident.frame.hidden = true;
			}
		}
		const id = enabled ? this.options.focused() : null;
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
		this.closeChat();
		previous?.session.cancel();
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
				for ( const resident of this.residents.values() ) {
					resident.frame.hidden = resident !== next;
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
					this.syncCallouts();
					this.options.handle()?.setAnimating( ! document.hidden );
				}
			}
		};
		this.moving = transition();
	}
}
