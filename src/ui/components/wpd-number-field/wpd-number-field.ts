/**
 * `<wpd-number-field>` — labelled numeric input primitive.
 *
 * Thin wrapper around `<wpd-text-field>` that forces `type="number"`
 * and returns numeric payloads (already parsed) on every event.
 * Accepts `min`, `max`, `step` like the native input; the component
 * clamps the emitted value to the range on commit so callers don't
 * re-implement the range check.
 *
 * ```html
 * <wpd-number-field
 *     label="Amount"
 *     value="100"
 *     min="0"
 *     step="0.01"
 *     suffix="€"
 * ></wpd-number-field>
 * ```
 *
 * Emits:
 *   - `wpd-input-change` — `{ value: number }` on every keystroke
 *     while the input's current text parses as a finite number.
 *   - `wpd-input-commit` — `{ value: number }` on change (blur /
 *     Enter), clamped to `min`/`max` when either is set.
 *   - `wpd-submit` — Enter without Shift; same clamp as commit.
 *
 * Callers that need the raw string (e.g. "in-progress typing that
 * isn't a valid number yet") should use `<wpd-text-field>`
 * directly — this component deliberately drops non-finite input
 * from its event stream.
 *
 * @since 0.11.0
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { textFieldStyles } from '../wpd-text-field/wpd-text-field.styles';

export class WpdNumberField extends Component {
	static props = [
		'label',
		'value',
		'placeholder',
		'disabled',
		'readonly',
		'name',
		'suffix',
		'min',
		'max',
		'step',
		'invalid',
	] as const;
	static styles = [ textFieldStyles ];

	connectedCallback(): void {
		super.connectedCallback();
		ensureAutoId( this );
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const value = ( this as unknown as { value: string | null } ).value ?? '';
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder ||
			'';
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const readonly =
			( this as unknown as { readonly: string | null } ).readonly !== null;
		const name = ( this as unknown as { name: string | null } ).name || '';
		const suffix =
			( this as unknown as { suffix: string | null } ).suffix || '';
		const min = ( this as unknown as { min: string | null } ).min;
		const max = ( this as unknown as { max: string | null } ).max;
		const step =
			( this as unknown as { step: string | null } ).step || 'any';
		const invalid =
			( this as unknown as { invalid: string | null } ).invalid !== null;

		const hostId = this.id || 'wpd-unnamed';
		const inputId = `${ hostId }__input`;

		return html`
			${ label
				? html`<label
						class="wpd-text-field__label"
						for=${ inputId }
					>${ label }</label>`
				: html`` }
			<span class="wpd-text-field__row">
				<input
					id=${ inputId }
					type="number"
					.value=${ value }
					placeholder=${ placeholder }
					?disabled=${ disabled }
					?readonly=${ readonly }
					inputmode="decimal"
					autocomplete="off"
					min=${ min ?? '' }
					max=${ max ?? '' }
					step=${ step }
					name=${ name }
					aria-invalid=${ invalid ? 'true' : 'false' }
					aria-label=${ label || '' }
					@input=${ ( e: Event ) => this._onInput( e ) }
					@change=${ ( e: Event ) => this._onCommit( e ) }
					@keydown=${ ( e: KeyboardEvent ) => this._onKeyDown( e ) }
				/>
				${ suffix
					? html`<span class="wpd-text-field__suffix">${ suffix }</span>`
					: html`` }
			</span>
		`;
	}

	private _readRange(): { min: number; max: number } {
		const rawMin = ( this as unknown as { min: string | null } ).min;
		const rawMax = ( this as unknown as { max: string | null } ).max;
		const min = rawMin !== null ? parseFloat( rawMin ) : -Infinity;
		const max = rawMax !== null ? parseFloat( rawMax ) : Infinity;
		return {
			min: Number.isFinite( min ) ? min : -Infinity,
			max: Number.isFinite( max ) ? max : Infinity,
		};
	}

	private _clamp( value: number ): number {
		const { min, max } = this._readRange();
		if ( value < min ) {
			return min;
		}
		if ( value > max ) {
			return max;
		}
		return value;
	}

	private _onInput( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const n = parseFloat( input.value );
		if ( ! Number.isFinite( n ) ) {
			return;
		}
		// Don't clamp mid-typing — "0.0" typed en route to "0.05"
		// would snap back if we clamped below `min=1`. Commit-time
		// clamp handles final-value bounds.
		( this as unknown as { value: string } ).value = String( n );
		this.emit( 'wpd-input-change', { value: n } );
	}

	private _onCommit( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const n = parseFloat( input.value );
		if ( ! Number.isFinite( n ) ) {
			return;
		}
		const clamped = this._clamp( n );
		// Reflect the clamped value back so the visible input stays
		// in sync with the committed value (user saw "9999" while
		// `max=100` — snap to 100 on commit).
		if ( clamped !== n ) {
			input.value = String( clamped );
			( this as unknown as { value: string } ).value = String( clamped );
		}
		this.emit( 'wpd-input-commit', { value: clamped } );
	}

	private _onKeyDown( e: KeyboardEvent ): void {
		if ( e.key === 'Enter' && ! e.shiftKey && ! e.altKey && ! e.metaKey ) {
			const input = e.target as HTMLInputElement;
			const n = parseFloat( input.value );
			if ( ! Number.isFinite( n ) ) {
				return;
			}
			const clamped = this._clamp( n );
			if ( clamped !== n ) {
				input.value = String( clamped );
				( this as unknown as { value: string } ).value =
					String( clamped );
			}
			this.emit( 'wpd-submit', { value: clamped } );
		}
	}
}
defineComponent( 'wpd-number-field', WpdNumberField );
