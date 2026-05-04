/**
 * `<wpd-toast-container>` + `<wpd-toast>` — transient top-right
 * notifications.
 *
 * Container lives as a singleton under `<body>` (created lazily by
 * `showToast()` in `src/toast.ts`) and stacks toasts vertically.
 * Each `<wpd-toast>` carries the message text as slotted content
 * and an optional action button via an `action` attribute + a
 * `wpd-toast-action` CustomEvent fired when the button is clicked.
 *
 * The fade-in / fade-out choreography is driven by a `state`
 * attribute (`'in'` → visible, `'out'` → fading) — the component's
 * stylesheet does the actual transition. JS just flips the attr.
 */

import { Component, defineComponent, html } from '../../core';
import { containerStyles, toastStyles } from './wpd-toast.styles';

export class WpdToastContainer extends Component {
	static styles = [ containerStyles ];

	static help = {
		title: 'Toast container',
		summary:
			'Singleton stack beneath <body> that hosts transient <wpd-toast> notifications in the top-right. Created lazily by showToast(); authors rarely place one themselves.',
		status: 'stable',
		since: '0.9.0',
		slots: [
			{ name: '(default)', description: '<wpd-toast> children, stacked vertically.' },
		],
		cssProps: [
			{ name: '--desktop-mode-z-fullscreen', description: 'z-index base — toasts sit above fullscreen windows.' },
		],
		example: html`
			<wpd-toast-container>
				<wpd-toast state="in">Settings saved.</wpd-toast>
				<wpd-toast state="in" action="Undo">Theme changed.</wpd-toast>
			</wpd-toast-container>
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
defineComponent( 'wpd-toast-container', WpdToastContainer );

export class WpdToast extends Component {
	static props = [ 'action', 'state' ] as const;
	static styles = [ toastStyles ];

	static help = {
		title: 'Toast',
		summary:
			'Single transient notification. Message is slotted; fade-in / fade-out is CSS-driven by flipping the state attribute between "in" and "out". Usually created via the showToast() helper rather than authored by hand.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'action',
				type: 'string',
				description: 'Optional action button label. When set, a button renders on the right and emits wpd-toast-action on click.',
			},
			{
				name: 'state',
				type: "'in' | 'out'",
				description: 'Drives the CSS fade transition. Set to "in" when rendered, flip to "out" before removal.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Message text.' },
		],
		events: [
			{
				name: 'wpd-toast-action',
				description: 'Fires when the action button is clicked.',
				detail: '{}',
			},
		],
		example: html`
			<wpd-toast state="in" action="Undo">Post moved to trash.</wpd-toast>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
	}

	protected render() {
		const action =
			( this as unknown as { action: string | null } ).action || '';
		// Always render the button element; `?hidden` keeps it out
		// of the accessibility tree when there's no action. Means
		// a single stable template across render passes (my
		// templater doesn't swap subtrees mid-run).
		return html`
			<span class="wpd-toast__label"><slot></slot></span>
			<button
				type="button"
				?hidden=${ ! action }
				@click=${ ( e: Event ) => this._onAction( e ) }
			>
				${ action }
			</button>
		`;
	}

	private _onAction( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.emit( 'wpd-toast-action', {} );
	}
}
defineComponent( 'wpd-toast', WpdToast );
