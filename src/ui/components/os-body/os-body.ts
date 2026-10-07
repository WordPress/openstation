import { Component, defineComponent, html } from '../../core';
import { styles } from './os-body.styles';

export class OsBody extends Component {
	static props = [ 'gap', 'padding', 'scroll' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Body',
		summary:
			'Top-level native-window body wrapper. Fills the parent, stacks children in a flex column, and optionally owns the scrollable region so overflowing content scrolls inside the body rather than the window frame.',
		status: 'stable',
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
			{ name: '(default)', description: 'Body content — typically one or more <os-panel>s.' },
		],
		cssProps: [
			{ name: '--os-ui-body-gap', default: '12px' },
			{ name: '--os-ui-body-padding', default: '16px' },
		],
		example: html`
			<os-body scroll>
				<os-panel>
					<os-section heading="Profile">Edit profile info here.</os-section>
				</os-panel>
				<os-panel>
					<os-section heading="Danger zone">Irreversible actions.</os-section>
				</os-panel>
			</os-body>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const padding = ( this as unknown as { padding: string | null } ).padding;
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--os-ui-body-gap', `${ gap }px` );
		}
		if ( padding && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--os-ui-body-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-body', OsBody );
