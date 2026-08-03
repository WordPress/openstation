/**
 * `<os-section>` — titled panel used throughout OS Settings.
 *
 * Usage:
 *
 *   <os-section heading="Wallpaper" description="The backdrop …">
 *     <os-swatch-grid>…</os-swatch-grid>
 *   </os-section>
 *
 * The `<slot>` receives whatever the caller puts inside; heading +
 * description are attribute-driven so plain HTML calls can reach
 * them without JS scaffolding.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-section.styles';

export class OsSection extends Component {
	static props = [ 'heading', 'description', 'stack' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Section',
		summary:
			'Titled panel with heading + description + a body slot. The canonical OS Settings section wrapper.',
		status: 'stable',
		since: '0.9.0',
		props: [
			{
				name: 'heading',
				type: 'string',
				description: 'Section title, rendered as an <h3>.',
			},
			{
				name: 'description',
				type: 'string',
				description: 'Secondary descriptive paragraph below the heading.',
			},
			{
				name: 'stack',
				type: 'boolean',
				description:
					'When present, the default slot becomes a flex column with a consistent gap (--os-ui-section-gap, default 12px) between children. Opt-in — existing callers whose slotted controls ship their own margin stay unchanged. Recommended for third-party settings tabs and any new surface.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Section body content.' },
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Heading colour.' },
			{ name: '--os-ui-fg-muted', description: 'Description colour.' },
		],
		example: html`
			<os-section
				heading="Wallpaper"
				description="Pick a backdrop for the desktop."
			>
				<os-swatch-grid>
					<os-swatch value="a" preview="#b1e7b9"></os-swatch>
					<os-swatch value="b" preview="#e7b1c9"></os-swatch>
				</os-swatch-grid>
			</os-section>
		`,
	} as const;

	protected render() {
		const heading = ( this as unknown as { heading: string | null } ).heading || '';
		const description =
			( this as unknown as { description: string | null } ).description || '';
		return html`
			<h3 class="os-section__heading">${ heading }</h3>
			<p class="os-section__description">${ description }</p>
			<div class="os-section__body"><slot></slot></div>
		`;
	}
}
defineComponent( 'os-section', OsSection );
