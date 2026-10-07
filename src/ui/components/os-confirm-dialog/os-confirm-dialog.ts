import { Component, defineComponent, html } from '../../core';
import { dialogStyles } from './os-confirm-dialog.styles';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function deepActiveElement( doc: Document | null ): HTMLElement | null {
	let el = ( doc?.activeElement ?? null ) as HTMLElement | null;
	while ( el?.shadowRoot?.activeElement ) {
		el = el.shadowRoot.activeElement as HTMLElement;
	}
	return el && el !== doc?.body ? el : null;
}

function eventSource( e: Event ): HTMLElement | null {
	const path = e.composedPath();
	const deepest = path.length > 0 ? path[ 0 ] : e.target;
	return deepest instanceof HTMLElement ? deepest : null;
}

function isControl( el: HTMLElement | null ): boolean {
	return el !== null && el.matches( FOCUSABLE );
}

export class OsConfirmDialog extends Component {
	static props = [
		'open',
		'title',
		'message',
		'confirm-label',
		'cancel-label',
		'danger',
		'hide-cancel',
		'dismissable',
		'remember-label',
	] as const;
	static styles = [ dialogStyles ];

	static help = {
		title: 'Confirm dialog',
		summary:
			'Modal Yes/No replacement for window.confirm(). Two consumption paths: declarative element with `open` + `os-confirm` event, or the imperative Promise-returning `osConfirm()` helper. Opening moves focus into the dialog and traps Tab inside it; closing hands focus back to the control that opened it. Escape always cancels. Enter is the default action only while no button is focused — on a focused Cancel it cancels — and a `danger` dialog has no default action at all, opening on the safe control and never on its destructive button. `remember-label` adds a "don\'t ask again" checkbox whose state rides on the confirm event.',
		status: 'stable',
		props: [
			{ name: 'open', type: 'boolean attribute', description: 'Mounts the dialog visible.' },
			{ name: 'title', type: 'string', description: 'Heading shown at the top.' },
			{ name: 'message', type: 'string', description: 'Body copy. Newlines preserved.' },
			{ name: 'confirm-label', type: 'string', default: 'Confirm', description: 'Confirm-button label.' },
			{ name: 'cancel-label', type: 'string', default: 'Cancel', description: 'Cancel-button label.' },
			{ name: 'danger', type: 'boolean attribute', description: 'Renders the confirm button red.' },
			{ name: 'hide-cancel', type: 'boolean attribute', description: 'Hides the cancel button entirely. Useful when there is no alternative action — pair with `dismissable` so the user still has an explicit way to close.' },
			{ name: 'dismissable', type: 'boolean attribute', description: 'Renders an X close button in the top-right corner. Click emits `os-cancel`.' },
			{ name: 'remember-label', type: 'string', description: 'Renders a checkbox above the buttons — a "don\'t ask again" opt-out. Its state rides along on the `os-confirm` detail as `remember`; it is only meaningful on confirm, since a cancelled question was never answered.' },
		],
		events: [
			{
				name: 'os-confirm',
				description: 'Fires on confirm. Detail: `{ confirmed: true, remember: boolean }` — `remember` is the checkbox `remember-label` renders, `false` when there is none.',
			},
			{
				name: 'os-cancel',
				description: 'Fires on cancel (Cancel button, Escape, backdrop click). Detail: `{ confirmed: false }`.',
			},
		],

		example: html`
			<os-cluster gap="8">
				<os-button data-demo="ask">Ask me something</os-button>
				<os-button data-demo="danger" variant="danger">
					…and a destructive one
				</os-button>
			</os-cluster>
			<os-confirm-dialog
				title="Close this window?"
				message="Any unsaved changes will be lost."
				confirm-label="Close"
			></os-confirm-dialog>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const dialog = root.querySelector( 'os-confirm-dialog' );
			if ( ! dialog ) {
				return;
			}
			const ask = root.querySelector< HTMLElement >( '[data-demo="ask"]' );
			const danger = root.querySelector< HTMLElement >(
				'[data-demo="danger"]',
			);

			if ( ask ) {
				ask.onclick = () => {
					dialog.removeAttribute( 'danger' );
					dialog.setAttribute( 'title', 'Close this window?' );
					dialog.setAttribute(
						'message',
						'Any unsaved changes will be lost.',
					);
					dialog.setAttribute( 'confirm-label', 'Close' );
					dialog.setAttribute( 'open', '' );
				};
			}
			if ( danger ) {
				danger.onclick = () => {
					dialog.setAttribute( 'danger', '' );
					dialog.setAttribute( 'title', 'Empty the recycle bin?' );
					dialog.setAttribute(
						'message',
						'47 items will be deleted permanently. This cannot be undone.',
					);
					dialog.setAttribute( 'confirm-label', 'Delete forever' );
					dialog.setAttribute( 'open', '' );
				};
			}
		},
	} as const;

	private _prevFocus: HTMLElement | null = null;

	private _focusTries = 0;

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute( 'role', 'dialog' );
		this.setAttribute( 'aria-modal', 'true' );

		if ( ! this.hasAttribute( 'tabindex' ) ) {
			this.setAttribute( 'tabindex', '-1' );
		}
		this.addEventListener( 'keydown', this._onKey );
		this.addEventListener( 'click', this._onBackdrop );
	}

	disconnectedCallback() {
		this.removeEventListener( 'keydown', this._onKey );
		this.removeEventListener( 'click', this._onBackdrop );

		this._restoreFocus();
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		if ( name !== 'open' ) {
			return;
		}
		if ( newValue !== null ) {
			this._prevFocus = deepActiveElement( this.ownerDocument );
			this._focusTries = 0;
			queueMicrotask( this._focusInitial );
		} else {
			this._restoreFocus();
		}
	}

	private _onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			this._cancel();
			return;
		}
		if ( e.key === 'Tab' ) {
			this._trapTab( e );
			return;
		}
		if ( e.key === 'Enter' && ! e.isComposing ) {
			if ( isControl( eventSource( e ) ) ) {
				return;
			}

			if ( this.hasAttribute( 'danger' ) ) {
				return;
			}
			e.preventDefault();
			this._confirm();
		}
	};

	private _focusables(): HTMLElement[] {
		const root = this.shadowRoot;
		if ( ! root ) {
			return [];
		}
		return Array.from( root.querySelectorAll< HTMLElement >( FOCUSABLE ) );
	}

	private _trapTab( e: KeyboardEvent ): void {
		const focusables = this._focusables();
		if ( focusables.length === 0 ) {
			return;
		}
		const first = focusables[ 0 ];
		const last = focusables[ focusables.length - 1 ];
		const active = eventSource( e );
		const loose = ! isControl( active );
		if ( e.shiftKey && ( loose || active === first ) ) {
			e.preventDefault();
			last.focus();
		} else if ( ! e.shiftKey && ( loose || active === last ) ) {
			e.preventDefault();
			first.focus();
		}
	}

	private _focusInitial = (): void => {
		if ( ! this.hasAttribute( 'open' ) ) {
			return;
		}
		const target = this.isConnected ? this._initialFocusTarget() : null;
		if ( target ) {
			target.focus();
			return;
		}
		if ( this._focusTries++ < 5 ) {
			queueMicrotask( this._focusInitial );
			return;
		}

		if ( this.isConnected ) {
			this.focus();
		}
	};

	private _initialFocusTarget(): HTMLElement | null {
		const root = this.shadowRoot;
		if ( ! root ) {
			return null;
		}
		const cancel = root.querySelector< HTMLElement >( '.btn--secondary' );

		const container = root.querySelector< HTMLElement >( '.dialog' );
		if ( this.hasAttribute( 'danger' ) ) {
			return (
				cancel ?? root.querySelector< HTMLElement >( '.close' ) ?? container
			);
		}
		return (
			root.querySelector< HTMLElement >( '.btn--primary, .btn--danger' ) ??
			cancel ??
			container
		);
	}

	private _restoreFocus(): void {
		const prev = this._prevFocus;
		this._prevFocus = null;
		if ( ! prev || ! prev.isConnected ) {
			return;
		}
		prev.focus();
	}

	private _onBackdrop = ( e: MouseEvent ): void => {
		const path = e.composedPath();
		const original = path.length > 0 ? path[ 0 ] : e.target;
		if ( original === this ) {
			this._cancel();
		}
	};

	private _remembered(): boolean {
		const box = this.shadowRoot?.querySelector< HTMLInputElement >(
			'.remember__box',
		);
		return box?.checked === true;
	}

	private _confirm = (): void => {
		this.emit( 'os-confirm', {
			confirmed: true,
			remember: this._remembered(),
		} );
		this.removeAttribute( 'open' );
	};

	private _cancel = (): void => {
		this.emit( 'os-cancel', { confirmed: false } );
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
		const rememberLabel =
			( this as unknown as { 'remember-label': string | null } )[ 'remember-label' ] ?? '';
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
				${ rememberLabel
					? html`<label class="remember">
						<input type="checkbox" class="remember__box" />
						<span class="remember__label">${ rememberLabel }</span>
					</label>`
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
defineComponent( 'os-confirm-dialog', OsConfirmDialog );

export interface OsConfirmOptions {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;

	hideCancel?: boolean;

	dismissable?: boolean;

	rememberLabel?: string;

	onRemember?: ( remember: boolean ) => void;
}

export function osConfirm( options: OsConfirmOptions ): Promise< boolean > {
	return new Promise( ( resolve ) => {
		const dialog = document.createElement( 'os-confirm-dialog' );
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
		if ( options.rememberLabel ) {
			dialog.setAttribute( 'remember-label', options.rememberLabel );
		}
		const cleanup = ( ok: boolean ): void => {
			dialog.remove();
			resolve( ok );
		};
		dialog.addEventListener( 'os-confirm', ( e: Event ) => {
			options.onRemember?.(
				( e as CustomEvent< { remember?: boolean } > ).detail
					?.remember === true,
			);
			cleanup( true );
		} );
		dialog.addEventListener( 'os-cancel', () => cleanup( false ) );
		document.body.appendChild( dialog );
	} );
}
