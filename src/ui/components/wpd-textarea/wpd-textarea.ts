/**
 * `<wpd-textarea>` — multi-line text input primitive.
 *
 * Sibling of `<wpd-text-field>`; matches the same event shape
 * (`wpd-input-change`, `wpd-input-commit`, `wpd-submit`) so callers
 * can drop one in for the other inside a form. Adds two affordances
 * single-line text fields don't need:
 *
 *   - **`auto-grow`** — grows the box vertically as the user types,
 *     up to `max-rows`. Used in chat composers to keep the box
 *     compact on short messages but expand on longer ones.
 *   - **`submit-on-enter`** — Enter sends, Shift+Enter inserts a
 *     newline. The chat composer's expected behavior; unset by
 *     default so generic forms keep Enter-as-newline semantics.
 *
 * ```html
 * <wpd-textarea
 *     label="Message"
 *     placeholder="Type a message…"
 *     rows="3"
 *     auto-grow
 *     max-rows="8"
 *     submit-on-enter
 *     maxlength="4000"
 * ></wpd-textarea>
 * ```
 *
 * @since 0.6.0
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { textareaStyles } from './wpd-textarea.styles';

export class WpdTextarea extends Component {
	static props = [
		'label',
		'value',
		'placeholder',
		'disabled',
		'readonly',
		'ariaLabel',
		'name',
		'rows',
		'maxlength',
		'minlength',
		'invalid',
		'autoGrow',
		'maxRows',
		'submitOnEnter',
	] as const;
	static styles = [ textareaStyles ];

	static help = {
		title: 'Textarea',
		summary:
			'Multi-line text input. Same event shape as wpd-text-field. Optional auto-grow up to max-rows; optional submit-on-enter (Enter sends, Shift+Enter newlines).',
		status: 'stable',
		since: '0.6.0',
		props: [
			{ name: 'label', type: 'string', description: 'Visible label above the textarea.' },
			{ name: 'value', type: 'string', description: 'Current value; reflected two-way.' },
			{ name: 'placeholder', type: 'string', description: 'Native placeholder.' },
			{ name: 'disabled', type: 'boolean attribute' },
			{ name: 'readonly', type: 'boolean attribute' },
			{ name: 'aria-label', type: 'string', description: 'Accessible label when no visible label is rendered.' },
			{ name: 'name', type: 'string', description: 'Forwarded to native textarea for form submission.' },
			{ name: 'rows', type: 'integer (string)', default: '3', description: 'Initial visible row count.' },
			{ name: 'maxlength', type: 'integer (string)' },
			{ name: 'minlength', type: 'integer (string)' },
			{ name: 'invalid', type: 'boolean attribute', description: 'Sets aria-invalid + error styling.' },
			{ name: 'auto-grow', type: 'boolean attribute', description: 'Grows up to max-rows as the user types.' },
			{ name: 'max-rows', type: 'integer (string)', default: '8' },
			{
				name: 'submit-on-enter',
				type: 'boolean attribute',
				description: 'Enter fires wpd-submit; Shift+Enter inserts a newline.',
			},
		],
		events: [
			{ name: 'wpd-input-change', description: 'Fires on every keystroke.', detail: '{ value: string }' },
			{ name: 'wpd-input-commit', description: 'Fires on blur / native change.', detail: '{ value: string }' },
			{
				name: 'wpd-submit',
				description: 'Fires on Enter (without Shift) when submit-on-enter is set.',
				detail: '{ value: string }',
			},
		],
		example: html`
			<wpd-textarea label="Message" rows="3" auto-grow max-rows="8" submit-on-enter></wpd-textarea>
		`,
	} as const;

	private _textareaEl: HTMLTextAreaElement | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		ensureAutoId( this );
	}

	protected render() {
		const label = this._attr( 'label' ) || '';
		const value = this._attr( 'value' ) ?? '';
		const placeholder = this._attr( 'placeholder' ) || '';
		const disabled = this._boolAttr( 'disabled' );
		const readonly = this._boolAttr( 'readonly' );
		const ariaLabel = this._attr( 'aria-label' ) || label;
		const name = this._attr( 'name' ) || '';
		const rows = Number( this._attr( 'rows' ) ) || 3;
		const maxLength = this._attr( 'maxlength' );
		const minLength = this._attr( 'minlength' );
		const invalid = this._boolAttr( 'invalid' );

		const hostId = this.id || 'wpd-unnamed';
		const fieldId = `${ hostId }__field`;

		return html`
			${ label
				? html`<label class="wpd-textarea__label" for=${ fieldId }>${ label }</label>`
				: html`` }
			<textarea
				id=${ fieldId }
				part="textarea"
				.value=${ value }
				placeholder=${ placeholder }
				?disabled=${ disabled }
				?readonly=${ readonly }
				rows=${ rows }
				maxlength=${ maxLength ?? '' }
				minlength=${ minLength ?? '' }
				name=${ name }
				aria-invalid=${ invalid ? 'true' : 'false' }
				aria-label=${ ariaLabel || '' }
				@input=${ ( e: Event ) => this._onInput( e ) }
				@change=${ ( e: Event ) => this._onChange( e ) }
				@keydown=${ ( e: KeyboardEvent ) => this._onKeyDown( e ) }
			></textarea>
		`;
	}

	private _attr( name: string ): string | null {
		return this.getAttribute( name );
	}

	private _boolAttr( name: string ): boolean {
		return this.getAttribute( name ) !== null;
	}

	private _onInput( e: Event ): void {
		const ta = e.target as HTMLTextAreaElement;
		this._textareaEl = ta;
		this.setAttribute( 'value', ta.value );
		this.emit( 'wpd-input-change', { value: ta.value } );
		if ( this._boolAttr( 'auto-grow' ) ) {
			this._autosize( ta );
		}
	}

	private _onChange( e: Event ): void {
		const ta = e.target as HTMLTextAreaElement;
		this.emit( 'wpd-input-commit', { value: ta.value } );
	}

	private _onKeyDown( e: KeyboardEvent ): void {
		if ( ! this._boolAttr( 'submit-on-enter' ) ) {
			return;
		}
		if ( e.key === 'Enter' && ! e.shiftKey && ! e.altKey && ! e.metaKey && ! e.ctrlKey ) {
			e.preventDefault();
			const ta = e.target as HTMLTextAreaElement;
			this.emit( 'wpd-submit', { value: ta.value } );
		}
	}

	/**
	 * Grow the textarea height to fit content, capped at `max-rows`.
	 * Resets to scroll-height each input then clamps; cheap because
	 * the browser caches layout.
	 */
	private _autosize( ta: HTMLTextAreaElement ): void {
		const maxRows = Number( this._attr( 'max-rows' ) ) || 8;
		// Read the line-height from computed styles — works for both
		// shadow + light DOM. Falls back to 1.45 * font-size for
		// browsers that report 'normal'.
		const cs = window.getComputedStyle( ta );
		const fontSize = parseFloat( cs.fontSize ) || 13;
		const lineHeightRaw = cs.lineHeight;
		const lineHeight =
			lineHeightRaw === 'normal'
				? fontSize * 1.45
				: parseFloat( lineHeightRaw ) || fontSize * 1.45;
		const paddingTop = parseFloat( cs.paddingTop ) || 0;
		const paddingBottom = parseFloat( cs.paddingBottom ) || 0;
		const max = lineHeight * maxRows + paddingTop + paddingBottom;

		ta.style.height = 'auto';
		const next = Math.min( ta.scrollHeight, max );
		ta.style.height = `${ next }px`;
	}

	/** Public helper for callers that programmatically set `.value` and want autosize to re-run. */
	public refreshAutosize(): void {
		if ( this._textareaEl && this._boolAttr( 'auto-grow' ) ) {
			this._autosize( this._textareaEl );
		}
	}

	/** Imperatively focus the underlying textarea. */
	public focusInput(): void {
		// shadow-root or light-root depending on `static shadow`.
		const root = ( this.shadowRoot ?? this ) as ParentNode;
		const ta = root.querySelector< HTMLTextAreaElement >( 'textarea' );
		ta?.focus();
	}

	/** Imperatively clear the value. */
	public clear(): void {
		this.setAttribute( 'value', '' );
		const root = ( this.shadowRoot ?? this ) as ParentNode;
		const ta = root.querySelector< HTMLTextAreaElement >( 'textarea' );
		if ( ta ) {
			ta.value = '';
			if ( this._boolAttr( 'auto-grow' ) ) {
				this._autosize( ta );
			}
		}
	}
}
defineComponent( 'wpd-textarea', WpdTextarea );
