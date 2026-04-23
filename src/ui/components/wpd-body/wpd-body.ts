/**
 * `<wpd-body>` — top-level native-window body wrapper.
 *
 * The recommended outer container inside a native window's render
 * callback. Fills the parent, stacks children in a flex column,
 * applies consistent padding, and (optionally) owns the scrollable
 * region so overflowing content scrolls the body rather than the
 * window frame.
 *
 * Recommended layout stack:
 *
 * ```
 * <wpd-body>                    — outer wrapper, owns padding + scroll
 *   <wpd-panel>                 — grouped section with its own rhythm
 *     <wpd-row>                 — 12-column grid when needed
 *       <wpd-text-field col="6" />
 *       <wpd-select     col="6" />
 *     </wpd-row>
 *   </wpd-panel>
 *   <wpd-panel>…</wpd-panel>
 * </wpd-body>
 * ```
 *
 * Attributes:
 *   - `gap`     — px between children (default 12).
 *   - `padding` — px inset around children (default 16; pass `0`
 *                 for edge-to-edge canvas content).
 *   - `scroll`  — boolean; when present, `overflow: auto` on the
 *                 host so tall content scrolls within the body.
 *
 * Why this is distinct from `<wpd-panel>`: wpd-panel is a grouped
 * section inside a body (think card, settings group). wpd-body is
 * the outer container that fills the window. The two compose
 * naturally — a body hosts one or more panels.
 *
 * @since 0.12.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-body.styles';

export class WpdBody extends Component {
	static props = [ 'gap', 'padding', 'scroll' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Body',
		summary:
			'Top-level native-window body wrapper. Fills the parent, stacks children in a flex column, and optionally owns the scrollable region so overflowing content scrolls inside the body rather than the window frame.',
		status: 'stable',
		since: '0.12.0',
		props: [
			{
				name: 'gap',
				type: 'integer (px)',
				default: '12',
				description: 'Space between children.',
			},
			{
				name: 'padding',
				type: 'integer (px)',
				default: '16',
				description: 'Inset around children. Pass 0 for edge-to-edge canvas content.',
			},
			{
				name: 'scroll',
				type: 'boolean attribute',
				description: 'Applies overflow: auto so tall content scrolls within the body.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Body content — typically one or more <wpd-panel>s.' },
		],
		cssProps: [
			{ name: '--wpd-body-gap', default: '12px' },
			{ name: '--wpd-body-padding', default: '16px' },
		],
		example: html`
			<wpd-body scroll>
				<wpd-panel>
					<wpd-section heading="Profile">Edit profile info here.</wpd-section>
				</wpd-panel>
				<wpd-panel>
					<wpd-section heading="Danger zone">Irreversible actions.</wpd-section>
				</wpd-panel>
			</wpd-body>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const padding = ( this as unknown as { padding: string | null } ).padding;
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--wpd-body-gap', `${ gap }px` );
		}
		if ( padding && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--wpd-body-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-body', WpdBody );
