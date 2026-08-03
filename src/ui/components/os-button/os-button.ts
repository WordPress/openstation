/**
 * `<os-button>` — thin wrapper around `<button>` with consistent
 * variant styling + a slot for the label.
 *
 * Variants (Stable, will not be renamed within a major release):
 *
 *   - `holo`      — the hero CTA. Filled with the brand's Holomesh,
 *                   Void ink on top, and a Pulse glow; the fill tilts
 *                   under the pointer the way a foil card does. The
 *                   brand reserves meshes for hero surfaces, so this
 *                   is at most one per surface — often none.
 *   - `primary`   — accent-colored, attention-grabbing action. One
 *                   per surface.
 *   - `secondary` — neutral filled control. Quiet action in a row
 *                   of mostly-primary controls (Save / Cancel;
 *                   AC / ± / % on a calculator).
 *   - `danger`    — destructive action. Red outline → red fill on hover.
 *   - `ghost`     — default. Transparent background, 1 px border.
 *   - `link`      — underline only, no chrome.
 *
 * Every variant except `link` and `danger` also carries the kit's
 * holographic hairline and hover film — invisible at rest, lit under
 * the pointer and on focus. `danger` keeps its red border all the way
 * through the hover, because that border is the only warning the user
 * gets and an iridescent one says the wrong thing.
 *
 * `fill-cell` boolean attribute makes the host fill its parent
 * cell (flex / grid item), growing width AND the inner button
 * height. Intended for grid-based surfaces like a calculator
 * keypad where every key should tile flush.
 *
 * CSS custom-property surface (documented in
 * `docs/components-reference.md`):
 *
 *   --os-ui-button-bg              — background color
 *   --os-ui-button-bg-hover        — hover wash (ghost + secondary)
 *   --os-ui-button-fg              — text color
 *   --os-ui-button-border          — shorthand for the border
 *   --os-ui-button-border-radius   — corner radius (default 6px)
 *   --os-ui-button-padding         — shorthand for padding (default "6px 12px")
 *   --os-ui-button-min-height      — minimum height when `fill-cell` is set
 *
 * Shadow parts (author hook — use with `::part(button)`):
 *
 *   button — the underlying `<button>` element.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-button.styles';

/**
 * Stable string enum of recognised variants. Exported so
 * plugin-side TS can narrow.
 */
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
		return html`
			<button
				part="button"
				class="os-holo-edge os-holo-sheen"
				type=${ type }
				?disabled=${ disabled || busy }
				aria-busy=${ busy ? 'true' : 'false' }
			>
				${ busy
					? html`<span class="os-button__spinner" aria-hidden="true"></span>`
					: '' }
				<slot></slot>
				<!--
					The two motion layers. Elements rather than
					pseudo-elements because the sheen and the hairline
					have already taken this button's ::before and
					::after — see the pseudo-element budget note in
					src/ui/holo.ts. Both are inert and aria-hidden.
				-->
				<span class="os-holo-glint" aria-hidden="true"></span>
				<span class="os-holo-ring" aria-hidden="true"></span>
			</button>
		`;
	}
}
defineComponent( 'os-button', OsButton );
