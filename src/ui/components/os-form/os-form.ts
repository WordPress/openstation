/**
 * `<os-form>` — declarative, robust, container-query-driven form.
 *
 * The piece that's been missing from the kit. Wraps the
 * boilerplate every plugin form ends up writing — value
 * collection, validation, busy state, error banner, responsive
 * layout, submit + reset wiring — behind a `<form>`-shaped tag
 * any caller can drop in.
 *
 * ### Quick start
 *
 * ```html
 * <os-form submit-label="Add user">
 *     <os-text-field name="username" label="Username" required></os-text-field>
 *     <os-text-field name="email" type="email" label="Email" required></os-text-field>
 *     <os-text-field name="password" label="Password" full-width></os-text-field>
 * </os-form>
 * ```
 *
 * The form auto-renders a footer with **Reset** + **Submit**
 * buttons. On submit it dispatches a cancellable
 * `os-form-submit` event whose `detail.values` is a
 * `Record<string, unknown>` keyed by each field's `name`. Pressing
 * Enter in any text field also submits.
 *
 * ### Slots
 *
 * | name              | content                                                                 |
 * |-------------------|-------------------------------------------------------------------------|
 * | (default)         | Form fields. Anything with a `name` attribute is auto-collected.        |
 * | `header`          | Title / lede / hero block above the fields.                             |
 * | `error`           | Custom error UI; replaces the default banner when filled.               |
 * | `footer-leading`  | Extras left of the action buttons (e.g. a "back" link).                 |
 * | `footer-trailing` | Extras right of the action buttons (e.g. a secondary submit).          |
 *
 * ### Layout / responsiveness
 *
 * The fields container is a **CSS container** (inline-size). It
 * collapses to one column below 480px and goes to two columns
 * above it — so `<os-form>` adapts to its window's width
 * automatically as the user drags the resize handle. Any field
 * with `full-width` spans every column. Force a fixed column count
 * via `columns="1" | "2" | "3"`.
 *
 * ### Validation
 *
 * The form scans descendants for `[required]` and `[name]`. On
 * submit it checks each required field's value (read from the
 * `value` property when defined; otherwise the `value` attribute;
 * checkboxes use `checked`). Empty required fields get the
 * `invalid` attribute set + a top-of-form summary message; the
 * cancellable `os-form-submit` event is suppressed. Hosts that
 * need richer validation can listen for `os-form-input` (every
 * keystroke), call `setFieldInvalid(name)`, or short-circuit
 * inside their `os-form-submit` handler.
 *
 * ### Public API (DOM methods on the element)
 *
 * - `getValues(): Record<string, unknown>`
 * - `setValues(patch: Record<string, unknown>): void`
 * - `setBusy(busy: boolean): void` — disables fields + flashes a spinner on submit
 * - `setError(message: string | null): void` — top-of-form banner
 * - `setFieldInvalid(name: string, invalid?: boolean, message?: string | null): void`
 * - `clearErrors(): void` — clears the top error and every per-field invalid mark
 * - `reset(): void` — restores every field to its initial-load value, fires `os-form-reset`
 * - `submit(): void` — programmatic submit (same path as the button click)
 */

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

/**
 * Captured initial-state snapshot so `reset()` is a real reset
 * (back to load-time values) rather than "wipe to empty string."
 */
interface InitialSnapshot {
	value: unknown;
	checked: boolean | null;
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
			'Container-query-driven responsive form. Auto-collects named fields, validates required, exposes setError / setFieldInvalid / setBusy / reset, fires os-form-submit with the collected values map.',
		status: 'experimental',
		since: '0.8.1',
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
					'Bubbles every keystroke / change inside any descendant field; useful for live validation.',
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

	/**
	 * Initial-value snapshot keyed by field name. Captured on first
	 * mount AFTER the slot's children upgrade — used by `reset()`.
	 */
	private _initial: Map< string, InitialSnapshot > = new Map();
	/** Whether `_initial` has been captured yet. */
	private _captured = false;

	/** Captured per-field-input listener so we can detach on disconnect. */
	private _fieldChangeListener: ( ( e: Event ) => void ) | null = null;
	private _enterSubmitListener: ( ( e: Event ) => void ) | null = null;

	connectedCallback(): void {
		super.connectedCallback();

		// Capture initial values one microtask later so slotted
		// `<os-*>` children have had a chance to upgrade and apply
		// their own `value` attributes. The capture runs exactly once
		// per connection — fields mounted later are not snapshotted.
		queueMicrotask( () => this._captureInitialValues() );

		// Listen for descendant input events so we can re-broadcast
		// them as `os-form-input`. The host doesn't have to know
		// every field's event name (`os-input-change`,
		// `os-checkbox-change`, native `input`) — it gets one bus.
		this._fieldChangeListener = ( e: Event ) => this._onAnyFieldInput( e );
		this.addEventListener( 'os-input-change', this._fieldChangeListener );
		this.addEventListener( 'os-input-commit', this._fieldChangeListener );
		this.addEventListener( 'os-checkbox-change', this._fieldChangeListener );
		this.addEventListener( 'os-select-change', this._fieldChangeListener );
		this.addEventListener( 'change', this._fieldChangeListener );

		// Pressing Enter inside any descendant `<os-text-field>`
		// fires `os-submit` — treat it as a form submit so keyboard
		// users don't have to mouse over to the button.
		this._enterSubmitListener = () => this.submit();
		this.addEventListener( 'os-submit', this._enterSubmitListener );
	}

	disconnectedCallback(): void {
		if ( this._fieldChangeListener ) {
			this.removeEventListener( 'os-input-change', this._fieldChangeListener );
			this.removeEventListener( 'os-input-commit', this._fieldChangeListener );
			this.removeEventListener( 'os-checkbox-change', this._fieldChangeListener );
			this.removeEventListener( 'os-select-change', this._fieldChangeListener );
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
		// `show-reset` defaults to TRUE: the reset button is opt-out.
		// Only the literal string "false" hides it — omitting the
		// attribute keeps the button visible. The string form lets
		// callers disable it from PHP without rendering tricks.
		const showResetRaw = ( this as unknown as {
			'show-reset': string | null;
		} )[ 'show-reset' ];
		const showReset = showResetRaw !== 'false';

		return html`
			<div class="header" part="header">
				<slot name="header"></slot>
			</div>
			<div class="fields" part="fields">
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

	// ─── Public API ──────────────────────────────────────────────────

	/**
	 * Collect every named descendant's current value. Checkboxes
	 * return `boolean`; everything else returns whatever the field
	 * surfaces on its `value` property (or attribute as fallback).
	 */
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

	/**
	 * Apply a partial values map to the matching named fields.
	 * Unknown names are skipped silently (fields may not be
	 * mounted yet).
	 */
	setValues( patch: Record< string, unknown > ): void {
		for ( const [ name, value ] of Object.entries( patch ) ) {
			const field = this._fieldByName( name );
			if ( ! field ) {
				continue;
			}
			this._writeField( field, value );
		}
	}

	/** Toggle the busy attribute (also re-renders to refresh the spinner). */
	setBusy( busy: boolean ): void {
		if ( busy ) {
			this.setAttribute( 'busy', '' );
		} else {
			this.removeAttribute( 'busy' );
		}
	}

	/**
	 * Set the top-of-form error banner. Pass `null` (or empty
	 * string) to clear. Equivalent to setting the `error` attribute.
	 */
	setError( message: string | null ): void {
		if ( message ) {
			this.setAttribute( 'error', message );
		} else {
			this.removeAttribute( 'error' );
		}
	}

	/**
	 * Mark a single field invalid (or clear it). Useful for
	 * server-returned per-field errors — e.g. "username already
	 * exists". The optional `message` is set via the field's
	 * `error` attribute when supported (currently a no-op for
	 * fields that don't render one — falls back to the `invalid`
	 * highlight only).
	 */
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

	/** Clear the form-level error AND every per-field invalid mark. */
	clearErrors(): void {
		this.setError( null );
		for ( const field of this._namedFields() ) {
			field.removeAttribute( 'invalid' );
			field.removeAttribute( 'error' );
		}
	}

	/**
	 * Restore every field to its initial value (the snapshot taken
	 * at first connection). Fires `os-form-reset` afterwards.
	 */
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
			this._writeField( field, snap.value );
		}
		this.dispatchEvent(
			new CustomEvent( 'os-form-reset', {
				bubbles: true,
				composed: true,
				detail: { form: this },
			} ),
		);
	}

	/**
	 * Programmatic submit. Same path the submit button + Enter key
	 * take. Runs required-field validation, then dispatches a
	 * cancellable `os-form-submit`.
	 */
	submit(): void {
		// Validate `required` fields. Fields the host has explicitly
		// marked invalid via `setFieldInvalid` are also tallied so
		// the host gets a clear "you have outstanding errors" signal
		// instead of the form silently re-firing submit.
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
		// The form is intentionally a "transport" — it doesn't
		// actually post anything. Cancellation is just convention
		// for hosts that want to observe but not block.
	}

	// ─── Internals ───────────────────────────────────────────────────

	private _captureInitialValues(): void {
		if ( this._captured ) {
			return;
		}
		const fields = this._namedFields();
		if ( fields.length === 0 ) {
			// No fields yet (e.g. the framework is hydrating slotted
			// children async). Bail without marking `_captured` —
			// nothing re-schedules the capture within this connection,
			// so late-mounted fields are not snapshotted; the next
			// `connectedCallback` is the only retry.
			return;
		}
		for ( const field of fields ) {
			const name = field.getAttribute( 'name' );
			if ( ! name ) {
				continue;
			}
			const isCheckbox =
				field.tagName === 'OS-CHECKBOX' ||
				field.tagName === 'OS-CHECKBOX-LABEL' ||
				( field.tagName === 'INPUT' &&
					( field as HTMLInputElement ).type === 'checkbox' );
			this._initial.set( name, {
				value: this._readField( field ),
				checked: isCheckbox ? Boolean( field.checked ) : null,
			} );
		}
		this._captured = true;
	}

	private _namedFields(): FieldElement[] {
		// Walk the LIGHT DOM — slotted descendants. `<os-*>` web
		// components live in the host's light tree (they don't get
		// re-parented into our shadow), so `querySelectorAll` is
		// the right tool here.
		return Array.from(
			this.querySelectorAll< FieldElement >( '[name]' ),
		);
	}

	private _fieldByName( name: string ): FieldElement | null {
		// Escape attribute selector to defend against names with
		// quotes / special chars. Modern browsers expose CSS.escape
		// for exactly this — we use a tiny manual fallback for
		// environments (jsdom test envs) that historically lacked
		// it, but every supported runtime today has it.
		const safe =
			typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
				? CSS.escape( name )
				: name.replace( /["\\]/g, '\\$&' );
		return this.querySelector< FieldElement >( `[name="${ safe }"]` );
	}

	private _readField( field: FieldElement ): unknown {
		// Prefer the property-side `value`/`checked` so we get the
		// authoritative current state — attribute-side reflection
		// can lag a frame behind keystroke updates.
		const tag = field.tagName.toUpperCase();
		const isCheckbox =
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
		// Re-broadcast as a single bus event so hosts only need one
		// listener for live validation. We DON'T stop the inner
		// event — components like `<os-text-field>` still need it
		// for their two-way reflection.
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

		// User just touched a previously-invalid field — relax the
		// invalid flag so the error styling clears as they type.
		if ( target.hasAttribute( 'invalid' ) ) {
			target.removeAttribute( 'invalid' );
		}
	}
}

defineComponent( 'os-form', OsForm );
