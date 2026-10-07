import { Component, defineComponent, html } from '../../core';
import { styles } from './os-badge.styles';

export type OsBadgeTone =
	| 'success'
	| 'warning'
	| 'danger'
	| 'info'
	| 'neutral'
	| 'accent';

export class OsBadge extends Component {
	static props = [ 'tone', 'noDot' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Badge',
		summary:
			'Status pill with a colored leading dot and a label slot. Use for window-attached states, count chips, version markers, and any other small status surface where a leading tone-coded dot communicates meaning at a glance.',
		status: 'stable',
		props: [
			{
				name: 'tone',
				type: '"success" | "warning" | "danger" | "info" | "neutral" | "accent"',
				description:
					'Color tone applied to the dot + pill background. Default is "neutral". "accent" is the odd one out and is not a status: it fills the pill with the brand mesh and drops the dot, for the badge that means "this is the one" rather than "this is the state".',
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
			{ name: '--os-ui-badge-color', description: 'Foreground color (also dot color).' },
			{ name: '--os-ui-badge-bg', description: 'Pill background color.' },
			{ name: '--os-ui-badge-border', default: '1px solid transparent' },
			{ name: '--os-ui-badge-padding', default: '2px 8px' },
			{ name: '--os-ui-badge-gap', default: '6px' },
			{ name: '--os-ui-badge-dot-size', default: '8px' },
			{ name: '--os-ui-badge-border-radius', default: '999px' },
		],
		example: html`
			<os-badge tone="success">Attached</os-badge>
			<os-badge tone="warning">Detaching…</os-badge>
			<os-badge tone="danger">Errored</os-badge>
			<os-badge tone="info" no-dot>v0.6.0</os-badge>
		`,
	} as const;

	protected render() {
		return html`<span class="dot" aria-hidden="true"></span><slot></slot>`;
	}
}
defineComponent( 'os-badge', OsBadge );
