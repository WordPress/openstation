import { Component, defineComponent, html } from '../../core';
import { styles } from './os-window-button.styles';

const ICONS: Record<string, string> = {
	minimize:
		'<path d="M3 6h6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
	maximize:
		'<rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/>',
	fullscreen:
		'<path d="M4.5 2H2v2.5M10 4.5V2H7.5M4.5 10H2V7.5M10 7.5V10H7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	'fullscreen-exit':
		'<path d="M2 4.5H4.5V2M7.5 2V4.5H10M2 7.5H4.5V10M7.5 10V7.5H10" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	detach:
		'<path d="M5 2H2.5v7.5H10V7M6.5 2H10v3.5M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	reload:

		'<g transform="translate(0.6 0.6) scale(0.021)" fill="currentColor">' +
		'<path d="m504.554 233.704-76.447 91.467c-6.329 7.572-15.417 11.479-24.571 11.479a31.872 31.872 0 0 1-20.504-7.447l-91.467-76.447c-13.561-11.334-15.366-31.515-4.032-45.075s31.515-15.366 45.075-4.032l37.506 31.347c-10.274-74.891-74.668-132.774-152.337-132.774C132.984 102.223 64 171.207 64 256s68.984 153.777 153.777 153.777c17.673 0 32 14.327 32 32s-14.327 32-32 32c-58.17 0-112.859-22.653-153.991-63.785C22.653 368.859 0 314.17 0 256s22.653-112.859 63.786-153.992c41.132-41.132 95.821-63.785 153.991-63.785s112.859 22.653 153.992 63.785c32.517 32.516 53.471 73.508 60.829 117.991l22.849-27.339c11.334-13.56 31.515-15.364 45.075-4.032 13.56 11.335 15.365 31.516 4.032 45.076z"/>' +
		'</g>',
	close:
		'<path d="M3.25 3.25l5.5 5.5M3.25 8.75l5.5-5.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>',
	menu:
		'<circle cx="3" cy="6" r="1.2" fill="currentColor"/>' +
		'<circle cx="6" cy="6" r="1.2" fill="currentColor"/>' +
		'<circle cx="9" cy="6" r="1.2" fill="currentColor"/>',
};

function sanitizeIconSrc( raw: string ): string {
	const value = ( raw ?? '' ).trim();
	if ( value === '' || value.length > 4096 ) {
		return '';
	}
	if ( ! /^(https?:\/\/|data:image\/)/i.test( value ) ) {
		return '';
	}
	if ( /['"()\\<>\s]/.test( value ) ) {
		return '';
	}
	return value;
}

export class OsWindowButton extends Component {
	static props = [ 'icon', 'icon-src', 'active', 'danger', 'disabled' ] as const;
	static styles = [ styles ];

	static get observedAttributes(): string[] {
		return [ ...super.observedAttributes, 'aria-label', 'aria-pressed' ];
	}

	static help = {
		title: 'Window button',
		summary:
			'Chrome button used in native-window title bars. Built-in icons cover the standard controls (minimize, maximize, fullscreen, detach, close, menu). Focused/unfocused coloring is driven by --os-ui-btn-* CSS custom properties the window shell owns.',
		status: 'stable',
		props: [
			{ name: 'disabled', type: 'boolean attribute', description: 'Disables native activation and removes the button from keyboard navigation.' },
			{ name: 'aria-pressed', type: "'true' | 'false' | 'mixed'", description: 'Optional toggle state forwarded to the focusable shadow button.' },
			{
				name: 'icon',
				type: "'minimize' | 'maximize' | 'fullscreen' | 'fullscreen-exit' | 'detach' | 'reload' | 'close' | 'menu'",
				description: 'Which built-in inline SVG to paint. Omit to supply your own via the slot.',
			},
			{
				name: 'aria-label',
				type: 'string',
				description: 'Accessible name, forwarded onto the shadow <button> that takes focus. Required — the glyph is aria-hidden.',
			},
			{
				name: 'active',
				type: 'boolean attribute',
				description: 'Applies the pressed-down look (used e.g. while a menu it triggers is open).',
			},
			{
				name: 'danger',
				type: 'boolean attribute',
				description: 'Swaps the hover wash to red — used by the close button.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Optional custom icon markup (inline SVG) when `icon` is omitted.' },
		],
		cssProps: [
			{ name: '--os-ui-btn-color', description: 'Resting foreground.' },
			{ name: '--os-ui-btn-color-hover', description: 'Hover foreground.' },
			{ name: '--os-ui-btn-bg-hover', description: 'Hover background wash.' },
			{ name: '--os-ui-btn-bg-active', description: 'Pressed background.' },
			{ name: '--os-ui-btn-danger-hover', description: 'Hover background for danger variant.' },
			{ name: '--os-ui-btn-outline', description: 'Focus outline colour.' },
		],
		example: html`
			<os-cluster gap="2">
				<os-window-button icon="minimize"></os-window-button>
				<os-window-button icon="maximize"></os-window-button>
				<os-window-button icon="menu"></os-window-button>
				<os-window-button icon="close" danger></os-window-button>
			</os-cluster>
		`,
	} as const;

	protected render() {
		const iconSrc = sanitizeIconSrc(
			( this as unknown as { 'icon-src'?: string | null } )[ 'icon-src' ] ||
				this.getAttribute( 'icon-src' ) ||
				'',
		);
		const iconKey = iconSrc
			? ''
			: ( this as unknown as { icon: string | null } ).icon || '';

		const svgInner = ICONS[ iconKey ] || '';

		const label = this.getAttribute( 'aria-label' ) || '';
		if ( iconSrc ) {
			return html`
				<button type="button" aria-label="${ label }" aria-pressed="${ this.getAttribute( 'aria-pressed' ) || '' }" ?disabled="${ this.hasAttribute( 'disabled' ) }">
					<span
						class="themed-icon"
						aria-hidden="true"
						style="-webkit-mask: url('${ iconSrc }') center / contain no-repeat; mask: url('${ iconSrc }') center / contain no-repeat;"
					></span>
					<slot></slot>
				</button>
			`;
		}
		return html`
			<button type="button" aria-label="${ label }" aria-pressed="${ this.getAttribute( 'aria-pressed' ) || '' }" ?disabled="${ this.hasAttribute( 'disabled' ) }">
				<svg
					width="14"
					height="14"
					viewBox="0 0 12 12"
					aria-hidden="true"
					focusable="false"
				></svg>
				<slot></slot>
			</button>
			<span data-svg-buffer style="display:none">${ svgInner }</span>
		`;
	}

	connectedCallback(): void {
		super.connectedCallback();
		queueMicrotask( () => this._paintSvg() );

		queueMicrotask( () => this._wireActivateEvent() );
	}

	attributeChangedCallback(
		name: string,
		oldValue: string | null,
		newValue: string | null,
	): void {
		super.attributeChangedCallback( name, oldValue, newValue );
		queueMicrotask( () => this._paintSvg() );
	}

	private _paintSvg(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const svg = root.querySelector( 'svg' );
		const buffer = root.querySelector( '[data-svg-buffer]' );
		if ( svg && buffer ) {
			const markup = buffer.textContent || '';

			if ( svg.innerHTML !== markup ) {
				svg.innerHTML = markup;
			}
		}
	}

	private _activateWired = false;

	private _wireActivateEvent(): void {
		if ( this._activateWired ) {
			return;
		}
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const button = root.querySelector( 'button' );
		if ( ! button ) {
			return;
		}
		this._activateWired = true;

		button.addEventListener( 'click', () => {
			if ( this.hasAttribute( 'disabled' ) ) {
				return;
			}
			this.dispatchEvent(
				new CustomEvent( 'os-button-activate', {
					bubbles: true,
					composed: true,
					cancelable: true,
				} ),
			);
		} );
	}
}
defineComponent( 'os-window-button', OsWindowButton );
