/**
 * `<wpd-confirm-dialog>` — modal Yes/No replacement for the
 * native browser `confirm()`. Wired up around the same idea as
 * macOS / Windows: title, body, two buttons, Escape cancels,
 * Enter confirms.
 *
 * Two ways to use it:
 *
 * **1. As a Web Component, declarative.** Mount the element,
 * set `open`, listen for `wpd-confirm`:
 *
 * ```html
 * <wpd-confirm-dialog id="d" title="Empty trash?" message="…" danger></wpd-confirm-dialog>
 * <script>
 *   document.getElementById('d').addEventListener('wpd-confirm', e => …);
 *   document.getElementById('d').setAttribute('open', '');
 * </script>
 * ```
 *
 * **2. Imperatively, Promise-returning.** The exported
 * `wpdConfirm()` helper mounts the component on `document.body`,
 * resolves with `true` / `false`, and tears down. This is the
 * drop-in replacement for `window.confirm()`:
 *
 * ```ts
 * import { wpdConfirm } from '<…>/wpd-confirm-dialog';
 * if ( await wpdConfirm( { title: 'Delete?', message: 'Cannot undo.', danger: true } ) ) {
 *     // …
 * }
 * ```
 */

import { Component, defineComponent, html } from '../../core';
import { dialogStyles } from './wpd-confirm-dialog.styles';

export class WpdConfirmDialog extends Component {
	static props = [
		'open',
		'title',
		'message',
		'confirm-label',
		'cancel-label',
		'danger',
		'hide-cancel',
		'dismissable',
	] as const;
	static styles = [ dialogStyles ];

	static help = {
		title: 'Confirm dialog',
		summary:
			'Modal Yes/No replacement for window.confirm(). Two consumption paths: declarative element with `open` + `wpd-confirm` event, or the imperative Promise-returning `wpdConfirm()` helper.',
		status: 'experimental',
		since: '0.9.0',
		props: [
			{ name: 'open', type: 'boolean attribute', description: 'Mounts the dialog visible.' },
			{ name: 'title', type: 'string', description: 'Heading shown at the top.' },
			{ name: 'message', type: 'string', description: 'Body copy. Newlines preserved.' },
			{ name: 'confirm-label', type: 'string', default: 'Confirm', description: 'Confirm-button label.' },
			{ name: 'cancel-label', type: 'string', default: 'Cancel', description: 'Cancel-button label.' },
			{ name: 'danger', type: 'boolean attribute', description: 'Renders the confirm button red.' },
			{ name: 'hide-cancel', type: 'boolean attribute', description: 'Hides the cancel button entirely. Useful when there is no alternative action — pair with `dismissable` so the user still has an explicit way to close.' },
			{ name: 'dismissable', type: 'boolean attribute', description: 'Renders an X close button in the top-right corner. Click emits `wpd-cancel`.' },
		],
		events: [
			{
				name: 'wpd-confirm',
				description: 'Fires on confirm. Detail: `{ confirmed: true }`.',
			},
			{
				name: 'wpd-cancel',
				description: 'Fires on cancel (Cancel button, Escape, backdrop click). Detail: `{ confirmed: false }`.',
			},
		],
	} as const;

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

	private _onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			this._cancel();
		}
		if ( e.key === 'Enter' && ! e.isComposing ) {
			e.preventDefault();
			this._confirm();
		}
	};

	private _onBackdrop = ( e: MouseEvent ): void => {
		// Click target retargets to the host as the event crosses
		// the shadow boundary, so `e.target === this` is true for
		// BOTH backdrop and inner clicks. Look at the composed
		// path's deepest element to decide which case we're in.
		const path = e.composedPath();
		const original = path.length > 0 ? path[ 0 ] : e.target;
		if ( original === this ) {
			this._cancel();
		}
	};

	private _confirm = (): void => {
		this.emit( 'wpd-confirm', { confirmed: true } );
		this.removeAttribute( 'open' );
	};

	private _cancel = (): void => {
		this.emit( 'wpd-cancel', { confirmed: false } );
		this.removeAttribute( 'open' );
	};

	protected render() {
		const title = ( this as unknown as { title: string | null } ).title ?? '';
		const message = ( this as unknown as { message: string | null } ).message ?? '';
		const confirmLabel =
			( this as unknown as { 'confirm-label': string | null } )[ 'confirm-label' ] || 'Confirm';
		const cancelLabel =
			( this as unknown as { 'cancel-label': string | null } )[ 'cancel-label' ] || 'Cancel';
		const isDanger = this.hasAttribute( 'danger' );
		const hideCancel = this.hasAttribute( 'hide-cancel' );
		const isDismissable = this.hasAttribute( 'dismissable' );
		return html`
			<div class="dialog" tabindex="-1">
				${ isDismissable
					? html`<button
						type="button"
						class="close"
						aria-label="Close"
						@click=${ () => this._cancel() }
					>&times;</button>`
					: html`` }
				${ title
					? html`<h2 class="title">${ title }</h2>`
					: html`` }
				${ message
					? html`<p class="message">${ message }</p>`
					: html`` }
				<div class="actions">
					${ hideCancel
						? html``
						: html`<button
							type="button"
							class="btn btn--secondary"
							@click=${ () => this._cancel() }
						>
							${ cancelLabel }
						</button>` }
					<button
						type="button"
						class="btn ${ isDanger ? 'btn--danger' : 'btn--primary' }"
						@click=${ () => this._confirm() }
					>
						${ confirmLabel }
					</button>
				</div>
			</div>
		`;
	}
}
defineComponent( 'wpd-confirm-dialog', WpdConfirmDialog );

export interface WpdConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	/** Hide the cancel button entirely. Pair with `dismissable` to keep a way to close. */
	hideCancel?: boolean;
	/** Render an X close button in the top-right corner. Click emits `wpd-cancel`. */
	dismissable?: boolean;
}

/**
 * Imperative Promise-returning wrapper. Mounts a fresh
 * `<wpd-confirm-dialog>` on `document.body`, resolves with
 * `true` (confirm) or `false` (cancel / Escape / backdrop), then
 * tears the element down.
 */
export function wpdConfirm( options: WpdConfirmOptions ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const dialog = document.createElement( 'wpd-confirm-dialog' );
		dialog.setAttribute( 'open', '' );
		if ( options.title ) {
			dialog.setAttribute( 'title', options.title );
		}
		dialog.setAttribute( 'message', options.message );
		if ( options.confirmLabel ) {
			dialog.setAttribute( 'confirm-label', options.confirmLabel );
		}
		if ( options.cancelLabel ) {
			dialog.setAttribute( 'cancel-label', options.cancelLabel );
		}
		if ( options.danger ) {
			dialog.setAttribute( 'danger', '' );
		}
		if ( options.hideCancel ) {
			dialog.setAttribute( 'hide-cancel', '' );
		}
		if ( options.dismissable ) {
			dialog.setAttribute( 'dismissable', '' );
		}
		const cleanup = ( ok: boolean ): void => {
			dialog.remove();
			resolve( ok );
		};
		dialog.addEventListener( 'wpd-confirm', () => cleanup( true ) );
		dialog.addEventListener( 'wpd-cancel', () => cleanup( false ) );
		document.body.appendChild( dialog );
		// Focus the dialog so Enter/Escape land where we expect.
		const inner = dialog.shadowRoot?.querySelector< HTMLElement >( '.dialog' );
		( inner ?? dialog ).focus?.();
	} );
}
