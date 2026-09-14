/** A caller-authored MIO moment, anchored to a live control in its own window. */
import { __ } from '../i18n';
import type { MioCallout } from './assistant/types';
import type { MioHandle } from './types';

export class MioCalloutController {
	private request: MioCallout | null = null;
	private dismissed = new Set<string>();
	private active = false;
	private visible = false;
	private raf = 0;
	private bubble: HTMLElement;
	private message: HTMLElement;
	private observer: MutationObserver;

	public constructor(
		private host: HTMLElement,
		private frame: HTMLElement,
		private handle: () => MioHandle | null,
		private visibility: ( visible: boolean ) => void,
	) {
		this.bubble = document.createElement( 'aside' );
		this.bubble.className = 'os-mio-callout';
		this.bubble.hidden = true;
		this.bubble.setAttribute( 'aria-label', __( 'MIO tip' ) );
		this.message = document.createElement( 'span' );
		this.message.setAttribute( 'role', 'status' );
		const close = document.createElement( 'os-button' );
		close.setAttribute( 'variant', 'ghost' );
		close.setAttribute( 'aria-label', __( 'Dismiss MIO tip' ) );
		const icon = document.createElement( 'span' );
		icon.textContent = '×';
		icon.setAttribute( 'aria-hidden', 'true' );
		const label = document.createElement( 'span' );
		label.className = 'screen-reader-text';
		label.textContent = __( 'Dismiss MIO tip' );
		close.append( icon, label );
		close.addEventListener( 'click', () => {
			if ( ! this.request ) {
				return;
			}
			this.dismissed.add( this.request.id );
			this.update();
			this.request.onDismiss?.();
		} );
		this.bubble.append( this.message, close );
		frame.append( this.bubble );
		this.observer = new MutationObserver( () => this.update() );
		this.observer.observe( host, { childList: true, subtree: true, attributes: true } );
	}

	public show( request: MioCallout ): void {
		if ( ! request.id.trim() || ! request.message.trim() || typeof request.target !== 'function' ) {
			throw new Error( 'MIO callouts require an id, message and a live target resolver.' );
		}
		this.request = request;
		this.message.textContent = request.message;
		this.update();
	}

	public clear(): void {
		this.request = null;
		this.update();
	}

	public setActive( active: boolean ): void {
		this.active = active;
		this.update();
	}

	private update(): void {
		cancelAnimationFrame( this.raf );
		this.raf = 0;
		const request = this.request;
		const target = this.active && request && ! this.dismissed.has( request.id ) ? request.target() : null;
		const bounds = this.frame.getBoundingClientRect();
		const rect = target?.getBoundingClientRect();
		const visible = !! ( target?.isConnected && this.host.contains( target ) && rect &&
			rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom &&
			rect.right > bounds.left && rect.left < bounds.right );
		this.bubble.hidden = ! visible;
		if ( visible && rect ) {
			const clamp = ( n: number, min: number, max: number ): number => Math.max( min, Math.min( n, max ) );
			const rtl = getComputedStyle( this.frame ).direction === 'rtl';
			// Use the trailing edge, leaving the target’s leading text unobscured.
			const point = {
				x: clamp( rtl ? rect.left + 60 : rect.right - 60, bounds.left + 60, bounds.right - 60 ),
				y: clamp( rect.bottom + 65, bounds.top + 65, bounds.bottom - 65 ),
			};
			this.handle()?.setAnchor?.( point, true );
			const pos = this.handle()?.getPosition() ?? point;
			const width = this.bubble.offsetWidth;
			const height = this.bubble.offsetHeight;
			this.bubble.style.left = `${ clamp( pos.x - bounds.left + ( rtl ? 45 : -width - 45 ), 8, bounds.width - width - 8 ) }px`;
			this.bubble.style.top = `${ clamp( pos.y - bounds.top - height - 24, 8, bounds.height - height - 8 ) }px`;
		}
		if ( visible !== this.visible ) {
			this.visible = visible;
			if ( ! visible ) {
				this.handle()?.setAnchor?.( null );
			}
			this.visibility( visible );
		}
		// Poll geometry only while this caller's window can present a tip. This also
		// follows scrolling, window movement and targets hidden by a layout change.
		if ( this.active && request && ! this.dismissed.has( request.id ) ) {
			this.raf = requestAnimationFrame( () => this.update() );
		}
	}

	public dispose(): void {
		this.setActive( false );
		this.observer.disconnect();
		this.bubble.remove();
	}
}
