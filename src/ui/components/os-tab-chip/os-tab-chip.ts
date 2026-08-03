/**
 * `<os-tab-chip>` — small action button inside an external sub-
 * tab. Two variants: `detach` (lifts + accent wash on hover) and
 * `close` (red destructive wash). Clicks bubble as native `click`
 * events; consumer reads `variant` if it needs to distinguish.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-tab-chip.styles';

const ICONS: Record<string, string> = {
	detach:
		'<path d="M5 2H2.5v7.5H10V7M6.5 2H10v3.5M10 2L5.5 6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
	close:
		'<path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

export class OsTabChip extends Component {
	static props = [ 'variant' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Tab chip',
		summary:
			'Small action button dropped inside an external sub-tab. `detach` lifts with an accent wash on hover; `close` uses a red destructive wash. Click bubbles as a native click — consumers read `variant` if they need to distinguish.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'variant',
				type: "'detach' | 'close'",
				description: 'Selects the built-in SVG icon and the hover wash colour.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Optional custom icon markup when `variant` is omitted.' },
		],
		example: html`
			<os-cluster gap="4">
				<os-tab-chip variant="detach"></os-tab-chip>
				<os-tab-chip variant="close"></os-tab-chip>
			</os-cluster>
		`,
	} as const;

	protected render() {
		const variant =
			( this as unknown as { variant: string | null } ).variant || '';
		const svgInner = ICONS[ variant ] || '';
		return html`
			<button type="button">
				<svg
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
}
defineComponent( 'os-tab-chip', OsTabChip );
