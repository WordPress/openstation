import { Component, defineComponent, html } from '../../core';
import { styles } from './os-icon.styles';
import { primeOnLoad, resolveDashicon } from './dashicons-map';

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

		const slug = rawName.startsWith( 'dashicons-' )
			? rawName.slice( 'dashicons-'.length )
			: rawName;

		const size = ( this as unknown as { size: string | null } ).size;
		if ( size && /^\d+$/.test( size ) ) {
			this.style.setProperty( '--os-ui-icon-size', `${ size }px` );
		}

		const char = resolveDashicon( slug );

		if ( char ) {
			return html`<span
				class="os-icon__glyph os-icon__glyph--char dashicons dashicons-${ slug }"
				aria-hidden="true"
			>${ char }</span>`;
		}

		return html`<span
			class="os-icon__glyph dashicons dashicons-${ slug }"
			aria-hidden="true"
		></span>`;
	}
}
defineComponent( 'os-icon', OsIcon );
