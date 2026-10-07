import { Component, defineComponent, html } from '../../core';
import { styles } from './os-row.styles';

export class OsRow extends Component {
	static props = [ 'gap', 'column-gap', 'row-gap' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Row',
		summary:
			'Horizontal 12-column grid row. Children declare their width via a `col="N"` attribute (1..12); a child without `col` spans the full row. The col attribute lives on the child, so any element type works.',
		status: 'stable',
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
			{ name: '--os-ui-row-gap', default: '12px' },
			{ name: '--os-ui-row-column-gap' },
			{ name: '--os-ui-row-row-gap' },
		],
		example: html`
			<os-row>
				<os-text-field col="6" label="First name"></os-text-field>
				<os-text-field col="6" label="Last name"></os-text-field>
			</os-row>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const cg = (
			this as unknown as { 'column-gap': string | null }
		)[ 'column-gap' ];
		const rg = ( this as unknown as { 'row-gap': string | null } )[ 'row-gap' ];

		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--os-ui-row-gap', `${ gap }px` );
		}
		if ( cg && /^\d+$/.test( cg ) ) {
			this.style.setProperty( '--os-ui-row-column-gap', `${ cg }px` );
		}
		if ( rg && /^\d+$/.test( rg ) ) {
			this.style.setProperty( '--os-ui-row-row-gap', `${ rg }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-row', OsRow );
