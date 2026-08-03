/**
 * `<os-cluster>` — horizontal flex layout with a gap and wrap.
 * The sibling of `<os-stack>`: when you want a row of controls
 * rather than a column of sections.
 *
 * Usage:
 *
 *   <os-cluster gap="8" justify="end">
 *     <os-button>Cancel</os-button>
 *     <os-button variant="primary">Save</os-button>
 *   </os-cluster>
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
import { styles } from './os-cluster.styles';

export class OsCluster extends Component {
	static props = [ 'gap', 'justify', 'align' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Cluster',
		summary:
			'Horizontal flex layout with a gap + wrap. The sibling of <os-stack> — use it for rows of controls (button groups, toolbars). Children wrap gracefully when the container narrows.',
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
			{ name: '--os-ui-cluster-gap', default: '8px' },
			{ name: '--os-ui-cluster-justify', default: 'start' },
			{ name: '--os-ui-cluster-align', default: 'center' },
		],
		example: html`
			<os-cluster gap="8" justify="end">
				<os-button>Cancel</os-button>
				<os-button variant="primary">Save</os-button>
			</os-cluster>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const justify = ( this as unknown as { justify: string | null } ).justify;
		const align = ( this as unknown as { align: string | null } ).align;

		const gapPx = gap && /^\d+$/.test( gap ) ? `${ gap }px` : '';
		if ( gapPx ) {
			this.style.setProperty( '--os-ui-cluster-gap', gapPx );
		}
		if ( justify ) {
			this.style.setProperty( '--os-ui-cluster-justify', justify );
		}
		if ( align ) {
			this.style.setProperty( '--os-ui-cluster-align', align );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-cluster', OsCluster );
