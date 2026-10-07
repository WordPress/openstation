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

		const gapPx = gap && /^\d+$/.test( gap ) ? `${ gap }px` : '';
		if ( gapPx ) {
			this.style.setProperty( '--os-ui-stack-gap', gapPx );
		}
		if ( align ) {
			this.style.setProperty( '--os-ui-stack-align', align );
		}

		if ( padding !== null && /^\d+$/.test( padding ) ) {
			this.style.setProperty( '--os-ui-stack-padding', `${ padding }px` );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-stack', OsStack );
