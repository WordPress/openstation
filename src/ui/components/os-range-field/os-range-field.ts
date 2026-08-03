/**
 * `<os-range-field>` — label + range slider + live value readout.
 *
 * Emits `os-range-change` with `{ value: number }` — already
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
import { styles } from './os-range-field.styles';

/**
 * Where the lit half of the track ends, as a percentage string.
 *
 * The track paints the mesh under an opaque wedge and this is the
 * boundary between them — see the styles docblock. Clamped, because a
 * caller is free to set `value` outside `min`/`max` and a negative
 * gradient stop would drop the whole background layer rather than
 * degrade.
 */
function fillPercent( value: string, min: string, max: string ): string {
	const v = Number.parseFloat( value );
	const lo = Number.parseFloat( min );
	const hi = Number.parseFloat( max );
	if ( ! Number.isFinite( v ) || ! Number.isFinite( lo ) || ! Number.isFinite( hi ) || hi === lo ) {
		return '0%';
	}
	const fraction = ( v - lo ) / ( hi - lo );
	return `${ Math.min( 100, Math.max( 0, fraction * 100 ) ).toFixed( 2 ) }%`;
}

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

export class OsRangeField extends Component {
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
			'Label + range slider + live numeric readout. Emits os-range-change with an already-parsed number.',
		status: 'stable',
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
				name: 'os-range-change',
				description: 'Fires on every slider movement.',
				detail: '{ value: number }',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Readout + label colour.' },
			{ name: '--os-ui-fg-muted', description: 'Secondary colour.' },
		],
		example: html`
			<os-range-field
				label="Dock size"
				value="48"
				min="32"
				max="80"
				step="4"
				suffix="px"
			></os-range-field>
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
			<label class="os-range-field__label">${ label }</label>
			<input
				type="range"
				min=${ min }
				max=${ max }
				step=${ step }
				style="--_fill: ${ fillPercent( value, min, max ) }"
				.value=${ value }
				@input=${ ( e: Event ) => this._onInput( e ) }
			/>
			<span
				class="os-range-field__value"
				style="--os-ui-range-readout-width: ${ width }ch"
				>${ readout }${ suffix }</span
			>
		`;
	}

	connectedCallback(): void {
		super.connectedCallback();
		// The unlit wedge is a linear-gradient, and a gradient angle is
		// physical. RTL therefore needs the wedge to run the other way,
		// and the angle is the only thing that has to know: the stops,
		// the mesh and --_fill stay exactly as they are. Read once on
		// connect — a document that changes direction mid-session is not
		// a case worth a MutationObserver per slider.
		if ( getComputedStyle( this ).direction === 'rtl' ) {
			this.style.setProperty( '--_range-angle', '270deg' );
		}
	}

	private _onInput( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const n = parseFloat( input.value );
		if ( ! Number.isFinite( n ) ) {
			return;
		}
		( this as unknown as { value: string } ).value = String( n );
		this.emit( 'os-range-change', { value: n } );
	}
}
defineComponent( 'os-range-field', OsRangeField );
