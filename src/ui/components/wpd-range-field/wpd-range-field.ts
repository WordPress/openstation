/**
 * `<wpd-range-field>` — label + range slider + live value readout.
 *
 * Emits `wpd-range-change` with `{ value: number }` — already
 * parsed to a number so consumers don't repeat the coercion.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-range-field.styles';

export class WpdRangeField extends Component {
	static props = [ 'label', 'value', 'min', 'max', 'step', 'suffix' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Range field',
		summary:
			'Label + range slider + live numeric readout. Emits wpd-range-change with an already-parsed number.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'Visible label above the slider.',
			},
			{
				name: 'value',
				type: 'number (string)',
				default: '0',
				description: 'Current slider value.',
			},
			{
				name: 'min',
				type: 'number (string)',
				default: '0',
				description: 'Lower bound of the slider range.',
			},
			{
				name: 'max',
				type: 'number (string)',
				default: '100',
				description: 'Upper bound of the slider range.',
			},
			{
				name: 'step',
				type: 'number (string)',
				default: '1',
				description: 'Slider step granularity.',
			},
			{
				name: 'suffix',
				type: 'string',
				description: 'Text appended to the readout (e.g. "px", "%").',
			},
		],
		events: [
			{
				name: 'wpd-range-change',
				description: 'Fires on every slider movement.',
				detail: '{ value: number }',
			},
		],
		cssProps: [
			{ name: '--wp-desktop-text', description: 'Readout + label colour.' },
			{ name: '--wp-desktop-muted', description: 'Secondary colour.' },
		],
		example: html`
			<wpd-range-field
				label="Dock size"
				value="48"
				min="32"
				max="80"
				step="4"
				suffix="px"
			></wpd-range-field>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const value =
			( this as unknown as { value: string | null } ).value || '0';
		const min = ( this as unknown as { min: string | null } ).min || '0';
		const max = ( this as unknown as { max: string | null } ).max || '100';
		const step = ( this as unknown as { step: string | null } ).step || '1';
		const suffix =
			( this as unknown as { suffix: string | null } ).suffix || '';
		return html`
			<label class="wpd-range-field__label">${ label }</label>
			<input
				type="range"
				min=${ min }
				max=${ max }
				step=${ step }
				.value=${ value }
				@input=${ ( e: Event ) => this._onInput( e ) }
			/>
			<span class="wpd-range-field__value">${ value }${ suffix }</span>
		`;
	}

	private _onInput( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const n = parseFloat( input.value );
		if ( ! Number.isFinite( n ) ) {
			return;
		}
		( this as unknown as { value: string } ).value = String( n );
		this.emit( 'wpd-range-change', { value: n } );
	}
}
defineComponent( 'wpd-range-field', WpdRangeField );
