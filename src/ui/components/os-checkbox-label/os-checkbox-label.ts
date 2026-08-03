/**
 * `<os-checkbox-label>` — label + checkbox + text, emits
 * `os-checkbox-change` on toggle.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-checkbox-label.styles';

export class OsCheckboxLabel extends Component {
	static props = [ 'label', 'checked', 'disabled' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Checkbox label',
		summary:
			'Opinionated label-row variant of <os-checkbox>: label text + checkbox in a single aligned row. Use when you want the shipped layout without any layout work.',
		status: 'stable',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'Visible label text, paired with the checkbox via a native <label>.',
			},
			{
				name: 'checked',
				type: 'boolean attribute',
				description: 'Reflects and controls the checked state.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'When present, the checkbox is not interactive and dimmed.',
			},
		],
		events: [
			{
				name: 'os-checkbox-change',
				description: 'Fires when the user toggles the checkbox.',
				detail: '{ checked: boolean }',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Label colour.' },
		],
		example: html`
			<os-checkbox-label label="Reduce motion" checked></os-checkbox-label>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const checked =
			( this as unknown as { checked: string | null } ).checked !== null;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		return html`
			<label>
				<input
					type="checkbox"
					?checked=${ checked }
					?disabled=${ disabled }
					@change=${ ( e: Event ) => this._onChange( e ) }
				/>
				<span class="os-checkbox-label__text">${ label }</span>
			</label>
		`;
	}

	private _onChange( e: Event ): void {
		// Native `disabled` inputs don't fire change, but guard anyway in
		// case the attribute is toggled between event dispatch and handling.
		if ( ( this as unknown as { disabled: string | null } ).disabled !== null ) {
			return;
		}
		const next = ( e.target as HTMLInputElement ).checked;
		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		this.emit( 'os-checkbox-change', { checked: next } );
	}
}
defineComponent( 'os-checkbox-label', OsCheckboxLabel );
