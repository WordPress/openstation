/**
 * `<wpd-swatch-grid>` — flex grid container for `<wpd-swatch>`
 * children. Carries the radiogroup semantics so screen readers
 * announce the set as a unit.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-swatch-grid.styles';

export class WpdSwatchGrid extends Component {
	static props = [ 'label', 'columns', 'mode' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Swatch grid',
		summary:
			'Flex grid container for <wpd-swatch> children. Emits radiogroup semantics so screen readers announce the tiles as a unit.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'aria-label describing the group (e.g. "Accent color").',
			},
			{
				name: 'columns',
				type: 'CSS grid track template',
				description: 'Overrides the default column track via --wpd-swatch-grid-cols.',
			},
			{
				name: 'mode',
				type: 'string',
				description: 'Optional rendering variant forwarded to child swatches.',
			},
		],
		slots: [
			{ name: '(default)', description: '<wpd-swatch> children.' },
		],
		cssProps: [
			{ name: '--wpd-swatch-grid-cols', description: 'Grid column template.' },
		],
		example: html`
			<wpd-swatch-grid label="Wallpaper">
				<wpd-swatch value="a" preview="linear-gradient(135deg,#f093fb,#f5576c)"></wpd-swatch>
				<wpd-swatch value="b" preview="linear-gradient(135deg,#4facfe,#00f2fe)"></wpd-swatch>
				<wpd-swatch value="c" preview="linear-gradient(135deg,#43e97b,#38f9d7)"></wpd-swatch>
			</wpd-swatch-grid>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const cols =
			( this as unknown as { columns: string | null } ).columns || '';
		if ( cols ) {
			this.style.setProperty( '--wpd-swatch-grid-cols', cols );
		}
		this.setAttribute( 'role', 'radiogroup' );
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-swatch-grid', WpdSwatchGrid );
