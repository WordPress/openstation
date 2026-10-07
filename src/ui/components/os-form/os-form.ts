import {
	Component,
	defineComponent,
	html,
} from '../../core';
import { osFormStyles } from './os-form.styles';

interface FieldElement extends HTMLElement {
	value?: unknown;
	checked?: boolean;
}

interface InitialSnapshot {
	value: unknown;
	checked: boolean | null;
}

function copySnapshotValue( value: unknown ): unknown {
	if ( value === null || typeof value !== 'object' ) {
		return value;
	}
	try {
		return structuredClone( value );
	} catch {
		return value;
	}
}

export class OsForm extends Component {
	static props = [
		'submit-label',
		'reset-label',
		'error',
		'busy',
		'columns',
		'min-column',
		'show-reset',
		'align',
	] as const;
	static styles = [ osFormStyles ];

	static help = {
		title: 'Form',
		summary:
			'Responsive form. Collects named fields (including boolean switches and tag arrays), restores them with setValues / reset, blocks duplicate submits while busy, and exposes validation and error helpers.',
		status: 'stable',
		props: [
			{
				name: 'submit-label',
				type: 'string',
				default: 'Submit',
				description: 'Label of the primary submit button.',
			},
			{
				name: 'reset-label',
				type: 'string',
				default: 'Reset',
				description: 'Label of the reset button.',
			},
			{
				name: 'error',
				type: 'string',
				description:
					'Top-of-form error banner. Show / hide via attribute OR setError(); equivalent.',
			},
			{
				name: 'busy',
				type: 'boolean attribute',
				description: 'Loading state — disables the form + flashes a spinner.',
			},
			{
				name: 'columns',
				type: '"auto" | "1" | "2" | "3"',
				default: 'auto',
				description:
					'Fixed column count, or "auto" for container-query 1↔2 (or up to 3 above 760px).',
			},
			{
				name: 'show-reset',
				type: 'boolean attribute',
				default: 'true',
				description:
					'Whether the reset button is rendered. Rendered by default; pass the literal `show-reset="false"` to hide it — omitting the attribute keeps it visible.',
			},
			{
				name: 'align',
				type: '"end" | "start" | "stretch"',
				default: 'end',
				description: 'Footer button alignment.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Form fields. `[name]` descendants are auto-collected.' },
			{ name: 'header', description: 'Heading / lede above the fields.' },
			{ name: 'error', description: 'Custom error UI; replaces the default banner when slotted.' },
			{ name: 'footer-leading', description: 'Extras left of the action buttons.' },
			{ name: 'footer-trailing', description: 'Extras right of the action buttons.' },
		],
		events: [
			{
				name: 'os-form-submit',
				description:
					'Cancellable. Fires on submit after required-field validation passes.',
				detail: '{ values: Record<string, unknown>, form: OsForm }',
			},
			{
				name: 'os-form-reset',
				description: 'Fires after fields have been restored to their initial values.',
				detail: '{ form: OsForm }',
			},
			{
				name: 'os-form-input',
				description:
					'Reports text, checkbox/switch, select, range and color changes in named fields. Tag add/remove events remain controlled intents; update the tag value in the app.',
				detail: '{ name: string, value: unknown, form: OsForm }',
			},
		],
		example: html`
			<os-form submit-label="Add user">
				<os-text-field name="username" label="Username" required></os-text-field>
				<os-text-field name="email" type="email" label="Email" required></os-text-field>
				<os-text-field name="password" label="Password" full-width></os-text-field>
			</os-form>
		`,
	} as const;

	private _initial: Map< string, InitialSnapshot > = new Map();

	private _captured = false;

	private _fieldChangeListener: ( ( e: Event ) => void ) | null = null;
	private _enterSubmitListener: ( ( e: Event ) => void ) | null = null;

	connectedCallback(): void {
		super.connectedCallback();

		queueMicrotask( () => this._captureInitialValues() );

		this._fieldChangeListener = ( e: Event ) => this._onAnyFieldInput( e );
		this.addEventListener( 'os-input-change', this._fieldChangeListener );
		this.addEventListener( 'os-input-commit', this._fieldChangeListener );
		this.addEventListener( 'os-checkbox-change', this._fieldChangeListener );
		this.addEventListener( 'os-select-change', this._fieldChangeListener );
		this.addEventListener( 'os-range-change', this._fieldChangeListener );
		this.addEventListener( 'os-color-change', this._fieldChangeListener );
		this.addEventListener( 'change', this._fieldChangeListener );

		this._enterSubmitListener = () => this.submit();
		this.addEventListener( 'os-submit', this._enterSubmitListener );
	}

	disconnectedCallback(): void {
		if ( this._fieldChangeListener ) {
			this.removeEventListener( 'os-input-change', this._fieldChangeListener );
			this.removeEventListener( 'os-input-commit', this._fieldChangeListener );
			this.removeEventListener( 'os-checkbox-change', this._fieldChangeListener );
			this.removeEventListener( 'os-select-change', this._fieldChangeListener );
			this.removeEventListener( 'os-range-change', this._fieldChangeListener );
			this.removeEventListener( 'os-color-change', this._fieldChangeListener );
			this.removeEventListener( 'change', this._fieldChangeListener );
			this._fieldChangeListener = null;
		}
		if ( this._enterSubmitListener ) {
			this.removeEventListener( 'os-submit', this._enterSubmitListener );
			this._enterSubmitListener = null;
		}
	}

	protected render() {
		const submitLabel =
			( this as unknown as { 'submit-label': string | null } )[ 'submit-label' ] ||
			'Submit';
		const resetLabel =
			( this as unknown as { 'reset-label': string | null } )[ 'reset-label' ] ||
			'Reset';
		const error =
			( this as unknown as { error: string | null } ).error || '';
		const busy =
			( this as unknown as { busy: string | null } ).busy !== null;

		const showResetRaw = ( this as unknown as {
			'show-reset': string | null;
		} )[ 'show-reset' ];
		const showReset = showResetRaw !== 'false';

		return html`
			<div class="header" part="header">
				<slot name="header"></slot>
			</div>
			<div class="fields" part="fields" ?inert=${ busy }>
				<slot></slot>
			</div>
			<slot name="error">
				${ error
					? html`<p class="error" role="alert" part="error">${ error }</p>`
					: html`<p class="error" role="alert" part="error" hidden></p>` }
			</slot>
			<footer class="footer" part="footer">
				<span class="footer-leading"
					><slot name="footer-leading"></slot
				></span>
				<span class="footer-actions">
					${ showReset
						? html`<os-button
								variant="ghost"
								data-os-form-action="reset"
								?disabled=${ busy }
								@click=${ () => this.reset() }
							>${ resetLabel }</os-button>`
						: html`` }
					<os-button
						variant="primary"
						data-os-form-action="submit"
						?disabled=${ busy }
						@click=${ () => this.submit() }
					>
						${ busy
							? html`<span class="busy-spinner" aria-hidden="true"></span>`
							: html`` }
						${ submitLabel }
					</os-button>
				</span>
				<span class="footer-trailing"
					><slot name="footer-trailing"></slot
				></span>
			</footer>
		`;
	}

	getValues(): Record< string, unknown > {
		const out: Record< string, unknown > = {};
		for ( const field of this._namedFields() ) {
			const name = field.getAttribute( 'name' );
			if ( ! name ) {
				continue;
			}
			out[ name ] = this._readField( field );
		}
		return out;
	}

	setValues( patch: Record< string, unknown > ): void {
		for ( const [ name, value ] of Object.entries( patch ) ) {
			const field = this._fieldByName( name );
			if ( ! field ) {
				continue;
			}
			this._writeField( field, value );
		}
	}

	setBusy( busy: boolean ): void {
		if ( busy ) {
			this.setAttribute( 'busy', '' );
		} else {
			this.removeAttribute( 'busy' );
		}
	}

	setError( message: string | null ): void {
		if ( message ) {
			this.setAttribute( 'error', message );
		} else {
			this.removeAttribute( 'error' );
		}
	}

	setFieldInvalid(
		name: string,
		invalid: boolean = true,
		message: string | null = null,
	): void {
		const field = this._fieldByName( name );
		if ( ! field ) {
			return;
		}
		if ( invalid ) {
			field.setAttribute( 'invalid', '' );
			if ( message !== null ) {
				field.setAttribute( 'error', message );
			}
		} else {
			field.removeAttribute( 'invalid' );
			field.removeAttribute( 'error' );
		}
	}

	clearErrors(): void {
		this.setError( null );
		for ( const field of this._namedFields() ) {
			field.removeAttribute( 'invalid' );
			field.removeAttribute( 'error' );
		}
	}

	reset(): void {
		this.clearErrors();
		for ( const [ name, snap ] of this._initial.entries() ) {
			const field = this._fieldByName( name );
			if ( ! field ) {
				continue;
			}
			if ( snap.checked !== null ) {
				field.checked = snap.checked;
				if ( snap.checked ) {
					field.setAttribute( 'checked', '' );
				} else {
					field.removeAttribute( 'checked' );
				}
				continue;
			}
			this._writeField( field, copySnapshotValue( snap.value ) );
		}
		this.dispatchEvent(
			new CustomEvent( 'os-form-reset', {
				bubbles: true,
				composed: true,
				detail: { form: this },
			} ),
		);
	}

	submit(): void {
		if ( this.hasAttribute( 'busy' ) ) {
			return;
		}

		const failures: string[] = [];
		for ( const field of this._namedFields() ) {
			const name = field.getAttribute( 'name' );
			if ( ! name ) {
				continue;
			}
			const required = field.hasAttribute( 'required' );
			if ( ! required ) {
				continue;
			}
			const value = this._readField( field );
			const empty =
				value === null ||
				value === undefined ||
				value === '' ||
				( Array.isArray( value ) && value.length === 0 );
			if ( empty ) {
				field.setAttribute( 'invalid', '' );
				const labelAttr = field.getAttribute( 'label' );
				failures.push( labelAttr || name );
			}
		}
		if ( failures.length > 0 ) {
			const list = failures.join( ', ' );
			this.setError( `Required: ${ list }` );
			return;
		}

		const values = this.getValues();
		const event = new CustomEvent( 'os-form-submit', {
			bubbles: true,
			composed: true,
			cancelable: true,
			detail: { values, form: this },
		} );
		this.dispatchEvent( event );
	}

	private _captureInitialValues(): void {
		if ( this._captured ) {
			return;
		}
		const fields = this._namedFields();
		if ( fields.length === 0 ) {
			return;
		}
		for ( const field of fields ) {
			const name = field.getAttribute( 'name' );
			if ( ! name ) {
				continue;
			}
			const isCheckbox =
				field.tagName === 'OS-SWITCH' ||
				field.tagName === 'OS-CHECKBOX' ||
				field.tagName === 'OS-CHECKBOX-LABEL' ||
				( field.tagName === 'INPUT' &&
					( field as HTMLInputElement ).type === 'checkbox' );
			this._initial.set( name, {
				value: copySnapshotValue( this._readField( field ) ),
				checked: isCheckbox ? Boolean( this._readField( field ) ) : null,
			} );
		}
		this._captured = true;
	}

	private _namedFields(): FieldElement[] {
		return Array.from(
			this.querySelectorAll< FieldElement >( '[name]' ),
		);
	}

	private _fieldByName( name: string ): FieldElement | null {
		const safe =
			typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
				? CSS.escape( name )
				: name.replace( /["\\]/g, '\\$&' );
		return this.querySelector< FieldElement >( `[name="${ safe }"]` );
	}

	private _readField( field: FieldElement ): unknown {
		const tag = field.tagName.toUpperCase();
		const isCheckbox =
			tag === 'OS-SWITCH' ||
			tag === 'OS-CHECKBOX' ||
			tag === 'OS-CHECKBOX-LABEL' ||
			( tag === 'INPUT' &&
				( field as HTMLInputElement ).type === 'checkbox' );
		if ( isCheckbox ) {
			if ( typeof field.checked === 'boolean' ) {
				return field.checked;
			}
			return field.hasAttribute( 'checked' );
		}
		if ( field.value !== undefined && field.value !== null ) {
			return field.value;
		}
		return field.getAttribute( 'value' ) ?? '';
	}

	private _writeField( field: FieldElement, value: unknown ): void {
		const tag = field.tagName.toUpperCase();
		const isCheckbox =
			tag === 'OS-SWITCH' ||
			tag === 'OS-CHECKBOX' ||
			tag === 'OS-CHECKBOX-LABEL' ||
			( tag === 'INPUT' &&
				( field as HTMLInputElement ).type === 'checkbox' );
		if ( isCheckbox ) {
			const next = Boolean( value );
			field.checked = next;
			if ( next ) {
				field.setAttribute( 'checked', '' );
			} else {
				field.removeAttribute( 'checked' );
			}
			return;
		}

		if ( ( value !== null && typeof value === 'object' ) ||
			( field.value !== null && typeof field.value === 'object' ) ) {
			field.value = value;
			return;
		}
		const str = value === null || value === undefined ? '' : String( value );
		field.value = str;
		field.setAttribute( 'value', str );
	}

	private _onAnyFieldInput( e: Event ): void {
		const target = e.target as FieldElement | null;
		if ( ! target ) {
			return;
		}
		const name = target.getAttribute?.( 'name' );
		if ( ! name ) {
			return;
		}

		this.dispatchEvent(
			new CustomEvent( 'os-form-input', {
				bubbles: true,
				composed: true,
				detail: {
					name,
					value: this._readField( target ),
					form: this,
				},
			} ),
		);

		if ( target.hasAttribute( 'invalid' ) ) {
			target.removeAttribute( 'invalid' );
		}
	}
}

defineComponent( 'os-form', OsForm );
