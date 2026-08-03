/**
 * `<os-swatch>` — single selectable color/wallpaper tile.
 *
 * The tile renders as a button with `aria-pressed` tracking `selected`
 * and a `background` css-property driven by `preview`. Clicks emit a
 * `os-pick` CustomEvent with `{ value }`. See the colocated test
 * file for usage.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-swatch.styles';

export class OsSwatch extends Component {
	static props = [ 'value', 'label', 'selected', 'preview', 'size', 'variant' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Swatch',
		summary:
			'Selectable color/wallpaper tile. Renders as an aria-pressed button with a background driven by the preview attribute.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Identifier emitted on the os-pick event when the swatch is clicked.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'aria-label + title for the button.',
			},
			{
				name: 'selected',
				type: 'boolean attribute',
				description: 'Marks the swatch as the active choice within a swatch-grid.',
			},
			{
				name: 'preview',
				type: 'CSS background value',
				description: 'Raw CSS background (color, gradient, url()) painted on the tile.',
			},
			{
				name: 'size',
				type: 'string',
				description: 'Visual size hint (e.g. sm, md, lg). Consumed by the stylesheet.',
			},
			{
				name: 'variant',
				type: 'string',
				description: 'Optional visual variant (e.g. color vs wallpaper).',
			},
		],
		slots: [
			{ name: '(default)', description: 'Optional overlay content rendered inside the tile.' },
		],
		events: [
			{
				name: 'os-pick',
				description: 'Fires when the swatch is clicked.',
				detail: '{ value: string }',
			},
		],
		example: html`
			<os-swatch-grid label="Accent">
				<os-swatch value="red" preview="#ef4444" label="Red" selected></os-swatch>
				<os-swatch value="blue" preview="#3b82f6" label="Blue"></os-swatch>
				<os-swatch value="green" preview="#10b981" label="Green"></os-swatch>
			</os-swatch-grid>
		`,
	} as const;

	protected render() {
		const selected =
			( this as unknown as { selected: string | null } ).selected !== null;
		const label = ( this as unknown as { label: string | null } ).label || '';
		const preview =
			( this as unknown as { preview: string | null } ).preview || '';
		return html`
			<button
				type="button"
				aria-pressed=${ selected ? 'true' : 'false' }
				aria-label=${ label }
				title=${ label }
				style="background: ${ preview }"
				@click=${ () => this._onPick() }
			>
				<slot></slot>
			</button>
		`;
	}

	private _onPick(): void {
		this.emit( 'os-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-swatch', OsSwatch );
