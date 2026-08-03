/**
 * `<os-empty-state>` — centered placeholder for "nothing here
 * yet" UI: icon + heading + description + optional CTA slot.
 * Every plugin eventually needs one (empty lists, missing
 * templates, feature-unavailable guards) and a canonical shape
 * keeps them visually consistent across the shell.
 *
 * Usage:
 *
 *   <os-empty-state
 *     icon="admin-plugins"
 *     heading="No plugins installed yet"
 *     description="Install a plugin to see it here."
 *   >
 *     <os-button slot="cta" variant="primary">Browse plugins</os-button>
 *   </os-empty-state>
 *
 * Attributes:
 *   - `icon`        — dashicons slug (with or without `dashicons-` prefix).
 *   - `heading`     — bold first line.
 *   - `description` — secondary text below the heading.
 *
 * Slots:
 *   - `cta`  — optional call-to-action row below the description.
 *   - default — any additional content.
 */

import { Component, defineComponent, html } from '../../core';
import '../os-icon/os-icon';
import { styles } from './os-empty-state.styles';

export class OsEmptyState extends Component {
	static props = [ 'icon', 'heading', 'description' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Empty state',
		summary:
			'Centered placeholder for "nothing here yet" UI: icon + heading + description + optional CTA. A canonical shape so empty states look consistent across the shell.',
		status: 'stable',
		since: '0.5.0',
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
			{ name: '--os-ui-fg', description: 'Heading colour.' },
			{ name: '--os-ui-fg-muted', description: 'Description colour.' },
			{ name: '--os-ui-empty-state-fg' },
			{ name: '--os-ui-empty-state-icon-color' },
		],
		example: html`
			<os-empty-state
				icon="admin-plugins"
				heading="No plugins installed yet"
				description="Install a plugin to see it here."
			>
				<os-button slot="cta" variant="primary">Browse plugins</os-button>
			</os-empty-state>
		`,
	} as const;

	protected render() {
		const icon = ( this as unknown as { icon: string | null } ).icon || '';
		const heading = ( this as unknown as { heading: string | null } ).heading || '';
		const description =
			( this as unknown as { description: string | null } ).description || '';

		return html`
			${ icon
		? html`<os-icon
						class="os-empty-state__icon"
						name=${ icon }
						size="28"
				  ></os-icon>`
		: null }
			<h3 class="os-empty-state__heading">${ heading }</h3>
			<p class="os-empty-state__description">${ description }</p>
			<div class="os-empty-state__cta">
				<slot name="cta"></slot>
			</div>
			<slot></slot>
		`;
	}
}
defineComponent( 'os-empty-state', OsEmptyState );
