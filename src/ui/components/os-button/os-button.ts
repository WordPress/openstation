import { Component, defineComponent, html } from '../../core';
import { styles } from './os-button.styles';

export type OsButtonVariant =
	| 'holo'
	| 'primary'
	| 'secondary'
	| 'ghost'
	| 'danger'
	| 'link';

export class OsButton extends Component {
	static props = [ 'variant', 'disabled', 'type', 'busy', 'fill-cell' ] as const;
	static styles = [ styles ];

	static get observedAttributes(): string[] {
		return [ ...super.observedAttributes, 'aria-label' ];
	}

	static help = {
		title: 'Button',
		summary:
			'Thin wrapper around <button> with consistent variant styling and a slot for the label.',
		status: 'stable',
		props: [
			{
				name: 'variant',
				type: "'holo' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'",
				default: 'ghost',
				description:
					'Visual weight of the button. Use primary for the single attention-grabbing action per surface, and holo — the Holomesh fill — only for a hero call to action.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disable pointer + keyboard interaction and dim the chrome.',
			},
			{
				name: 'type',
				type: "'button' | 'submit' | 'reset'",
				default: 'button',
				description: 'Forwarded to the underlying native <button>.',
			},
			{
				name: 'busy',
				type: 'boolean attribute',
				description: 'Marks the button as in-progress (e.g., awaiting a fetch).',
			},
			{
				name: 'fill-cell',
				type: 'boolean attribute',
				description:
					'Grow to fill the parent flex/grid cell. Useful for tiled keypads.',
			},
			{
				name: 'aria-label',
				type: 'string',
				description:
					'Accessible name for an icon-only button, forwarded onto the shadow <button> that takes focus.',
			},
		],
		slots: [ { name: '(default)', description: 'Button label.' } ],
		parts: [ { name: 'button', description: 'Underlying <button> element.' } ],
		cssProps: [
			{ name: '--os-ui-button-bg', description: 'Background color.' },
			{
				name: '--os-ui-button-bg-hover',
				description: 'Hover wash (ghost + secondary variants).',
			},
			{ name: '--os-ui-button-fg', description: 'Text color.' },
			{ name: '--os-ui-button-border', description: 'Border shorthand.' },
			{ name: '--os-ui-button-border-radius', default: '6px' },
			{ name: '--os-ui-button-padding', default: '6px 12px' },
			{
				name: '--os-ui-button-min-height',
				description: 'Minimum height when fill-cell is set.',
			},
		],
		example: html`
			<os-cluster gap="8">
				<os-button variant="holo">Holo</os-button>
				<os-button variant="primary">Primary</os-button>
				<os-button variant="secondary">Secondary</os-button>
				<os-button variant="ghost">Ghost</os-button>
				<os-button variant="danger">Danger</os-button>
				<os-button variant="link">Link</os-button>
			</os-cluster>
		`,
	} as const;

	protected render() {
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const busy =
			( this as unknown as { busy: string | null } ).busy !== null;
		const type = ( this as unknown as { type: string | null } ).type || 'button';

		const ariaLabel = this.getAttribute( 'aria-label' ) || '';
		return html`
			<button
				part="button"
				class="os-holo-edge os-holo-sheen"
				type=${ type }
				?disabled=${ disabled || busy }
				aria-busy=${ busy ? 'true' : 'false' }
				aria-label=${ ariaLabel }
			>
				${ busy
					? html`<span class="os-button__spinner" aria-hidden="true"></span>`
					: '' }
				<slot></slot>

				<span class="os-holo-glint" aria-hidden="true"></span>
				<span class="os-holo-ring" aria-hidden="true"></span>
			</button>
		`;
	}
}
defineComponent( 'os-button', OsButton );
