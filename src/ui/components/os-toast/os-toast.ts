import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';
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

const TONE_ICON: Record< string, 'check' | 'warning' | 'info' > = {
	positive: 'check',
	warning: 'warning',
	critical: 'warning',
	neutral: 'info',
};

export class OsToast extends Component {
	static props = [ 'action', 'state', 'dismissible', 'tone' ] as const;
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
				name: 'tone',
				type: "'positive' | 'warning' | 'critical' | 'neutral'",
				description: 'What kind of news this is. Paints a coloured edge and a leading icon from the palette’s notice tokens; absent, the toast is the plain dark chip. showToast() sets it from the type option through the server’s toast-type registry.',
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
			<os-toast state="in" tone="critical">Could not move the post to trash.</os-toast>
		`,
	} as const;

	private _hovered = false;

	private _focused = false;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}

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
		const next = e.relatedTarget;
		if ( next instanceof Node && this._containsDeep( next ) ) {
			return;
		}
		this._focused = false;
		this._syncHold();
	};

	private _containsDeep( node: Node ): boolean {
		let n: Node | null = node;
		while ( n ) {
			if ( n === this ) {
				return true;
			}

			const parent: ParentNode | null = n.parentNode;
			n = parent instanceof ShadowRoot ? parent.host : parent;
		}
		return false;
	}

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

		const tone = ( this as unknown as { tone: string | null } ).tone || '';
		return html`
			<span class="os-toast__icon" ?hidden=${ ! tone } aria-hidden="true">
				${ osIcon( TONE_ICON[ tone ] ?? 'info', { size: 16 } ) }
			</span>
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
				${ osIcon( 'close', { size: 16 } ) }
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
