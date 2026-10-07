import { Component, defineComponent, html } from '../../core';
import { styles } from './os-panel.styles';

export class OsPanel extends Component {
	static props = [ 'gap', 'padding' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Panel',
		summary:
			'Padded, flex-column container matching the default inset and rhythm of a native-window body. Opt-in for the OS-Settings-style padded layout.',
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
				description: 'Inset around children. Pass 0 to drop the inset.',
			},
		],
		slots: [ { name: '(default)', description: 'Panel body.' } ],
		cssProps: [
			{ name: '--os-ui-panel-gap', default: '12px' },
			{ name: '--os-ui-panel-padding', default: '16px' },
		],
		example: html`
			<os-panel>
				<os-section heading="Look">Panel section A</os-section>
				<os-section heading="Feel">Panel section B</os-section>
			</os-panel>
		`,
	} as const;

	protected render() {
		const gap = ( this as unknown as { gap: string | null } ).gap;
		const padding = ( this as unknown as { padding: string | null } ).padding;
		if ( gap && /^\d+$/.test( gap ) ) {
			this.style.setProperty( '--os-ui-panel-gap', `${ gap }px` );
		}
		if ( padding && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--os-ui-panel-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-panel', OsPanel );
