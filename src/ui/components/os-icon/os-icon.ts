/**
 * `<os-icon>` — dashicon wrapper that picks up theme color +
 * sizing from the surrounding component without every caller
 * re-declaring the standard "span.dashicons.dashicons-foo" boilerplate.
 *
 * Usage:
 *
 *   <os-icon name="calculator"></os-icon>
 *   <os-icon name="admin-post" size="20"></os-icon>
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
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-icon.styles';
import { primeOnLoad, resolveDashicon } from './dashicons-map';

// Prime the dashicons codepoint cache the moment the module
// loads. Idempotent across components — every consumer can call
// this freely.
primeOnLoad();

export class OsIcon extends Component {
	static props = [ 'name', 'size' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Icon',
		summary:
			'Dashicon wrapper that inherits theme colour + sizing from its context. Accepts either the dashicon suffix ("calculator") or the full class ("dashicons-calculator"). Marked aria-hidden; wrap in a button/link with its own label for accessible use.',
		status: 'stable',
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
			{ name: '--os-ui-icon-size', default: '16px' },
		],
		example: html`
			<os-cluster gap="8" align="center">
				<os-icon name="admin-post"></os-icon>
				<os-icon name="calculator" size="20"></os-icon>
				<os-icon name="dashicons-star-filled" size="32"></os-icon>
			</os-cluster>
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
			this.style.setProperty( '--os-ui-icon-size', `${ size }px` );
		}

		// Resolve the codepoint upfront. Inside shadow DOM (the
		// component's own shadow root, plus any nested `<os-table>`
		// cell etc.) the document-level `.dashicons-foo:before
		// { content: "\fXXX" }` rule doesn't apply, so the classic
		// class-only recipe paints an empty box. Emitting the glyph
		// as text content with `font-family: dashicons` from the
		// component's shadow CSS works everywhere.
		const char = resolveDashicon( slug );

		// aria-hidden because the glyph is presentational —
		// callers needing an accessible label wrap the icon in a
		// button/link with its own aria.
		if ( char ) {
			return html`<span
				class="os-icon__glyph os-icon__glyph--char dashicons dashicons-${ slug }"
				aria-hidden="true"
			>${ char }</span>`;
		}
		// Fallback to the class-only recipe — works in light DOM,
		// degrades gracefully (visible-but-empty) when the
		// codepoint resolver hasn't seen the dashicons stylesheet
		// yet. The next render after `DOMContentLoaded` will pick
		// up the cached map and switch to the char-rendering path.
		return html`<span
			class="os-icon__glyph dashicons dashicons-${ slug }"
			aria-hidden="true"
		></span>`;
	}
}
defineComponent( 'os-icon', OsIcon );
