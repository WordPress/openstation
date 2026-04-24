/**
 * `<wpd-code>` — inline (or block) monospace code badge.
 *
 * Why a separate component from `<wpd-key>`: `<wpd-key>` reads like
 * inline code but installs a global `keydown` listener so the tile
 * flashes when the key is pressed — great for on-screen keyboards,
 * disastrous for rendering strings like `chrome://flags` (that would
 * silently intercept `c` / `h` / `r` / …). `<wpd-code>` has zero
 * listeners and zero visual chrome interaction — it's just a styled
 * `<code>` host.
 *
 * Usage:
 *
 *   <wpd-code>chrome://flags</wpd-code>
 *
 *   <!-- Multi-line snippet -->
 *   <wpd-code block>
 *     wp_register_desktop_settings_tab( array( …) );
 *   </wpd-code>
 *
 * @since 0.17.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-code.styles';

export class WpdCode extends Component {
	static props = [ 'block' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Code',
		summary:
			'Inline monospace code badge — safe for URLs, flag names, and any string that would otherwise steal keypresses if rendered as <wpd-key>. Set `block` for a multi-line snippet box.',
		status: 'experimental',
		since: '0.17.0',
		props: [
			{
				name: 'block',
				type: 'boolean',
				description:
					'When present, renders as a multi-line `<pre>`-style box with horizontal scrolling on overflow.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Code text content.' },
		],
		cssProps: [
			{ name: '--wpd-code-bg', default: 'rgba(0,0,0,0.06)' },
			{ name: '--wpd-code-fg', default: 'var(--wp-desktop-text)' },
			{ name: '--wpd-code-border', default: '1px solid rgba(0,0,0,0.08)' },
			{ name: '--wpd-code-padding', default: '0.1em 0.4em' },
			{ name: '--wpd-code-block-padding', default: '10px 12px' },
			{ name: '--wpd-code-border-radius', default: '4px' },
			{ name: '--wpd-code-font-family', default: 'ui-monospace, …' },
			{ name: '--wpd-code-font-size', default: '0.92em' },
			{
				name: '--wpd-code-white-space',
				default: 'nowrap',
				description:
					'Inline variant only — override to `normal` to let long tokens wrap.',
			},
		],
		example: html`
			Open <wpd-code>chrome://flags</wpd-code> and search for
			<wpd-code>experimental-web-platform-features</wpd-code>.
		`,
	} as const;

	protected render() {
		return html`<code><slot></slot></code>`;
	}
}
defineComponent( 'wpd-code', WpdCode );
