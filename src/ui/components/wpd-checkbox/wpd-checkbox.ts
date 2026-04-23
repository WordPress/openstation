/**
 * `<wpd-checkbox>` — standalone checkbox primitive.
 *
 * Counterpart to `<wpd-checkbox-label>` (which ships an opinionated
 * label-row layout). This component paints just the native checkbox
 * styled with the admin accent colour, optionally with an inline
 * label to its right. Use when you need full control over label
 * placement — a form row with the label above the box, a table
 * cell, a settings panel that groups two boxes under one label.
 *
 * ```html
 * <wpd-checkbox checked value="hd" label="HD only"></wpd-checkbox>
 * ```
 *
 * Or without the inline label — caller owns the layout:
 *
 * ```html
 * <label for="only-hd">HD only</label>
 * <wpd-checkbox id="only-hd" value="hd"></wpd-checkbox>
 * ```
 *
 * Emits `wpd-checkbox-change` with `{ checked, value }` on user
 * toggles — same event name `<wpd-checkbox-label>` uses so callers
 * can listen at a common ancestor and treat both identically.
 *
 * @since 0.11.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-checkbox.styles';

export class WpdCheckbox extends Component {
	static props = [ 'checked', 'value', 'label', 'disabled' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Checkbox',
		summary:
			'Standalone checkbox primitive. Paints the native control with the admin accent colour and optionally renders an inline label. Use when you need full control over label placement.',
		status: 'stable',
		since: '0.11.0',
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
		],
		events: [
			{
				name: 'wpd-checkbox-change',
				description: 'Fires when the user toggles the checkbox.',
				detail: '{ checked: boolean, value: string | null }',
			},
		],
		cssProps: [
			{ name: '--wp-desktop-text', description: 'Label colour.' },
		],
		example: html`
			<wpd-stack gap="4">
				<wpd-checkbox value="hd" label="HD only" checked></wpd-checkbox>
				<wpd-checkbox value="subs" label="Require subtitles"></wpd-checkbox>
				<wpd-checkbox value="locked" label="Locked" disabled></wpd-checkbox>
			</wpd-stack>
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
					?checked=${ checked }
					?disabled=${ disabled }
					.value=${ value ?? '' }
					@change=${ ( e: Event ) => this._onChange( e ) }
				/>
				<span class="wpd-checkbox__label">${ label }</span>
			</label>
		`;
	}

	private _onChange( e: Event ): void {
		const input = e.target as HTMLInputElement;
		const next = input.checked;
		// Reflect to attribute so CSS + future reads (including
		// declarative snapshots) see the new state without touching
		// the DOM.
		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		this.emit( 'wpd-checkbox-change', {
			checked: next,
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'wpd-checkbox', WpdCheckbox );
