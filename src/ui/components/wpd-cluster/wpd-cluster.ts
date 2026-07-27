/**
 * `<wpd-cluster>` — horizontal flex layout with a gap and wrap.
 * The sibling of `<wpd-stack>`: when you want a row of controls
 * rather than a column of sections.
 *
 * Usage:
 *
 *   <wpd-cluster gap="8" justify="end">
 *     <wpd-button>Cancel</wpd-button>
 *     <wpd-button variant="primary">Save</wpd-button>
 *   </wpd-cluster>
 *
 * `gap` is attribute-driven (pixels). Default 8.
 * `justify` follows CSS `justify-content` ( `start` | `center` |
 *   `end` | `space-between` | `space-around` ). Default `start`.
 * `align` follows CSS `align-items`. Default `center` — most
 *   toolbars want button text baselines to line up.
 *
 * Children wrap to a new line when the container narrows, so a
 * cluster in a resizable window degrades gracefully.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-cluster.styles';

export class WpdCluster extends Component {
	static props = [ 'gap', 'justify', 'align' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Cluster',
		summary:
			'Horizontal flex layout with a gap + wrap. The sibling of <wpd-stack> — use it for rows of controls (button groups, toolbars). Children wrap gracefully when the container narrows.',
		status: 'stable',
		since: '0.5.0',
		props: [
			{
				name: 'gap',
				type: 'integer (px)',
				default: '8',
				description: 'Space between children.',
			},
			{
				name: 'justify',
				type: "'start' | 'center' | 'end' | 'space-between' | 'space-around'",
				default: 'start',
				description: 'Main-axis alignment (justify-content).',
			},
			{
				name: 'align',
				type: "'start' | 'center' | 'end' | 'stretch' | 'baseline'",
				default: 'center',
				description: 'Cross-axis alignment (align-items).',
			},
		],
		slots: [
			{ name: '(default)', description: 'Inline children.' },
		],
		cssProps: [
			{ name: '--wpd-cluster-gap', default: '8px' },
			{ name: '--wpd-cluster-justify', default: 'start' },
			{ name: '--wpd-cluster-align', default: 'center' },
		],
		example: html`
			<wpd-cluster gap="8" justify="end">
				<wpd-button>Cancel</wpd-button>
				<wpd-button variant="primary">Save</wpd-button>
			</wpd-cluster>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const justify = ( this as unknown as { justify: string | null } ).justify;
		const align = ( this as unknown as { align: string | null } ).align;

		const gapPx = gap && /^\d+$/.test( gap ) ? `${ gap }px` : '';
		if ( gapPx ) {
			this.style.setProperty( '--wpd-cluster-gap', gapPx );
		}
		if ( justify ) {
			this.style.setProperty( '--wpd-cluster-justify', justify );
		}
		if ( align ) {
			this.style.setProperty( '--wpd-cluster-align', align );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-cluster', WpdCluster );
