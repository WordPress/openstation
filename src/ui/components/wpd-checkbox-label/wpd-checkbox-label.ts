/**
 * `<wpd-checkbox-label>` — label + checkbox + text, emits
 * `wpd-checkbox-change` on toggle.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-checkbox-label.styles';

export class WpdCheckboxLabel extends Component {
	static props = [ 'label', 'checked' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Checkbox label',
		summary:
			'Opinionated label-row variant of <wpd-checkbox>: label text + checkbox in a single aligned row. Use when you want the shipped layout without any layout work.',
		status: 'stable',
		since: '0.9.0',
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
		],
		events: [
			{
				name: 'wpd-checkbox-change',
				description: 'Fires when the user toggles the checkbox.',
				detail: '{ checked: boolean }',
			},
		],
		cssProps: [
			{ name: '--desktop-mode-text', description: 'Label colour.' },
		],
		example: html`
			<wpd-checkbox-label label="Reduce motion" checked></wpd-checkbox-label>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const checked =
			( this as unknown as { checked: string | null } ).checked !== null;
		return html`
			<label>
				<input
					type="checkbox"
					?checked=${ checked }
					@change=${ ( e: Event ) => this._onChange( e ) }
				/>
				<span class="wpd-checkbox-label__text">${ label }</span>
			</label>
		`;
	}

	private _onChange( e: Event ): void {
		const next = ( e.target as HTMLInputElement ).checked;
		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		this.emit( 'wpd-checkbox-change', { checked: next } );
	}
}
defineComponent( 'wpd-checkbox-label', WpdCheckboxLabel );
