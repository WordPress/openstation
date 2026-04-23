/**
 * `<wpd-icon>` — dashicon wrapper that picks up theme color +
 * sizing from the surrounding component without every caller
 * re-declaring the standard "span.dashicons.dashicons-foo" boilerplate.
 *
 * Usage:
 *
 *   <wpd-icon name="calculator"></wpd-icon>
 *   <wpd-icon name="admin-post" size="20"></wpd-icon>
 *
 * `name` is the suffix after `dashicons-` — e.g. `name="calculator"`
 * renders `dashicons-calculator`. If the caller already has the full
 * `dashicons-foo` class they can pass it verbatim and we strip the
 * prefix internally.
 *
 * `size` is attribute-driven pixels (font-size + width/height on
 * the inner span). Default 16 — matches surrounding body text.
 *
 * Shadow styles use the Dashicons font Core registers globally;
 * since web-component shadow roots inherit fonts from the host
 * document, no extra `@font-face` is needed.
 *
 * @since 0.10.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-icon.styles';

export class WpdIcon extends Component {
	static props = [ 'name', 'size' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Icon',
		summary:
			'Dashicon wrapper that inherits theme colour + sizing from its context. Accepts either the dashicon suffix ("calculator") or the full class ("dashicons-calculator"). Marked aria-hidden; wrap in a button/link with its own label for accessible use.',
		status: 'stable',
		since: '0.10.0',
		props: [
			{
				name: 'name',
				type: 'string',
				description: 'Dashicon identifier, with or without the `dashicons-` prefix.',
			},
			{
				name: 'size',
				type: 'integer (px)',
				default: '16',
				description: 'Glyph size in pixels.',
			},
		],
		cssProps: [
			{ name: '--wpd-icon-size', default: '16px' },
		],
		example: html`
			<wpd-cluster gap="8" align="center">
				<wpd-icon name="admin-post"></wpd-icon>
				<wpd-icon name="calculator" size="20"></wpd-icon>
				<wpd-icon name="dashicons-star-filled" size="32"></wpd-icon>
			</wpd-cluster>
		`,
	} as const;

	protected render() {
		const rawName = ( this as unknown as { name: string | null } ).name || '';
		// Tolerate both `calculator` and `dashicons-calculator` — the
		// prefix is an implementation detail of WP's icon font and
		// plugin authors shouldn't have to care which form they pass.
		const slug = rawName.startsWith( 'dashicons-' )
			? rawName.slice( 'dashicons-'.length )
			: rawName;

		const size = ( this as unknown as { size: string | null } ).size;
		if ( size && /^\d+$/.test( size ) ) {
			this.style.setProperty( '--wpd-icon-size', `${ size }px` );
		}

		// The inner span carries the dashicons class so WP's font
		// rendering picks it up naturally. aria-hidden because the
		// glyph is presentational — callers needing an accessible
		// label wrap the icon in a button/link with its own aria.
		return html`<span
			class="wpd-icon__glyph dashicons dashicons-${ slug }"
			aria-hidden="true"
		></span>`;
	}
}
defineComponent( 'wpd-icon', WpdIcon );
