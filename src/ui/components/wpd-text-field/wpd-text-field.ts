/**
 * `<wpd-text-field>` — labelled text input primitive.
 *
 * Sits alongside `<wpd-color-field>` / `<wpd-range-field>` /
 * `<wpd-number-field>` in the kit of labelled inputs; use it
 * anywhere a native window needs free-form text entry — search
 * boxes, notes, renameable labels, form fields.
 *
 * ```html
 * <wpd-text-field
 *     label="Note title"
 *     value="Untitled"
 *     placeholder="Name this note"
 *     autocomplete="off"
 * ></wpd-text-field>
 * ```
 *
 * Add the `reveal` attribute on `type="password"` fields to show an
 * eye-icon toggle that switches between hidden and visible text:
 *
 * ```html
 * <wpd-text-field type="password" reveal label="API key"></wpd-text-field>
 * ```
 *
 * Emits `wpd-input-change` with `{ value: string }` on every user
 * keystroke (debounced once per `input` event firing — same cadence
 * as `<wpd-range-field>`). Callers that need Enter-to-submit can
 * listen for the `wpd-submit` event the component fires when the
 * user presses Enter without Shift.
 *
 * @since 0.11.0
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { textFieldStyles } from './wpd-text-field.styles';

export class WpdTextField extends Component {
	static props = [
		'label',
		'value',
		'placeholder',
		'disabled',
		'readonly',
		'autocomplete',
		'type',
		'maxlength',
		'minlength',
		'pattern',
		'name',
		'suffix',
		'invalid',
		'reveal',
	] as const;
	static styles = [ textFieldStyles ];

	/** Whether the password text is currently visible. Internal state, not reflected to an attribute. */
	private _revealed = false;

	connectedCallback(): void {
		super.connectedCallback();
		// Deterministic id derived from native-window + tab
		// ancestry + the `label` attribute. See `src/ui/core/auto-id.ts`.
		// Only applied when the caller hasn't set one explicitly —
		// plugin authors keep full control by passing `id="…"`.
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
		const autocomplete =
			( this as unknown as { autocomplete: string | null } ).autocomplete ||
			'off';
		const declaredType =
			( this as unknown as { type: string | null } ).type || 'text';
		const maxLength = ( this as unknown as { maxlength: string | null } )
			.maxlength;
		const minLength = ( this as unknown as { minlength: string | null } )
			.minlength;
		const pattern =
			( this as unknown as { pattern: string | null } ).pattern || '';
		const name =
			( this as unknown as { name: string | null } ).name || '';
		const suffix =
			( this as unknown as { suffix: string | null } ).suffix || '';
		const invalid =
			( this as unknown as { invalid: string | null } ).invalid !== null;
		const reveal =
			( this as unknown as { reveal: string | null } ).reveal !== null;

		// When the reveal toggle is active and the user clicked "show",
		// switch the input to text so the characters are visible.
		const effectiveType =
			reveal && this._revealed ? 'text' : declaredType;

		const rowClass = reveal
			? 'wpd-text-field__row wpd-text-field__row--has-reveal'
			: 'wpd-text-field__row';

		// Shadow-DOM <label for=…> pairing. `this.id` is populated
		// by ensureAutoId on connect (or by the caller's own id).
		// The inner control's id is deterministic too, derived from
		// the host id + the conventional `__input` suffix.
		const hostId = this.id || 'wpd-unnamed';
		const inputId = `${ hostId }__input`;

		return html`
			${ label
		? html`<label
						class="wpd-text-field__label"
						for=${ inputId }
					>${ label }</label>`
		: html`` }
			<span class=${ rowClass }>
				<input
					id=${ inputId }
					type=${ effectiveType }
					.value=${ value }
					placeholder=${ placeholder }
					?disabled=${ disabled }
					?readonly=${ readonly }
					autocomplete=${ autocomplete }
					maxlength=${ maxLength ?? '' }
					minlength=${ minLength ?? '' }
					pattern=${ pattern }
					name=${ name }
					aria-invalid=${ invalid ? 'true' : 'false' }
					aria-label=${ label || '' }
					@input=${ ( e: Event ) => this._onInput( e ) }
					@change=${ ( e: Event ) => this._onChange( e ) }
					@keydown=${ ( e: KeyboardEvent ) => this._onKeyDown( e ) }
				/>
				${ suffix
		? html`<span class="wpd-text-field__suffix">${ suffix }</span>`
		: html`` }
				${ reveal ? this._renderRevealButton( disabled ) : html`` }
			</span>
		`;
	}

	private _renderRevealButton( disabled: boolean ) {
		const label = this._revealed ? 'Hide' : 'Show';
		return html`
			<button
				type="button"
				class="wpd-text-field__reveal"
				aria-label=${ label }
				aria-pressed=${ this._revealed ? 'true' : 'false' }
				?disabled=${ disabled }
				tabindex="0"
				@click=${ () => this._onToggleReveal() }
			>
				${ this._revealed ? _iconEyeOff() : _iconEye() }
			</button>
		`;
	}

	private _onToggleReveal(): void {
		this._revealed = ! this._revealed;
		this.requestUpdate();
	}

	private _onInput( e: Event ): void {
		const input = e.target as HTMLInputElement;
		( this as unknown as { value: string } ).value = input.value;
		this.emit( 'wpd-input-change', { value: input.value } );
	}

	private _onChange( e: Event ): void {
		// `change` fires after focus-loss — a looser debounce for
		// callers who only care about the final value (form submit,
		// save-on-blur). `wpd-input-change` already fires on every
		// keystroke; this event is the commit-point signal.
		const input = e.target as HTMLInputElement;
		this.emit( 'wpd-input-commit', { value: input.value } );
	}

	private _onKeyDown( e: KeyboardEvent ): void {
		if ( e.key === 'Enter' && ! e.shiftKey && ! e.altKey && ! e.metaKey ) {
			const input = e.target as HTMLInputElement;
			this.emit( 'wpd-submit', { value: input.value } );
		}
	}
}
defineComponent( 'wpd-text-field', WpdTextField );

// ---------------------------------------------------------------------------
// Icon helpers — inline SVG so they work inside shadow DOM without any
// external font dependency (Dashicons can't cross the shadow boundary).
// ---------------------------------------------------------------------------

function _iconEye() {
	return html`
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1 8C1 8 3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8z" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	`;
}

function _iconEyeOff() {
	return html`
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M1 8C1 8 3.5 3 8 3s7 5 7 5-2.5 5-7 5S1 8 1 8z" />
			<circle cx="8" cy="8" r="2" />
			<line x1="2" y1="2" x2="14" y2="14" />
		</svg>
	`;
}
