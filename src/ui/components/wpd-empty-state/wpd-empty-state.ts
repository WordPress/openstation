/**
 * `<wpd-empty-state>` — centered placeholder for "nothing here
 * yet" UI: icon + heading + description + optional CTA slot.
 * Every plugin eventually needs one (empty lists, missing
 * templates, feature-unavailable guards) and a canonical shape
 * keeps them visually consistent across the shell.
 *
 * Usage:
 *
 *   <wpd-empty-state
 *     icon="admin-plugins"
 *     heading="No plugins installed yet"
 *     description="Install a plugin to see it here."
 *   >
 *     <wpd-button slot="cta" variant="primary">Browse plugins</wpd-button>
 *   </wpd-empty-state>
 *
 * Attributes:
 *   - `icon`        — dashicons slug (with or without `dashicons-` prefix).
 *   - `heading`     — bold first line.
 *   - `description` — secondary text below the heading.
 *
 * Slots:
 *   - `cta`  — optional call-to-action row below the description.
 *   - default — any additional content.
 *
 * @since 0.10.0
 */

import { Component, defineComponent, html } from '../../core';
import '../wpd-icon/wpd-icon';
import { styles } from './wpd-empty-state.styles';

export class WpdEmptyState extends Component {
	static props = [ 'icon', 'heading', 'description' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Empty state',
		summary:
			'Centered placeholder for "nothing here yet" UI: icon + heading + description + optional CTA. A canonical shape so empty states look consistent across the shell.',
		status: 'stable',
		since: '0.10.0',
		props: [
			{
				name: 'icon',
				type: 'string (dashicons slug)',
				description: 'Dashicons identifier (with or without the dashicons- prefix).',
			},
			{
				name: 'heading',
				type: 'string',
				description: 'Bold first line.',
			},
			{
				name: 'description',
				type: 'string',
				description: 'Secondary paragraph below the heading.',
			},
		],
		slots: [
			{ name: 'cta', description: 'Call-to-action button row below the description.' },
			{ name: '(default)', description: 'Any additional content rendered after the CTA.' },
		],
		cssProps: [
			{ name: '--wp-desktop-text', description: 'Heading colour.' },
			{ name: '--wp-desktop-muted', description: 'Description colour.' },
			{ name: '--wpd-empty-state-fg' },
			{ name: '--wpd-empty-state-icon-color' },
		],
		example: html`
			<wpd-empty-state
				icon="admin-plugins"
				heading="No plugins installed yet"
				description="Install a plugin to see it here."
			>
				<wpd-button slot="cta" variant="primary">Browse plugins</wpd-button>
			</wpd-empty-state>
		`,
	} as const;

	protected render() {
		const icon = ( this as unknown as { icon: string | null } ).icon || '';
		const heading = ( this as unknown as { heading: string | null } ).heading || '';
		const description =
			( this as unknown as { description: string | null } ).description || '';

		return html`
			${ icon
		? html`<wpd-icon
						class="wpd-empty-state__icon"
						name=${ icon }
						size="28"
				  ></wpd-icon>`
		: null }
			<h3 class="wpd-empty-state__heading">${ heading }</h3>
			<p class="wpd-empty-state__description">${ description }</p>
			<div class="wpd-empty-state__cta">
				<slot name="cta"></slot>
			</div>
			<slot></slot>
		`;
	}
}
defineComponent( 'wpd-empty-state', WpdEmptyState );
