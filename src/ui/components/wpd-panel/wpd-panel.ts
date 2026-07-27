/**
 * `<wpd-panel>` — padded, flex-column container matching the
 * conventional inset + rhythm of a native-window body. Native
 * windows default to an unpadded body so plugins don't fight the
 * padding when they want edge-to-edge content (Gutenberg canvas,
 * a calculator keypad, custom canvas art). `<wpd-panel>` is the
 * opt-in for "I want the default padded layout every OS-Settings-
 * style panel ships with."
 *
 * Usage:
 *
 *   <wpd-panel>
 *     <wpd-section heading="Look">…</wpd-section>
 *     <wpd-section heading="Feel">…</wpd-section>
 *   </wpd-panel>
 *
 * Attributes:
 *   - `gap`     — px between children (default 12).
 *   - `padding` — px inset around children (default 16). Pass `0`
 *                 to drop the inset without losing the flex layout.
 *
 * Behavior is pure CSS; no JS state. Equivalent hand-rolled
 * markup:
 *   <div style="padding:16px;display:flex;flex-direction:column;gap:12px">…</div>
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-panel.styles';

export class WpdPanel extends Component {
	static props = [ 'gap', 'padding' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Panel',
		summary:
			'Padded, flex-column container matching the default inset and rhythm of a native-window body. Opt-in for the OS-Settings-style padded layout.',
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
				name: 'padding',
				type: 'integer (px)',
				default: '16',
				description: 'Inset around children. Pass 0 to drop the inset.',
			},
		],
		slots: [ { name: '(default)', description: 'Panel body.' } ],
		cssProps: [
			{ name: '--wpd-panel-gap', default: '12px' },
			{ name: '--wpd-panel-padding', default: '16px' },
		],
		example: html`
			<wpd-panel>
				<wpd-section heading="Look">Panel section A</wpd-section>
				<wpd-section heading="Feel">Panel section B</wpd-section>
			</wpd-panel>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const padding = ( this as unknown as { padding: string | null } ).padding;
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--wpd-panel-gap', `${ gap }px` );
		}
		if ( padding && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--wpd-panel-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-panel', WpdPanel );
