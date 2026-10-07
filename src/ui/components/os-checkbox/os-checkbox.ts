import { Component, defineComponent, html } from '../../core';
import { styles } from './os-checkbox.styles';

export class OsCheckbox extends Component {
	static props = [ 'checked', 'value', 'label', 'disabled' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Checkbox',
		summary:
			'Standalone checkbox primitive. Paints the native control with the admin accent colour and optionally renders an inline label. Use when you need full control over label placement.',
		status: 'stable',
		props: [
			{
				name: 'checked',
				type: 'boolean attribute',
				description: 'Reflects + controls the checked state; updated on user toggle.',
			},
			{
				name: 'value',
				type: 'string',
				description: 'Identifier returned in the event detail — useful when several checkboxes share a listener.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'Optional inline label rendered to the right of the box.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables the native input.',
			},
			{
				name: 'block',
				type: 'boolean attribute',
				description:
					'Lays the host out as a full-width row instead of shrink-to-fit, so the box lines up with block-level controls (sliders, selects) stacked around it. The hit area stays the box plus its label.',
			},
		],
		events: [
			{
				name: 'os-checkbox-change',
				description: 'Fires when the user toggles the checkbox.',
				detail: '{ checked: boolean, value: string | null }',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Label colour.' },
		],
		example: html`
			<os-stack gap="4">
				<os-checkbox value="hd" label="HD only" checked></os-checkbox>
				<os-checkbox value="subs" label="Require subtitles"></os-checkbox>
				<os-checkbox value="locked" label="Locked" disabled></os-checkbox>
			</os-stack>
		`,
	} as const;

	protected render() {
		const checked =
			( this as unknown as { checked: string | null } ).checked !== null;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const label = ( this as unknown as { label: string | null } ).label || '';
		const value = ( this as unknown as { value: string | null } ).value;
		return html`
			<label>
				<input
					type="checkbox"
					.checked=${ checked }
					?disabled=${ disabled }
					.value=${ value ?? '' }
					@change=${ ( e: Event ) => this._onChange( e ) }
				/>
				<span class="os-checkbox__label">${ label }</span>
			</label>
		`;
	}

	private _onChange( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const next = input.checked;

		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		this.emit( 'os-checkbox-change', {
			checked: next,
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-checkbox', OsCheckbox );
