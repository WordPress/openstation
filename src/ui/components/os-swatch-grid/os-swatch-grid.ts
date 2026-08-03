/**
 * `<os-swatch-grid>` — flex grid container for `<os-swatch>`
 * children. Carries the radiogroup semantics so screen readers
 * announce the set as a unit.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-swatch-grid.styles';

export class OsSwatchGrid extends Component {
	static props = [ 'label', 'columns', 'mode' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Swatch grid',
		summary:
			'Flex grid container for <os-swatch> children. Emits radiogroup semantics so screen readers announce the tiles as a unit.',
		status: 'stable',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'aria-label describing the group (e.g. "Accent color").',
			},
			{
				name: 'columns',
				type: 'CSS grid track template',
				description: 'Overrides the default column track via --os-ui-swatch-grid-cols.',
			},
			{
				name: 'mode',
				type: 'string',
				description: 'Optional rendering variant forwarded to child swatches.',
			},
		],
		slots: [
			{ name: '(default)', description: '<os-swatch> children.' },
		],
		cssProps: [
			{ name: '--os-ui-swatch-grid-cols', description: 'Grid column template.' },
		],
		example: html`
			<os-swatch-grid label="Wallpaper">
				<os-swatch value="a" preview="linear-gradient(135deg,#f093fb,#f5576c)"></os-swatch>
				<os-swatch value="b" preview="linear-gradient(135deg,#4facfe,#00f2fe)"></os-swatch>
				<os-swatch value="c" preview="linear-gradient(135deg,#43e97b,#38f9d7)"></os-swatch>
			</os-swatch-grid>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const cols =
			( this as unknown as { columns: string | null } ).columns || '';
		if ( cols ) {
			this.style.setProperty( '--os-ui-swatch-grid-cols', cols );
		}
		this.setAttribute( 'role', 'radiogroup' );
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}
		return html`<slot></slot>`;
	}
}
defineComponent( 'os-swatch-grid', OsSwatchGrid );
