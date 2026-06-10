/**
 * `<wpd-row>` — horizontal 12-column grid row.
 *
 * Bootstrap-style ergonomics in the component kit. A `<wpd-row>`
 * lays out its direct children on a twelve-track grid; each child
 * declares its width via a `col="N"` attribute where N is 1..12.
 * Children without `col` span the full row — matching the intuition
 * that a lone child shouldn't shrink to 1/12th.
 *
 * ```html
 * <wpd-row>
 *     <wpd-text-field col="6" label="First name"></wpd-text-field>
 *     <wpd-text-field col="6" label="Last name"></wpd-text-field>
 * </wpd-row>
 *
 * <wpd-row>
 *     <wpd-select col="4" label="Currency">…</wpd-select>
 *     <wpd-number-field col="8" label="Amount"></wpd-number-field>
 * </wpd-row>
 * ```
 *
 * The `col` attribute lives on the CHILD, not on wpd-row, so any
 * element type works — `<wpd-*>` components, plain `<div>`s,
 * third-party custom elements. The row's shadow CSS reads the
 * attribute through `::slotted` and sets `grid-column: span N`.
 *
 * Attributes on `<wpd-row>`:
 *   - `gap`         — px between children on both axes (default 12).
 *   - `column-gap`  — px between columns (overrides `gap` on the x-axis).
 *   - `row-gap`     — px between rows when children wrap
 *                     (overrides `gap` on the y-axis).
 *
 * @since 0.5.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-row.styles';

export class WpdRow extends Component {
	static props = [ 'gap', 'column-gap', 'row-gap' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Row',
		summary:
			'Horizontal 12-column grid row. Children declare their width via a `col="N"` attribute (1..12); a child without `col` spans the full row. The col attribute lives on the child, so any element type works.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{
				name: 'gap',
				type: 'integer (px)',
				default: '12',
				description: 'Cell spacing on both axes.',
			},
			{
				name: 'column-gap',
				type: 'integer (px)',
				description: 'x-axis override — takes precedence over `gap` for columns.',
			},
			{
				name: 'row-gap',
				type: 'integer (px)',
				description: 'y-axis override for wrapped rows.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Children with optional `col="N"` attributes.' },
		],
		cssProps: [
			{ name: '--wpd-row-gap', default: '12px' },
			{ name: '--wpd-row-column-gap' },
			{ name: '--wpd-row-row-gap' },
		],
		example: html`
			<wpd-row>
				<wpd-text-field col="6" label="First name"></wpd-text-field>
				<wpd-text-field col="6" label="Last name"></wpd-text-field>
			</wpd-row>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const cg = (
			this as unknown as { 'column-gap': string | null }
		)[ 'column-gap' ];
		const rg = ( this as unknown as { 'row-gap': string | null } )[ 'row-gap' ];

		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--wpd-row-gap', `${ gap }px` );
		}
		if ( cg && /^\d+$/.test( cg ) ) {
			this.style.setProperty( '--wpd-row-column-gap', `${ cg }px` );
		}
		if ( rg && /^\d+$/.test( rg ) ) {
			this.style.setProperty( '--wpd-row-row-gap', `${ rg }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-row', WpdRow );
