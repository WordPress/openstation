/**
 * `<os-number-field>` — labelled numeric input primitive.
 *
 * Thin wrapper around `<os-text-field>` that forces `type="number"`
 * and returns numeric payloads (already parsed) on every event.
 * Accepts `min`, `max`, `step` like the native input; the component
 * clamps the emitted value to the range on commit so callers don't
 * re-implement the range check.
 *
 * ```html
 * <os-number-field
 *     label="Amount"
 *     value="100"
 *     min="0"
 *     step="0.01"
 *     suffix="€"
 * ></os-number-field>
 * ```
 *
 * Emits:
 *   - `os-input-change` — `{ value: number }` on every keystroke
 *     while the input's current text parses as a finite number.
 *   - `os-input-commit` — `{ value: number }` on change (blur /
 *     Enter), clamped to `min`/`max` when either is set.
 *   - `os-submit` — Enter without Shift; same clamp as commit.
 *
 * Callers that need the raw string (e.g. "in-progress typing that
 * isn't a valid number yet") should use `<os-text-field>`
 * directly — this component deliberately drops non-finite input
 * from its event stream.
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { textFieldStyles } from '../os-text-field/os-text-field.styles';

export class OsNumberField extends Component {
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

	static help = {
		title: 'Number field',
		summary:
			'Labelled numeric input. Wraps <os-text-field> semantics but forces type="number" and emits already-parsed numbers, clamping to min/max on commit.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{ name: 'label', type: 'string', description: 'Visible label above the input.' },
			{ name: 'value', type: 'number (string)', description: 'Current numeric value; two-way reflected.' },
			{ name: 'placeholder', type: 'string', description: 'Native placeholder string.' },
			{ name: 'disabled', type: 'boolean attribute', description: 'Disables the native input.' },
			{ name: 'readonly', type: 'boolean attribute', description: 'Marks the input readonly.' },
			{ name: 'name', type: 'string', description: 'Forwarded for form submission.' },
			{ name: 'suffix', type: 'string', description: 'Unit text rendered at the right edge (e.g. "€", "px").' },
			{ name: 'min', type: 'number (string)', description: 'Lower clamp applied on commit.' },
			{ name: 'max', type: 'number (string)', description: 'Upper clamp applied on commit.' },
			{
				name: 'step',
				type: 'number (string) | "any"',
				default: 'any',
				description: 'Native step granularity.',
			},
			{ name: 'invalid', type: 'boolean attribute', description: 'Marks the field aria-invalid.' },
		],
		events: [
			{
				name: 'os-input-change',
				description: 'Fires on each keystroke when the current text parses as a finite number. Not clamped.',
				detail: '{ value: number }',
			},
			{
				name: 'os-input-commit',
				description: 'Fires on blur / native change, clamped to min/max.',
				detail: '{ value: number }',
			},
			{
				name: 'os-submit',
				description: 'Fires on Enter (without Shift/Alt/Meta), clamped.',
				detail: '{ value: number }',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Text colour.' },
			{ name: '--os-ui-fg-muted', description: 'Label + suffix colour.' },
			{ name: '--os-ui-border', description: 'Input outline.' },
			{ name: '--os-window-bg', description: 'Input background.' },
		],
		example: html`
			<os-number-field
				label="Amount"
				value="100"
				min="0"
				max="9999"
				step="0.01"
				suffix="€"
			></os-number-field>
		`,
	} as const;

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

		const hostId = this.id || 'os-unnamed';
		const inputId = `${ hostId }__input`;

		return html`
			${ label
				? html`<label
						class="os-text-field__label"
						for=${ inputId }
					>${ label }</label>`
				: html`` }
			<span class="os-text-field__row">
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
					? html`<span class="os-text-field__suffix">${ suffix }</span>`
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
		this.emit( 'os-input-change', { value: n } );
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
		this.emit( 'os-input-commit', { value: clamped } );
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
			this.emit( 'os-submit', { value: clamped } );
		}
	}
}
defineComponent( 'os-number-field', OsNumberField );
