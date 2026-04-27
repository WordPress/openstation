/**
 * `<wpd-badge>` — colored-dot status pill.
 *
 * Tiny, recurring need across devtools and shell affordances. A
 * leading dot in the tone color, a label slot, a pill background
 * derived from the tone. Five built-in tones — `success`, `warning`,
 * `danger`, `info`, `neutral` — match common UI semantics; plugins
 * that need a custom color can override the underlying CSS variables
 * without touching the host's tone attribute.
 *
 * Usage:
 *
 *   <wpd-badge tone="success">Attached</wpd-badge>
 *   <wpd-badge tone="danger">Errored</wpd-badge>
 *   <wpd-badge tone="info" no-dot>v0.18.0</wpd-badge>
 *
 * @since 0.6.0
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-badge.styles';

export type WpdBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export class WpdBadge extends Component {
	static props = [ 'tone', 'noDot' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Badge',
		summary:
			'Status pill with a colored leading dot and a label slot. Use for window-attached states, count chips, version markers, and any other small status surface where a leading tone-coded dot communicates meaning at a glance.',
		status: 'experimental',
		since: '0.6.0',
		props: [
			{
				name: 'tone',
				type: '"success" | "warning" | "danger" | "info" | "neutral"',
				description:
					'Color tone applied to the dot + pill background. Default is "neutral".',
			},
			{
				name: 'no-dot',
				type: 'boolean',
				description:
					'Suppress the leading dot. Useful for count badges where the label itself is the whole signal.',
			},
		],
		slots: [ { name: '(default)', description: 'Badge label.' } ],
		cssProps: [
			{ name: '--wpd-badge-color', description: 'Foreground color (also dot color).' },
			{ name: '--wpd-badge-bg', description: 'Pill background color.' },
			{ name: '--wpd-badge-border', default: '1px solid transparent' },
			{ name: '--wpd-badge-padding', default: '2px 8px' },
			{ name: '--wpd-badge-gap', default: '6px' },
			{ name: '--wpd-badge-dot-size', default: '8px' },
			{ name: '--wpd-badge-border-radius', default: '999px' },
		],
		example: html`
			<wpd-badge tone="success">Attached</wpd-badge>
			<wpd-badge tone="warning">Detaching…</wpd-badge>
			<wpd-badge tone="danger">Errored</wpd-badge>
			<wpd-badge tone="info" no-dot>v0.6.0</wpd-badge>
		`,
	} as const;

	protected render() {
		return html`<span class="dot" aria-hidden="true"></span><slot></slot>`;
	}
}
defineComponent( 'wpd-badge', WpdBadge );
