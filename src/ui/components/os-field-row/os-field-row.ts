/**
 * `<os-field-row>` — the settings-form atom: label, control, hint,
 * error.
 *
 * Every settings UI in every plugin has one of these, they all
 * differ slightly, and that is why no two settings panels quite
 * match. This is the canonical shape: the label sits where every
 * other label sits, the hint reads at the same size, the error
 * replaces the hint in the same place rather than pushing the form
 * around.
 *
 * ```html
 * <os-field-row label="API key" hint="Found under Account → Developers" required>
 *     <input type="password" name="key" />
 * </os-field-row>
 * ```
 *
 * **It wires the control it wraps.** The control is a light-DOM
 * child, so a `<label for>` in this component's shadow root cannot
 * reference it — that pairing does not cross the boundary. Instead
 * the row reaches out to its first form control and, without
 * clobbering anything the consumer set:
 *
 *   - points `aria-describedby` at the hint / error text,
 *   - mirrors `error` onto `aria-invalid`,
 *   - mirrors `required` onto `required`,
 *   - focuses it when the label is clicked.
 *
 * That is the entire reason this exists as a component rather than a
 * CSS class: the accessible pairing is the part everyone skips.
 *
 * The control can be anything — a kit component, a plain `<input>`,
 * a bespoke widget. For light-DOM inputs, style them with the
 * `--os-ui-field-*` palette tokens so they follow the desktop theme.
 *
 * @public
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-field-row.styles';

/** Elements a row will adopt as "the control" it labels. */
const CONTROL_SELECTOR =
	'input, select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"], [os-field-control]';

let rowSeq = 0;

export class OsFieldRow extends Component {
	static props = [
		'label',
		'hint',
		'error',
		'required',
		'layout',
		'control-id',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Field row',
		summary:
			'Label + control + hint + error, laid out consistently. Wires the accessible pairing a light-DOM control cannot get from a shadow-root label: aria-describedby, aria-invalid, required, and click-the-label-to-focus.',
		status: 'stable',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'Field label. Clicking it focuses the control.',
			},
			{
				name: 'hint',
				type: 'string',
				description:
					'Help text below the control. Hidden while an error is showing — the error takes its place, so the form does not reflow.',
			},
			{
				name: 'error',
				type: 'string',
				description:
					'Validation message. Its presence sets aria-invalid on the control and colours the row.',
			},
			{
				name: 'required',
				type: 'boolean',
				default: 'false',
				description:
					'Marks the label and mirrors `required` onto the control.',
			},
			{
				name: 'layout',
				type: "'stacked' | 'inline'",
				default: 'stacked',
				description:
					'`inline` puts the label in a left column and the control beside it, for dense inspectors. Falls back to stacked below 30rem of row width.',
			},
			{
				name: 'control-id',
				type: 'string',
				description:
					'Id of the control to wire, when the first match is the wrong one.',
			},
		],
		slots: [
			{ name: '(default)', description: 'The control this row labels.' },
			{
				name: 'action',
				description:
					'Optional trailing control on the label line — a reset link, a "Learn more".',
			},
		],
		cssProps: [
			{ name: '--os-ui-field-row-gap' },
			{ name: '--os-ui-field-row-label-width', description: 'Label column width in `inline` layout.' },
			{ name: '--os-ui-fg', description: 'Label colour.' },
			{ name: '--os-ui-fg-muted', description: 'Hint colour.' },
			{ name: '--os-ui-danger', description: 'Error colour and required mark.' },
		],
		example: html`
			<os-field-row
				label="Retries"
				hint="How many times to retry a failed delivery."
			>
				<os-number-field min="0" max="9" value="3"></os-number-field>
			</os-field-row>
		`,
	} as const;

	/** Stable ids so `aria-describedby` has something to point at. */
	private readonly uid = `os-field-row-${ ++rowSeq }`;

	/**
	 * The element this row labels: `control-id` when given, else the
	 * first form control in the light DOM.
	 */
	public get control(): HTMLElement | null {
		const id = ( this as unknown as { 'control-id': string | null } )[
			'control-id'
		];
		if ( id ) {
			// Matched by property rather than by `#id` selector: an id
			// is author-supplied and may contain characters a selector
			// would choke on, and `CSS.escape` is not universally
			// present (jsdom, older embedded webviews).
			return (
				Array.from( this.querySelectorAll< HTMLElement >( '[id]' ) ).find(
					( el ) => el.id === id,
				) ?? null
			);
		}
		return this.querySelector< HTMLElement >( CONTROL_SELECTOR );
	}

	/**
	 * Push the row's state onto the control.
	 *
	 * Deliberately non-destructive: an `aria-describedby` the
	 * consumer wrote is extended, not replaced, and nothing is set
	 * that the row has no opinion about. A row with no error removes
	 * only the `aria-invalid` it would itself have added.
	 */
	private syncControl = (): void => {
		const control = this.control;
		if ( ! control ) {
			return;
		}
		const error = ( this as unknown as { error: string | null } ).error;
		const hint = ( this as unknown as { hint: string | null } ).hint;
		const required = this.hasAttribute( 'required' );

		let describedBy = '';
		if ( error ) {
			describedBy = `${ this.uid }-error`;
		} else if ( hint ) {
			describedBy = `${ this.uid }-hint`;
		}
		const existing = ( control.getAttribute( 'aria-describedby' ) ?? '' )
			.split( /\s+/ )
			.filter( ( token ) => token && ! token.startsWith( this.uid ) );
		const next = describedBy ? [ ...existing, describedBy ] : existing;
		if ( next.length ) {
			control.setAttribute( 'aria-describedby', next.join( ' ' ) );
		} else {
			control.removeAttribute( 'aria-describedby' );
		}

		if ( error ) {
			control.setAttribute( 'aria-invalid', 'true' );
		} else if ( control.getAttribute( 'aria-invalid' ) === 'true' ) {
			control.removeAttribute( 'aria-invalid' );
		}

		if ( required ) {
			control.setAttribute( 'required', '' );
			control.setAttribute( 'aria-required', 'true' );
		}
	};

	/**
	 * Clicking the label focuses the control — the behaviour a
	 * `<label for>` would give for free if the boundary allowed it.
	 */
	private focusControl = (): void => {
		const control = this.control;
		if ( ! control ) {
			return;
		}
		// `click()` on a checkbox-like control would toggle it, which
		// a label click legitimately does — but only for the ones
		// that opt in by exposing a `click` affordance we can be sure
		// about. Focus is the safe universal.
		control.focus?.();
	};

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const hint = ( this as unknown as { hint: string | null } ).hint || '';
		const error = ( this as unknown as { error: string | null } ).error || '';
		const required = this.hasAttribute( 'required' );

		// After every paint the control may be a different element
		// (the consumer swapped it) or the row's own state may have
		// changed — re-push either way. Cheap, and it keeps the
		// wiring true without a MutationObserver.
		queueMicrotask( this.syncControl );

		// The message line is one of three states — error, hint, or
		// nothing — and an if/else chain keeps it readable where a
		// nested ternary inside the template would not.
		let message = null;
		if ( error ) {
			message = html`<p
				class="os-field-row__error"
				id="${ this.uid }-error"
				role="alert"
			>
				${ error }
			</p>`;
		} else if ( hint ) {
			message = html`<p class="os-field-row__hint" id="${ this.uid }-hint">
				${ hint }
			</p>`;
		}

		return html`
			<div class="os-field-row__head">
				${ label
		? html`<span
							class="os-field-row__label"
							id="${ this.uid }-label"
							@click=${ this.focusControl }
					  >
							${ label }${ required
			? html`<span
										class="os-field-row__required"
										aria-hidden="true"
								  >*</span
							  >`
			: null }
					  </span>`
		: null }
				<span class="os-field-row__action"><slot name="action"></slot></span>
			</div>
			<div class="os-field-row__control">
				<slot @slotchange=${ this.syncControl }></slot>
			</div>
			${ message }
		`;
	}
}
defineComponent( 'os-field-row', OsFieldRow );
