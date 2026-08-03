/**
 * `<os-stack>` — vertical flex layout with a gap. The "stack"
 * primitive every design system ends up inventing, delivered here
 * so plugin authors don't each rediscover
 * `display: flex; flex-direction: column`.
 *
 * Usage:
 *
 *   <os-stack gap="12">
 *     <os-section heading="Foo">…</os-section>
 *     <os-section heading="Bar">…</os-section>
 *   </os-stack>
 *
 * `gap` is attribute-driven + coerced to a CSS pixel value so HTML
 * callers reach it without JS. Default gap is 12 px — matches the
 * widget card rhythm and OS Settings section spacing.
 *
 * `align` controls cross-axis alignment ( `start` | `center` |
 * `end` | `stretch` ). Default `stretch` matches flex-column's
 * natural behaviour: full-width children.
 *
 * `padding` accepts an integer (px) and writes it as inset padding
 * on the host. Pass `0` for edge-to-edge content. Used by the
 * native-window tab wrap so plugin authors can dial inset via the
 * `main_tab_padding` registration arg + the
 * `open_station_native_window_tab_wrap_padding` filter.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-stack.styles';

export class OsStack extends Component {
	static props = [ 'gap', 'align', 'padding' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Stack',
		summary:
			'Vertical flex layout with a gap — the "stack" primitive every design system eventually invents. Use it instead of hand-rolling display:flex; flex-direction:column.',
		status: 'stable',
		since: '0.5.0',
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
			{
				name: 'padding',
				type: 'integer (px)',
				default: '0',
				description: 'Inset padding on every side. Pass 0 for edge-to-edge.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Stacked children.' },
		],
		cssProps: [
			{ name: '--os-ui-stack-gap', default: '12px' },
			{ name: '--os-ui-stack-align', default: 'stretch' },
			{ name: '--os-ui-stack-padding', default: '0' },
		],
		example: html`
			<os-stack gap="12">
				<os-section heading="Foo">First</os-section>
				<os-section heading="Bar">Second</os-section>
			</os-stack>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const align = ( this as unknown as { align: string | null } ).align;
		const padding = ( this as unknown as { padding: string | null } ).padding;

		// Write gap / align / padding into custom-properties on the host
		// rather than inlining them on every child — lets the CSS rule
		// do the layout, keeps the shadow tree a bare `<slot>`.
		const gapPx = gap && /^\d+$/.test( gap ) ? `${ gap }px` : '';
		if ( gapPx ) {
			this.style.setProperty( '--os-ui-stack-gap', gapPx );
		}
		if ( align ) {
			this.style.setProperty( '--os-ui-stack-align', align );
		}
		// Padding accepts a bare integer (px). `padding="0"` is
		// meaningful (edge-to-edge), so test the regex, not truthiness.
		if ( padding !== null && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--os-ui-stack-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-stack', OsStack );
