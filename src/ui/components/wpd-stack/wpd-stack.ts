/**
 * `<wpd-stack>` — vertical flex layout with a gap. The "stack"
 * primitive every design system ends up inventing, delivered here
 * so plugin authors don't each rediscover
 * `display: flex; flex-direction: column`.
 *
 * Usage:
 *
 *   <wpd-stack gap="12">
 *     <wpd-section heading="Foo">…</wpd-section>
 *     <wpd-section heading="Bar">…</wpd-section>
 *   </wpd-stack>
 *
 * `gap` is attribute-driven + coerced to a CSS pixel value so HTML
 * callers reach it without JS. Default gap is 12 px — matches the
 * widget card rhythm and OS Settings section spacing.
 *
 * `align` controls cross-axis alignment ( `start` | `center` |
 * `end` | `stretch` ). Default `stretch` matches flex-column's
 * natural behaviour: full-width children.
 *
 * @since 0.10.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-stack.styles';

export class WpdStack extends Component {
	static props = [ 'gap', 'align' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Stack',
		summary:
			'Vertical flex layout with a gap — the "stack" primitive every design system eventually invents. Use it instead of hand-rolling display:flex; flex-direction:column.',
		status: 'stable',
		since: '0.10.0',
		props: [
			{
				name: 'gap',
				type: 'integer (px)',
				default: '12',
				description: 'Space between children.',
			},
			{
				name: 'align',
				type: "'start' | 'center' | 'end' | 'stretch'",
				default: 'stretch',
				description: 'Cross-axis alignment (align-items).',
			},
		],
		slots: [
			{ name: '(default)', description: 'Stacked children.' },
		],
		cssProps: [
			{ name: '--wpd-stack-gap', default: '12px' },
			{ name: '--wpd-stack-align', default: 'stretch' },
		],
		example: html`
			<wpd-stack gap="12">
				<wpd-section heading="Foo">First</wpd-section>
				<wpd-section heading="Bar">Second</wpd-section>
			</wpd-stack>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const align = ( this as unknown as { align: string | null } ).align;

		// Write the gap + align into custom-properties on the host
		// rather than inlining them on every child — lets the CSS
		// rule do the layout, keeps the shadow tree a bare `<slot>`.
		const gapPx = gap && /^\d+$/.test( gap ) ? `${ gap }px` : '';
		if ( gapPx ) {
			this.style.setProperty( '--wpd-stack-gap', gapPx );
		}
		if ( align ) {
			this.style.setProperty( '--wpd-stack-align', align );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-stack', WpdStack );
