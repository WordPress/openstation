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

	static help = {
		title: 'Text field',
		summary:
			'Labelled text input primitive. Two-way reflects `value`, emits wpd-input-change per keystroke, wpd-input-commit on blur/change, and wpd-submit on Enter. Optional password reveal toggle.',
		status: 'stable',
		since: '0.11.0',
		props: [
			{ name: 'label', type: 'string', description: 'Visible label above the input.' },
			{ name: 'value', type: 'string', description: 'Current input value; reflected two-way.' },
			{ name: 'placeholder', type: 'string', description: 'Native placeholder string.' },
			{ name: 'disabled', type: 'boolean attribute', description: 'Disables the native input.' },
			{ name: 'readonly', type: 'boolean attribute', description: 'Marks the input readonly.' },
			{
				name: 'autocomplete',
				type: 'string',
				default: 'off',
				description: 'Forwarded to the native input autocomplete attribute.',
			},
			{
				name: 'type',
				type: 'string',
				default: 'text',
				description: 'Native input type (text, password, email, search, tel, url).',
			},
			{ name: 'maxlength', type: 'integer (string)', description: 'Native maxlength.' },
			{ name: 'minlength', type: 'integer (string)', description: 'Native minlength.' },
			{ name: 'pattern', type: 'regex string', description: 'Native validation pattern.' },
			{ name: 'name', type: 'string', description: 'Forwarded to the native input for form submission.' },
			{ name: 'suffix', type: 'string', description: 'Text rendered inside the right edge of the input row.' },
			{
				name: 'invalid',
				type: 'boolean attribute',
				description: 'Marks the field aria-invalid and applies the error style.',
			},
			{
				name: 'reveal',
				type: 'boolean attribute',
				description: 'On type="password" fields, adds an eye-icon toggle that flips the input between hidden and visible text.',
			},
		],
		events: [
			{
				name: 'wpd-input-change',
				description: 'Fires on every input keystroke.',
				detail: '{ value: string }',
			},
			{
				name: 'wpd-input-commit',
				description: 'Fires on the native change event (blur / Enter).',
				detail: '{ value: string }',
			},
			{
				name: 'wpd-submit',
				description: 'Fires when the user presses Enter (without Shift/Alt/Meta).',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--desktop-mode-text', description: 'Text colour.' },
			{ name: '--desktop-mode-muted', description: 'Label + suffix colour.' },
			{ name: '--desktop-mode-border', description: 'Input outline.' },
			{ name: '--desktop-mode-window-bg', description: 'Input background.' },
		],
		example: html`
			<wpd-stack gap="8">
				<wpd-text-field label="Note title" value="Untitled" placeholder="Name this note"></wpd-text-field>
				<wpd-text-field type="password" reveal label="API key"></wpd-text-field>
			</wpd-stack>
		`,
	} as const;

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
		const declaredAutocomplete = ( this as unknown as {
			autocomplete: string | null;
		} ).autocomplete;
		const declaredType =
			( this as unknown as { type: string | null } ).type || 'text';
		// Chrome (and Edge / Brave / other Chromium) ignore
		// `autocomplete="off"` on `<input type="password">` — their
		// password-manager heuristic always offers to save anything
		// the user types into a masked field, even outside a form.
		// `autocomplete="new-password"` IS honoured: it's the spec
		// signal for "this isn't a sign-in field" and skips both the
		// autofill prompt and the "save password?" toast.
		//
		// We surface this for password fields where the caller didn't
		// declare an autocomplete value, OR explicitly passed `off`
		// (signal of "no autocomplete"). Callers that genuinely want
		// stored credential autofill — e.g. a future login form —
		// pass `autocomplete="current-password"` and we forward it
		// untouched.
		const isPassword = declaredType === 'password';
		let autocomplete = declaredAutocomplete || 'off';
		if ( isPassword && ( ! declaredAutocomplete || autocomplete === 'off' ) ) {
			autocomplete = 'new-password';
		}
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

		// "Password" is a UI MODE (visually mask the value), not a
		// credential field. We always render the underlying control as
		// `type="text"` and apply CSS-based masking — Chrome / Edge /
		// Firefox password managers only inspect `<input type="password">`
		// to decide whether to offer save / update / autofill, so by
		// presenting a plain text input we sidestep the entire heuristic
		// even when the user has saved a password for the site already.
		// (The autocomplete="new-password" upgrade above is kept as a
		// belt-and-braces guard in case a future caller forces type=password
		// directly — which today no consumer does.)
		const isPasswordIntent = declaredType === 'password';
		const isMasked = isPasswordIntent && ! ( reveal && this._revealed );
		// Effective input type: password fields always render as
		// type="text" (mask is CSS-only — see styles); other types
		// flip to "text" only when the reveal toggle is engaged for a
		// non-password reveal (currently no consumer, kept for parity
		// with the prior reveal contract); otherwise the declared
		// type passes through.
		let effectiveType: string;
		if ( isPasswordIntent ) {
			effectiveType = 'text';
		} else if ( reveal && this._revealed ) {
			effectiveType = 'text';
		} else {
			effectiveType = declaredType;
		}

		const rowClass = reveal
			? 'wpd-text-field__row wpd-text-field__row--has-reveal'
			: 'wpd-text-field__row';
		const inputClass = isMasked
			? 'wpd-text-field__input wpd-text-field__input--masked'
			: 'wpd-text-field__input';

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
					class=${ inputClass }
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
