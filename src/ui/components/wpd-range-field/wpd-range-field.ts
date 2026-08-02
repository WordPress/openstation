/**
 * `<wpd-range-field>` — label + range slider + live value readout.
 *
 * Emits `wpd-range-change` with `{ value: number }` — already
 * parsed to a number so consumers don't repeat the coercion.
 *
 * **The readout never changes width.** It is on the same row as the
 * track, so a value going from `1.4` to `0.05` used to lengthen the
 * box and shove the slider sideways *under the thumb the user is
 * dragging*. The readout is therefore formatted to a fixed number of
 * decimals and its box is sized up front, from the widest string the
 * configured range can produce, rather than from whatever it happens
 * to be showing.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-range-field.styles';

/** Decimal places implied by a step, when the caller hasn't said. */
function decimalsForStep( step: string ): number {
	const dot = step.indexOf( '.' );
	return dot < 0 ? 0 : Math.min( 3, step.length - dot - 1 );
}

/**
 * Width, in `ch`, that fits every readout this range can produce.
 *
 * Sized from the *bounds*, not the current value — a box that fits
 * only what it is showing is exactly the box that resizes.
 */
function readoutWidth(
	min: string,
	max: string,
	decimals: number,
	suffix: string,
): number {
	const digits = ( v: string ): number => {
		const n = Number.parseFloat( v );
		if ( ! Number.isFinite( n ) ) {
			return 3;
		}
		// Integer part, plus a slot for a minus sign.
		return String( Math.trunc( Math.abs( n ) ) ).length + ( n < 0 ? 1 : 0 );
	};
	const whole = Math.max( digits( min ), digits( max ) );
	// `+ 1` for the decimal point itself.
	return whole + ( decimals > 0 ? decimals + 1 : 0 ) + suffix.length;
}

export class WpdRangeField extends Component {
	static props = [
		'label',
		'value',
		'min',
		'max',
		'step',
		'suffix',
		'decimals',
	] as const;
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
			{
				name: 'decimals',
				type: 'number (string)',
				description:
					'Decimal places in the readout. Derived from `step` when omitted, so an integer slider reads "48" and a 0.05-step one reads "1.40". The readout box is sized from the range either way, so it never resizes mid-drag.',
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
			{ name: '--wpd-fg', description: 'Readout + label colour.' },
			{ name: '--wpd-fg-muted', description: 'Secondary colour.' },
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
		const requested = ( this as unknown as { decimals: string | null } )
			.decimals;
		const decimals = requested
			? Math.min( 6, Math.max( 0, Number.parseInt( requested, 10 ) || 0 ) )
			: decimalsForStep( step );
		const shown = Number.parseFloat( value );
		const readout = Number.isFinite( shown )
			? shown.toFixed( decimals )
			: value;
		const width = readoutWidth( min, max, decimals, suffix );
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
			<span
				class="wpd-range-field__value"
				style="--wpd-range-readout-width: ${ width }ch"
				>${ readout }${ suffix }</span
			>
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
