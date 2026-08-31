/**
 * `<os-confirm-dialog>` — modal Yes/No replacement for the
 * native browser `confirm()`. Wired up around the same idea as
 * macOS / Windows: title, body, two buttons, Escape cancels,
 * Enter confirms.
 *
 * **Keyboard and focus.** Opening moves focus into the dialog and
 * remembers what had it, so closing hands it straight back to the
 * control that opened the prompt. Tab cycles inside the dialog and
 * cannot reach the page behind the scrim. Escape always cancels.
 * Enter is the dialog's *default* action only while no control
 * inside it owns the key — with Cancel focused, Enter cancels, the
 * way every other button on the platform behaves. A `danger` dialog
 * has no default action at all: it opens on the safe control and
 * never on its destructive button, so Enter is never the shortcut
 * that deletes.
 *
 * Two ways to use it:
 *
 * **1. As a Web Component, declarative.** Mount the element,
 * set `open`, listen for `os-confirm`:
 *
 * ```html
 * <os-confirm-dialog id="d" title="Empty trash?" message="…" danger></os-confirm-dialog>
 * <script>
 *   document.getElementById('d').addEventListener('os-confirm', e => …);
 *   document.getElementById('d').setAttribute('open', '');
 * </script>
 * ```
 *
 * **2. Imperatively, Promise-returning.** The exported
 * `osConfirm()` helper mounts the component on `document.body`,
 * resolves with `true` / `false`, and tears down. This is the
 * drop-in replacement for `window.confirm()`:
 *
 * ```ts
 * import { osConfirm } from '<…>/os-confirm-dialog';
 * if ( await osConfirm( { title: 'Delete?', message: 'Cannot undo.', danger: true } ) ) {
 *     // …
 * }
 * ```
 */

import { Component, defineComponent, html } from '../../core';
import { dialogStyles } from './os-confirm-dialog.styles';

/**
 * Everything the dialog is allowed to hand focus to. Same list
 * `<os-modal>` uses — the dialog's own controls all live in the
 * shadow root, so this only ever matches the buttons we render.
 */
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The genuinely focused element, walking through any shadow roots on
 * the way down. `document.activeElement` stops at the outermost host,
 * which for this shell is almost always an `<os-*>` wrapper rather
 * than the control the user actually pressed — and re-focusing a host
 * that is not itself focusable silently drops focus on the floor.
 */
function deepActiveElement( doc: Document | null ): HTMLElement | null {
	let el = ( doc?.activeElement ?? null ) as HTMLElement | null;
	while ( el?.shadowRoot?.activeElement ) {
		el = el.shadowRoot.activeElement as HTMLElement;
	}
	return el && el !== doc?.body ? el : null;
}

/**
 * The element a keyboard event actually started on. `e.target`
 * retargets to the host at the shadow boundary, so it is the host for
 * every key pressed on one of the dialog's own buttons — the deepest
 * entry in the composed path is the one that answers "what has
 * focus?".
 */
function eventSource( e: Event ): HTMLElement | null {
	const path = e.composedPath();
	const deepest = path.length > 0 ? path[ 0 ] : e.target;
	return deepest instanceof HTMLElement ? deepest : null;
}

/** Whether an element is one of the dialog's focusable controls. */
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
		/*
		 * A dialog is `display: none` until `[open]`, so mounting one
		 * on its own shows nothing — which is exactly what this
		 * component's help pane did before. The trigger IS the
		 * example: a dialog you cannot open demonstrates nothing.
		 *
		 * Wiring lives in `exampleInit` rather than in an `@click` in
		 * the template so the lookup is scoped to the example's own
		 * container. `onclick =` assignment rather than
		 * `addEventListener` because the panel re-runs this on every
		 * keystroke in the filter box, and assignment replaces where
		 * adding would stack.
		 */
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
			// Assignment, not addEventListener: see the note above.
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

	/** What had focus when the dialog opened, to hand it back on close. */
	private _prevFocus: HTMLElement | null = null;

	/** Microtask hops spent waiting for the first render. See `_focusInitial`. */
	private _focusTries = 0;

	connectedCallback() {
		super.connectedCallback();
		this.setAttribute( 'role', 'dialog' );
		this.setAttribute( 'aria-modal', 'true' );
		// Programmatically focusable, never tab-reachable: the last-
		// resort target in `_focusInitial`. `-1` also keeps the host
		// out of `isControl`, so Enter on it still reads as the
		// container rather than as a control owning the key.
		if ( ! this.hasAttribute( 'tabindex' ) ) {
			this.setAttribute( 'tabindex', '-1' );
		}
		this.addEventListener( 'keydown', this._onKey );
		this.addEventListener( 'click', this._onBackdrop );
	}

	disconnectedCallback() {
		this.removeEventListener( 'keydown', this._onKey );
		this.removeEventListener( 'click', this._onBackdrop );
		// `osConfirm()` removes the element while it is still `[open]`,
		// so unmounting — not the attribute — is where that path ends.
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
			/*
			 * Enter is the dialog's default action only while nothing
			 * inside it owns the key. A focused button activates itself
			 * natively; swallowing that here is how Enter on "Cancel"
			 * used to run the destructive branch instead.
			 */
			if ( isControl( eventSource( e ) ) ) {
				return;
			}
			/*
			 * A destructive dialog has no default action at all. Focus
			 * opens on a safe control, but `hide-cancel` without
			 * `dismissable` leaves none to open on, and clicking the
			 * message text focuses the container — both leave Enter
			 * pointing at the container, and on a danger dialog the
			 * container's default would be the deletion. Reaching the
			 * destructive button has to be deliberate: Tab to it, or
			 * click it.
			 */
			if ( this.hasAttribute( 'danger' ) ) {
				return;
			}
			e.preventDefault();
			this._confirm();
		}
	};

	/** Every focusable control the dialog renders, in tab order. */
	private _focusables(): HTMLElement[] {
		const root = this.shadowRoot;
		if ( ! root ) {
			return [];
		}
		return Array.from( root.querySelectorAll< HTMLElement >( FOCUSABLE ) );
	}

	/**
	 * Keep Tab inside the dialog. Wrapping at either end is the trap
	 * itself; the `! isControl` branch covers the container, which
	 * holds focus before the user has touched a button.
	 */
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

	/**
	 * Move focus into the dialog once it has something to move it to.
	 *
	 * Two things run late here: `osConfirm()` sets `open` before it
	 * appends the element, and the base class renders on a microtask.
	 * So the first hop can find us detached, or mounted with an empty
	 * shadow root. Retry over a few microtasks rather than guess at a
	 * timing — the container always renders, so a hit is the signal
	 * that the render landed.
	 */
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
		/*
		 * Out of hops with nothing rendered to aim at. Take the host,
		 * which `connectedCallback` makes focusable for exactly this:
		 * it carries the keydown listener, so Escape and the Tab trap
		 * keep working. Giving up instead would leave focus on the
		 * opener — the user parked behind the scrim, with a live modal
		 * in front of them and no key that dismisses it.
		 */
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
		// The container. Always rendered, so a hit here is also what
		// tells `_focusInitial` the first render landed.
		const container = root.querySelector< HTMLElement >( '.dialog' );
		if ( this.hasAttribute( 'danger' ) ) {
			/*
			 * A destructive dialog opens on the safe choice, the way the
			 * desktop platforms do it. Cancel first, then the X that
			 * `dismissable` adds — `hide-cancel` drops the former and is
			 * documented to pair with the latter for exactly this reason.
			 * With neither, the container takes focus: there is no safe
			 * control to offer, and offering the destructive one instead
			 * is the failure this whole branch exists to prevent.
			 */
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

	/**
	 * Hand focus back to whatever opened the dialog, once.
	 *
	 * `isConnected` is the whole guard: an opener that unmounted while
	 * the dialog was up is the one case that actually arises, and
	 * `focus()` on a live element in this document does not throw.
	 */
	private _restoreFocus(): void {
		const prev = this._prevFocus;
		this._prevFocus = null;
		if ( ! prev || ! prev.isConnected ) {
			return;
		}
		prev.focus();
	}

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

	/**
	 * The "don't ask again" checkbox's state, or `false` when the
	 * dialog renders none. Read off the live DOM rather than mirrored
	 * into a field: the input owns its own checked state, and a copy
	 * would only be a second thing to keep in sync.
	 */
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
	/** Hide the cancel button entirely. Pair with `dismissable` to keep a way to close. */
	hideCancel?: boolean;
	/** Render an X close button in the top-right corner. Click emits `os-cancel`. */
	dismissable?: boolean;
	/**
	 * Label for a "don't ask again" checkbox rendered above the
	 * buttons. Omit it and no checkbox is rendered — which is the
	 * right default: a question worth asking is usually worth asking
	 * every time, and the opt-out only makes sense where the caller
	 * has somewhere to persist it and somewhere to turn it back on.
	 */
	rememberLabel?: string;
	/**
	 * Called with the checkbox state when the user CONFIRMS. Never
	 * called on cancel: a question the user backed out of was not
	 * answered, so "don't ask me this again" cannot have been meant.
	 */
	onRemember?: ( remember: boolean ) => void;
}

/**
 * Imperative Promise-returning wrapper. Mounts a fresh
 * `<os-confirm-dialog>` on `document.body`, resolves with
 * `true` (confirm) or `false` (cancel / Escape / backdrop), then
 * tears the element down.
 */
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
		// Focus is the component's job — it captures the opener on
		// `[open]` and moves into the dialog once the first render
		// lands, which has not happened yet at this point.
	} );
}
