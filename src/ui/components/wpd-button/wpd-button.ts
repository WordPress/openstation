/**
 * `<wpd-button>` — thin wrapper around `<button>` with consistent
 * variant styling + a slot for the label.
 *
 * Variants (Stable, will not be renamed within a major release):
 *
 *   - `primary`   — accent-colored, attention-grabbing action. One
 *                   per surface.
 *   - `secondary` — neutral filled control. Quiet action in a row
 *                   of mostly-primary controls (Save / Cancel;
 *                   AC / ± / % on a calculator).
 *   - `danger`    — destructive action. Red outline → red fill on hover.
 *   - `ghost`     — default. Transparent background, 1 px border.
 *   - `link`      — underline only, no chrome.
 *
 * `fill-cell` boolean attribute makes the host fill its parent
 * cell (flex / grid item), growing width AND the inner button
 * height. Intended for grid-based surfaces like a calculator
 * keypad where every key should tile flush.
 *
 * CSS custom-property surface (documented in
 * `docs/components-reference.md`):
 *
 *   --wpd-button-bg              — background color
 *   --wpd-button-bg-hover        — hover wash (ghost + secondary)
 *   --wpd-button-fg              — text color
 *   --wpd-button-border          — shorthand for the border
 *   --wpd-button-border-radius   — corner radius (default 6px)
 *   --wpd-button-padding         — shorthand for padding (default "6px 12px")
 *   --wpd-button-min-height      — minimum height when `fill-cell` is set
 *
 * Shadow parts (author hook — use with `::part(button)`):
 *
 *   button — the underlying `<button>` element.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-button.styles';

/**
 * Stable string enum of recognised variants. Exported so
 * plugin-side TS can narrow.
 */
export type WpdButtonVariant =
	| 'primary'
	| 'secondary'
	| 'ghost'
	| 'danger'
	| 'link';

export class WpdButton extends Component {
	static props = [ 'variant', 'disabled', 'type', 'busy', 'fill-cell' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Button',
		summary:
			'Thin wrapper around <button> with consistent variant styling and a slot for the label.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'variant',
				type: "'primary' | 'secondary' | 'ghost' | 'danger' | 'link'",
				default: 'ghost',
				description:
					'Visual weight of the button. Use primary for the single attention-grabbing action per surface.',
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
		],
		slots: [ { name: '(default)', description: 'Button label.' } ],
		parts: [ { name: 'button', description: 'Underlying <button> element.' } ],
		cssProps: [
			{ name: '--wpd-button-bg', description: 'Background color.' },
			{
				name: '--wpd-button-bg-hover',
				description: 'Hover wash (ghost + secondary variants).',
			},
			{ name: '--wpd-button-fg', description: 'Text color.' },
			{ name: '--wpd-button-border', description: 'Border shorthand.' },
			{ name: '--wpd-button-border-radius', default: '6px' },
			{ name: '--wpd-button-padding', default: '6px 12px' },
			{
				name: '--wpd-button-min-height',
				description: 'Minimum height when fill-cell is set.',
			},
		],
		example: html`
			<wpd-cluster gap="8">
				<wpd-button variant="primary">Primary</wpd-button>
				<wpd-button variant="secondary">Secondary</wpd-button>
				<wpd-button variant="ghost">Ghost</wpd-button>
				<wpd-button variant="danger">Danger</wpd-button>
				<wpd-button variant="link">Link</wpd-button>
			</wpd-cluster>
		`,
	} as const;

	protected render() {
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const busy =
			( this as unknown as { busy: string | null } ).busy !== null;
		const type = ( this as unknown as { type: string | null } ).type || 'button';
		return html`
			<button
				part="button"
				type=${ type }
				?disabled=${ disabled || busy }
				aria-busy=${ busy ? 'true' : 'false' }
			>
				${ busy
					? html`<span class="wpd-button__spinner" aria-hidden="true"></span>`
					: '' }
				<slot></slot>
			</button>
		`;
	}
}
defineComponent( 'wpd-button', WpdButton );
