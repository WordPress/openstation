/**
 * `<wpd-modal>` — overlay container for rich modal UIs that need
 * more shape than `<wpd-confirm-dialog>`. Three slots:
 *
 *   - **(default)** — body content.
 *   - **footer** — button row (right-aligned).
 *   - **header-actions** — extra actions next to the close button.
 *
 * The component handles ESC, click-outside, and focus trap; the
 * consumer renders the body + footer however they like.
 *
 * Attributes:
 *
 *   - `open` — mounts the dialog visible.
 *   - `title` — heading text.
 *   - `size` — `sm` | `md` (default) | `lg`.
 *   - `mandatory` — disables ESC, click-outside, and hides the
 *     close button. Use sparingly (terms / blocker dialogs).
 *
 * Events:
 *
 *   - `wpd-modal-cancel` — ESC, click-outside, close button.
 *
 * @since 0.8.5
 */

import { Component, defineComponent, html } from '../../core';
import { modalStyles } from './wpd-modal.styles';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class WpdModal extends Component {
	static props = [ 'open', 'title', 'size', 'mandatory' ] as const;
	static styles = [ modalStyles ];

	static help = {
		title: 'Modal overlay',
		summary:
			'Overlay container with title, body, and footer slots. Handles ESC, click-outside, focus trap. Use for rich modal flows that go beyond a yes/no confirm. The dialog surface is dark and re-points the shared surface tokens (--desktop-mode-text/-muted/-border/-window-bg, --wpd-button-bg-hover) so wpd-* controls slotted into it resolve readable dark-surface colors automatically.',
		status: 'experimental',
		since: '0.8.5',
		props: [
			{ name: 'open', type: 'boolean attribute', description: 'Mounts the dialog visible.' },
			{ name: 'title', type: 'string', description: 'Heading shown at the top of the dialog.' },
			{ name: 'size', type: "'sm' | 'md' | 'lg'", default: 'md', description: 'Width preset.' },
			{
				name: 'mandatory',
				type: 'boolean attribute',
				description: 'Disables ESC, click-outside and the close button.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Body content.' },
			{ name: 'footer', description: 'Footer button row, right-aligned.' },
			{ name: 'header-actions', description: 'Extra actions next to the close button.' },
		],
		events: [
			{
				name: 'wpd-modal-cancel',
				description:
					'Fires when the user dismisses the modal (ESC, click-outside, close button). Cancelable; calling `preventDefault()` keeps the modal open.',
			},
		],
	} as const;

	private _prevFocus: HTMLElement | null = null;

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute( 'role', 'dialog' );
		this.setAttribute( 'aria-modal', 'true' );
		this.addEventListener( 'keydown', this._onKey );
		this.addEventListener( 'click', this._onBackdrop );
	}

	disconnectedCallback() {
		this.removeEventListener( 'keydown', this._onKey );
		this.removeEventListener( 'click', this._onBackdrop );
	}

	attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void {
		super.attributeChangedCallback?.( name, oldValue, newValue );
		if ( name === 'open' ) {
			if ( newValue !== null ) {
				const doc = this.ownerDocument;
				this._prevFocus = doc ? ( doc.activeElement as HTMLElement | null ) : null;
				queueMicrotask( () => this._focusFirst() );
			} else if ( this._prevFocus ) {
				try {
					this._prevFocus.focus();
				} catch ( e ) {
					// Element may have unmounted while modal was open.
				}
				this._prevFocus = null;
			}
		}
	}

	showModal(): void {
		this.setAttribute( 'open', '' );
	}

	hideModal(): void {
		this.removeAttribute( 'open' );
	}

	private _focusables(): HTMLElement[] {
		const root = this.shadowRoot;
		if ( ! root ) {
			return [];
		}
		const slotted = Array.from( this.querySelectorAll< HTMLElement >( FOCUSABLE ) );
		const inShadow = Array.from( root.querySelectorAll< HTMLElement >( FOCUSABLE ) );
		return [ ...slotted, ...inShadow ].filter( ( el ) => el.offsetParent !== null || el.tagName === 'BUTTON' );
	}

	private _focusFirst(): void {
		const f = this._focusables();
		if ( f.length > 0 ) {
			f[ 0 ].focus();
		} else {
			const inner = this.shadowRoot?.querySelector< HTMLElement >( '.dialog' );
			inner?.focus?.();
		}
	}

	private _onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' && ! this.hasAttribute( 'mandatory' ) ) {
			e.preventDefault();
			this._cancel();
			return;
		}
		if ( e.key === 'Tab' ) {
			const f = this._focusables();
			if ( f.length === 0 ) {
				return;
			}
			const first = f[ 0 ];
			const last = f[ f.length - 1 ];
			const doc = this.ownerDocument;
			const fallback = doc ? ( doc.activeElement as HTMLElement | null ) : null;
			const active = ( e.composedPath()[ 0 ] as HTMLElement ) || fallback;
			if ( e.shiftKey && active === first ) {
				e.preventDefault();
				last.focus();
			} else if ( ! e.shiftKey && active === last ) {
				e.preventDefault();
				first.focus();
			}
		}
	};

	private _onBackdrop = ( e: MouseEvent ): void => {
		if ( this.hasAttribute( 'mandatory' ) ) {
			return;
		}
		const path = e.composedPath();
		const original = path.length > 0 ? path[ 0 ] : e.target;
		if ( original === this ) {
			this._cancel();
		}
	};

	private _cancel(): void {
		const ev = new CustomEvent( 'wpd-modal-cancel', {
			bubbles: true,
			cancelable: true,
			composed: true,
		} );
		const allowed = this.dispatchEvent( ev );
		if ( allowed ) {
			this.hideModal();
		}
	}

	protected render() {
		// `title` is reflected on every HTMLElement via the IDL — read
		// it through `getAttribute` so the source-of-truth is explicit
		// and we don't trip readers who'd otherwise think the cast in
		// the old line meant the property could be null (it can't —
		// HTMLElement.title is always a string).
		const title = this.getAttribute( 'title' ) ?? '';
		const mandatory = this.hasAttribute( 'mandatory' );
		return html`
			<div class="dialog" tabindex="-1">
				${ title
					? html`
						<div class="header">
							<h2 class="title">${ title }</h2>
							<div class="header-actions">
								<slot name="header-actions"></slot>
								${ mandatory
									? html``
									: html`<button
										type="button"
										class="close"
										aria-label="Close"
										@click=${ () => this._cancel() }
									>×</button>` }
							</div>
						</div>
					`
					: html`` }
				<div class="body">
					<slot></slot>
				</div>
				<div class="footer">
					<slot name="footer"></slot>
				</div>
			</div>
		`;
	}
}
defineComponent( 'wpd-modal', WpdModal );
