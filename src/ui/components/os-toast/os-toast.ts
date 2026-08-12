/**
 * `<os-toast-container>` + `<os-toast>` — transient top-right
 * notifications.
 *
 * Container lives as a singleton under `<body>` (created lazily by
 * `showToast()` in `src/toast.ts`) and stacks toasts vertically.
 * Each `<os-toast>` carries the message text as slotted content
 * and an optional action button via an `action` attribute + a
 * `os-toast-action` CustomEvent fired when the button is clicked.
 *
 * The fade-in / fade-out choreography is driven by a `state`
 * attribute (`'in'` → visible, `'out'` → fading) — the component's
 * stylesheet does the actual transition. JS just flips the attr.
 *
 * A toast also reports when it is being *attended to*: pointer over
 * it, or focus somewhere inside it. It reflects that as a `held`
 * attribute and emits `os-toast-hold` on every change. The element
 * owns the detection because it is the thing being pointed at; the
 * auto-dismiss timer lives in `showToast()`, which listens and pauses.
 * A countdown that runs while the user is reading the message — or
 * worse, while their focus is parked on the Undo button — is the
 * shell deleting the control out from under them and dropping focus
 * on `<body>`.
 */

import { Component, defineComponent, html } from '../../core';
import { __ } from '../../../i18n';
import { containerStyles, toastStyles } from './os-toast.styles';

export class OsToastContainer extends Component {
	static styles = [ containerStyles ];

	static help = {
		title: 'Toast container',
		summary:
			'Singleton stack beneath <body> that hosts transient <os-toast> notifications in the top-right. Created lazily by showToast(); authors rarely place one themselves.',
		status: 'stable',
		slots: [
			{ name: '(default)', description: '<os-toast> children, stacked vertically.' },
		],
		cssProps: [
			{ name: '--os-z-fullscreen', description: 'z-index base — toasts sit above fullscreen windows.' },
		],
		example: html`
			<os-toast-container>
				<os-toast state="in">Settings saved.</os-toast>
				<os-toast state="in" action="Undo">Theme changed.</os-toast>
			</os-toast-container>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		this.setAttribute( 'aria-live', 'polite' );
	}

	protected render() {
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-toast-container', OsToastContainer );

export class OsToast extends Component {
	static props = [ 'action', 'state', 'dismissible' ] as const;
	static styles = [ toastStyles ];

	static help = {
		title: 'Toast',
		summary:
			'Single transient notification. Message is slotted; fade-in / fade-out is CSS-driven by flipping the state attribute between "in" and "out". Usually created via the showToast() helper rather than authored by hand.',
		status: 'stable',
		props: [
			{
				name: 'action',
				type: 'string',
				description: 'Optional action button label. When set, a button renders on the right and emits os-toast-action on click.',
			},
			{
				name: 'state',
				type: "'in' | 'out'",
				description: 'Drives the CSS fade transition. Set to "in" when rendered, flip to "out" before removal.',
			},
			{
				name: 'dismissible',
				type: 'boolean',
				description: 'When set, a close (×) button renders on the right and emits os-toast-dismiss on click. Use for persistent toasts the user must be able to close.',
			},
			{
				name: 'held',
				type: 'boolean (reflected, read-only)',
				description: 'Set by the component while the pointer is over the toast or focus is inside it. showToast() pauses the auto-dismiss timer for as long as it is present. Do not set it by hand — pass `persistent` for a toast that should never expire.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Message text.' },
		],
		events: [
			{
				name: 'os-toast-action',
				description: 'Fires when the action button is clicked.',
				detail: '{}',
			},
			{
				name: 'os-toast-dismiss',
				description: 'Fires when the close (×) button is clicked.',
				detail: '{}',
			},
			{
				name: 'os-toast-hold',
				description: 'Fires when the toast starts or stops being attended to — pointer over it, or focus inside it. showToast() pauses the auto-dismiss timer while held is true.',
				detail: '{ held: boolean }',
			},
		],
		example: html`
			<os-toast state="in" action="Undo">Post moved to trash.</os-toast>
		`,
	} as const;

	/** Pointer currently over the toast. */
	private _hovered = false;

	/** Focus currently somewhere inside the toast. */
	private _focused = false;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
		/*
		 * `mouseenter` / `mouseleave` rather than `mouseover` /
		 * `mouseout`: the enter/leave pair does not fire for moves
		 * between the toast and its own descendants, so the hold
		 * cannot flicker as the cursor crosses onto the action
		 * button. Touch input is emulated onto the same pair.
		 *
		 * `focusin` / `focusout` are composed, so a click on the
		 * action button inside the shadow root retargets to the host
		 * and lands here — which is the whole point: the button and
		 * the toast are one thing as far as "is the user on this?"
		 * is concerned.
		 */
		this.addEventListener( 'mouseenter', this._onEnter );
		this.addEventListener( 'mouseleave', this._onLeave );
		this.addEventListener( 'focusin', this._onFocusIn );
		this.addEventListener( 'focusout', this._onFocusOut );
	}

	disconnectedCallback(): void {
		this.removeEventListener( 'mouseenter', this._onEnter );
		this.removeEventListener( 'mouseleave', this._onLeave );
		this.removeEventListener( 'focusin', this._onFocusIn );
		this.removeEventListener( 'focusout', this._onFocusOut );
	}

	private _onEnter = (): void => {
		this._hovered = true;
		this._syncHold();
	};

	private _onLeave = (): void => {
		this._hovered = false;
		this._syncHold();
	};

	private _onFocusIn = (): void => {
		this._focused = true;
		this._syncHold();
	};

	private _onFocusOut = ( e: FocusEvent ): void => {
		// Moving between the action and close buttons fires focusout
		// before the matching focusin. Only a `relatedTarget` outside
		// the toast — including `null`, which is focus leaving the
		// document entirely — is a real release. Both buttons live in
		// the shadow root, where `contains()` stops: walk the tree
		// through the host instead.
		const next = e.relatedTarget;
		if ( next instanceof Node && this._containsDeep( next ) ) {
			return;
		}
		this._focused = false;
		this._syncHold();
	};

	/** Whether `node` is this toast or anything inside it, shadow root included. */
	private _containsDeep( node: Node ): boolean {
		let n: Node | null = node;
		while ( n ) {
			if ( n === this ) {
				return true;
			}
			// Annotated: without it the assignment below makes `n`'s
			// narrowed type depend on itself and inference gives up.
			const parent: ParentNode | null = n.parentNode;
			n = parent instanceof ShadowRoot ? parent.host : parent;
		}
		return false;
	}

	/**
	 * Reflect the combined state and announce changes. Emitting only
	 * on a real transition keeps `showToast()`'s pause/resume
	 * bookkeeping honest — a resume per `mousemove`-adjacent event
	 * would reset the countdown on every twitch.
	 */
	private _syncHold(): void {
		const held = this._hovered || this._focused;
		if ( held === this.hasAttribute( 'held' ) ) {
			return;
		}
		if ( held ) {
			this.setAttribute( 'held', '' );
		} else {
			this.removeAttribute( 'held' );
		}
		this.emit( 'os-toast-hold', { held } );
	}

	protected render() {
		const action =
			( this as unknown as { action: string | null } ).action || '';
		const dismissible = this.hasAttribute( 'dismissible' );
		// Always render the buttons; `?hidden` keeps them out of the
		// accessibility tree when unused. Means a single stable
		// template across render passes (my templater doesn't swap
		// subtrees mid-run).
		return html`
			<span class="os-toast__label"><slot></slot></span>
			<button
				type="button"
				?hidden=${ ! action }
				@click=${ ( e: Event ) => this._onAction( e ) }
			>
				${ action }
			</button>
			<button
				type="button"
				class="os-toast__close"
				aria-label=${ __( 'Dismiss' ) }
				?hidden=${ ! dismissible }
				@click=${ ( e: Event ) => this._onDismiss( e ) }
			>
				<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
					<path
						d="M3 3 L11 11 M11 3 L3 11"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						fill="none"
					></path>
				</svg>
			</button>
		`;
	}

	private _onAction( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.emit( 'os-toast-action', {} );
	}

	private _onDismiss( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.emit( 'os-toast-dismiss', {} );
	}
}
defineComponent( 'os-toast', OsToast );
