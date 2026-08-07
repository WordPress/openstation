/**
 * `<os-color-field>` — label + native color input, emits
 * `os-color-change` on user edits.
 *
 * The `value` reflects both ways: typing in the picker updates the
 * attribute + emits; setting the attribute updates the picker. We
 * purposefully do NOT debounce here — gradient previews update
 * live and any higher-level flush (save to localStorage) debounces
 * upstream.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-color-field.styles';

export class OsColorField extends Component {
	static props = [ 'label', 'value', 'variant' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Color field',
		summary:
			'Label + native color input. Reflects the value attribute both ways and emits os-color-change live on every edit (no debounce — callers debounce upstream).',
		status: 'stable',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'Visible label rendered next to the swatch.',
			},
			{
				name: 'value',
				type: 'CSS hex color',
				default: '#000000',
				description: 'Current color. Two-way reflected with the native picker.',
			},
			{
				name: 'variant',
				type: 'string',
				description: 'Optional visual variant hint for the stylesheet.',
			},
		],
		events: [
			{
				name: 'os-color-change',
				description: 'Fires on every user edit.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--os-ui-border', description: 'Swatch outline.' },
			{ name: '--os-ui-fg-muted', description: 'Label colour.' },
		],
		example: html`
			<os-color-field label="Accent" value="#8b5cf6"></os-color-field>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const value =
			( this as unknown as { value: string | null } ).value || '#000000';
		return html`
			<label>
				<span class="os-color-field__label">${ label }</span>
				<input
					type="color"
					.value=${ value }
					@input=${ ( e: Event ) => this._onInput( e ) }
				/>
			</label>
		`;
	}

	private _onInput( e: Event ): void {
		const input = e.target as HTMLInputElement;
		( this as unknown as { value: string } ).value = input.value;
		this.emit( 'os-color-change', { value: input.value } );
	}
}
defineComponent( 'os-color-field', OsColorField );
