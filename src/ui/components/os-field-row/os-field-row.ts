import { Component, defineComponent, html } from '../../core';
import { styles } from './os-field-row.styles';

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

	private readonly uid = `os-field-row-${ ++rowSeq }`;

	public get control(): HTMLElement | null {
		const id = ( this as unknown as { 'control-id': string | null } )[
			'control-id'
		];
		if ( id ) {
			return (
				Array.from( this.querySelectorAll< HTMLElement >( '[id]' ) ).find(
					( el ) => el.id === id,
				) ?? null
			);
		}
		return this.querySelector< HTMLElement >( CONTROL_SELECTOR );
	}

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

	private focusControl = (): void => {
		const control = this.control;
		if ( ! control ) {
			return;
		}

		control.focus?.();
	};

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const hint = ( this as unknown as { hint: string | null } ).hint || '';
		const error = ( this as unknown as { error: string | null } ).error || '';
		const required = this.hasAttribute( 'required' );

		queueMicrotask( this.syncControl );

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
