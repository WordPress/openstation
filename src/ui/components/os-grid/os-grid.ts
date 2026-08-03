/**
 * `<os-grid>` — neutral CSS grid container. The twin of
 * `<os-stack>` + `<os-cluster>` for 2-dimensional layouts.
 *
 * Usage:
 *
 *   <os-grid columns="4" rows="5" gap="8">
 *     <os-button>7</os-button>
 *     <os-button>8</os-button>
 *     <os-button>9</os-button>
 *     <os-button variant="primary">÷</os-button>
 *     …
 *   </os-grid>
 *
 * Attributes:
 *   - `columns` — integer column count (default 1).
 *   - `rows`    — integer row count (default `auto`; omit for
 *                 content-driven sizing).
 *   - `gap`     — px between grid cells.
 *   - `column-gap`, `row-gap` — per-axis overrides.
 *
 * No `role` is emitted — this is a pure layout primitive.
 * Accessibility semantics are the caller's choice (wrap in
 * `role="grid"` or `role="radiogroup"` if warranted).
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-grid.styles';

export class OsGrid extends Component {
	static props = [ 'columns', 'rows', 'gap', 'column-gap', 'row-gap' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Grid',
		summary:
			'Neutral CSS grid container. The 2-D twin of <os-stack>/<os-cluster>. No role is emitted — callers wrap in role="grid"/"radiogroup" if warranted.',
		status: 'stable',
		since: '0.5.0',
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
			{ name: '--os-ui-grid-columns' },
			{ name: '--os-ui-grid-rows' },
			{ name: '--os-ui-grid-gap' },
			{ name: '--os-ui-grid-column-gap' },
			{ name: '--os-ui-grid-row-gap' },
		],
		example: html`
			<os-grid columns="4" gap="8">
				<os-button>7</os-button>
				<os-button>8</os-button>
				<os-button>9</os-button>
				<os-button variant="primary">÷</os-button>
				<os-button>4</os-button>
				<os-button>5</os-button>
				<os-button>6</os-button>
				<os-button variant="primary">×</os-button>
			</os-grid>
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
				'--os-ui-grid-columns',
				`repeat(${ columns }, minmax(0, 1fr))`,
			);
		}
		if ( rows && /^\d+$/.test( rows ) ) {
			this.style.setProperty(
				'--os-ui-grid-rows',
				`repeat(${ rows }, minmax(0, 1fr))`,
			);
		}
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--os-ui-grid-gap', `${ gap }px` );
		}
		if ( cg && /^\d+$/.test( cg ) ) {
			this.style.setProperty( '--os-ui-grid-column-gap', `${ cg }px` );
		}
		if ( rg && /^\d+$/.test( rg ) ) {
			this.style.setProperty( '--os-ui-grid-row-gap', `${ rg }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-grid', OsGrid );
