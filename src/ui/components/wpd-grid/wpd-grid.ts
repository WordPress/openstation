/**
 * `<wpd-grid>` — neutral CSS grid container. The twin of
 * `<wpd-stack>` + `<wpd-cluster>` for 2-dimensional layouts.
 *
 * Usage:
 *
 *   <wpd-grid columns="4" rows="5" gap="8">
 *     <wpd-button>7</wpd-button>
 *     <wpd-button>8</wpd-button>
 *     <wpd-button>9</wpd-button>
 *     <wpd-button variant="primary">÷</wpd-button>
 *     …
 *   </wpd-grid>
 *
 * Attributes:
 *   - `columns` — integer column count (default 1).
 *   - `rows`    — integer row count (default `auto`; omit for
 *                 content-driven sizing).
 *   - `gap`     — px between grid cells.
 *   - `cell-gap`, `column-gap`, `row-gap` — per-axis overrides.
 *
 * No `role` is emitted — this is a pure layout primitive.
 * Accessibility semantics are the caller's choice (wrap in
 * `role="grid"` or `role="radiogroup"` if warranted).
 *
 * @since 0.10.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-grid.styles';

export class WpdGrid extends Component {
	static props = [ 'columns', 'rows', 'gap', 'column-gap', 'row-gap' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Grid',
		summary:
			'Neutral CSS grid container. The 2-D twin of <wpd-stack>/<wpd-cluster>. No role is emitted — callers wrap in role="grid"/"radiogroup" if warranted.',
		status: 'stable',
		since: '0.10.0',
		props: [
			{
				name: 'columns',
				type: 'integer',
				default: '1',
				description: 'Number of equal-width columns (repeat(N, minmax(0, 1fr))).',
			},
			{
				name: 'rows',
				type: 'integer',
				description: 'Optional fixed row count. Omit for content-driven sizing.',
			},
			{ name: 'gap', type: 'integer (px)', description: 'Cell spacing on both axes.' },
			{ name: 'column-gap', type: 'integer (px)', description: 'x-axis override.' },
			{ name: 'row-gap', type: 'integer (px)', description: 'y-axis override.' },
		],
		slots: [
			{ name: '(default)', description: 'Grid children.' },
		],
		cssProps: [
			{ name: '--wpd-grid-columns' },
			{ name: '--wpd-grid-rows' },
			{ name: '--wpd-grid-gap' },
			{ name: '--wpd-grid-column-gap' },
			{ name: '--wpd-grid-row-gap' },
		],
		example: html`
			<wpd-grid columns="4" gap="8">
				<wpd-button>7</wpd-button>
				<wpd-button>8</wpd-button>
				<wpd-button>9</wpd-button>
				<wpd-button variant="primary">÷</wpd-button>
				<wpd-button>4</wpd-button>
				<wpd-button>5</wpd-button>
				<wpd-button>6</wpd-button>
				<wpd-button variant="primary">×</wpd-button>
			</wpd-grid>
		`,
	} as const;

	protected render() {
		const columns = ( this as unknown as { columns: string | null } ).columns;
		const rows = ( this as unknown as { rows: string | null } ).rows;
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const cg = (
			this as unknown as { 'column-gap': string | null }
		)[ 'column-gap' ];
		const rg = ( this as unknown as { 'row-gap': string | null } )[ 'row-gap' ];

		if ( columns && /^\d+$/.test( columns ) ) {
			this.style.setProperty(
				'--wpd-grid-columns',
				`repeat(${ columns }, minmax(0, 1fr))`,
			);
		}
		if ( rows && /^\d+$/.test( rows ) ) {
			this.style.setProperty(
				'--wpd-grid-rows',
				`repeat(${ rows }, minmax(0, 1fr))`,
			);
		}
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--wpd-grid-gap', `${ gap }px` );
		}
		if ( cg && /^\d+$/.test( cg ) ) {
			this.style.setProperty( '--wpd-grid-column-gap', `${ cg }px` );
		}
		if ( rg && /^\d+$/.test( rg ) ) {
			this.style.setProperty( '--wpd-grid-row-gap', `${ rg }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-grid', WpdGrid );
