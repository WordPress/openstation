/**
 * `<wpd-steps>` + `<wpd-step>` — ordered / numbered-steps primitive.
 *
 * Replaces the `<wpd-cluster>` + `<wpd-display>` + custom number-chip
 * CSS pattern plugin authors were hand-rolling for onboarding / setup
 * flows. Numbers are auto-assigned via a CSS counter — inserting or
 * removing a step renumbers the rest for free.
 *
 * Usage:
 *
 *   <wpd-steps>
 *     <wpd-step title="Install the plugin">
 *       Search the plugin directory for “My Plugin” and click Install.
 *     </wpd-step>
 *     <wpd-step title="Open Settings">
 *       Navigate to <wpd-code>Settings → My Plugin</wpd-code>.
 *     </wpd-step>
 *     <wpd-step title="Enter your API key" done>
 *       Already done earlier in this flow.
 *     </wpd-step>
 *   </wpd-steps>
 *
 * Mark a step with `done` to render a ✓ instead of the number.
 *
 * @since 0.17.0
 */

import { Component, defineComponent, html } from '../../core';
import { stepStyles, stepsStyles } from './wpd-steps.styles';

export class WpdSteps extends Component {
	static props = [] as const;
	static styles = [ stepsStyles ];

	static help = {
		title: 'Steps',
		summary:
			'Ordered/numbered-steps container. Children are <wpd-step> elements; numbers are assigned via a CSS counter so insertions renumber automatically. Use for onboarding, setup flows, migration guides.',
		status: 'experimental',
		since: '0.17.0',
		slots: [
			{
				name: '(default)',
				description:
					'One or more <wpd-step> elements. Anything else is rendered but not numbered.',
			},
		],
		cssProps: [
			{
				name: '--wpd-steps-gap',
				default: '16px',
				description: 'Vertical space between steps.',
			},
		],
		example: html`
			<wpd-steps>
				<wpd-step title="Install">Click Install in the plugin directory.</wpd-step>
				<wpd-step title="Activate">Click Activate on the Plugins page.</wpd-step>
			</wpd-steps>
		`,
	} as const;

	protected render() {
		return html`<ol class="wpd-steps__list"><slot></slot></ol>`;
	}
}
defineComponent( 'wpd-steps', WpdSteps );

export class WpdStep extends Component {
	static props = [ 'title', 'done' ] as const;
	static styles = [ stepStyles ];

	static help = {
		title: 'Step',
		summary:
			'A single numbered step inside <wpd-steps>. Renders an auto-numbered chip and an optional bold title above the slotted body.',
		status: 'experimental',
		since: '0.17.0',
		props: [
			{
				name: 'title',
				type: 'string',
				description: 'Optional bold title rendered above the body.',
			},
			{
				name: 'done',
				type: 'boolean',
				description:
					'When present, the chip shows a ✓ in a muted colour instead of the number.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Step body content.' },
		],
		cssProps: [
			{ name: '--wpd-step-gap', default: '12px' },
			{ name: '--wpd-step-chip-size', default: '28px' },
			{
				name: '--wpd-step-chip-bg',
				default: 'var(--wp-admin-theme-color)',
			},
			{ name: '--wpd-step-chip-fg', default: '#fff' },
			{
				name: '--wpd-step-chip-done-bg',
				default: 'var(--desktop-mode-muted)',
			},
			{ name: '--wpd-step-chip-font-size', default: '13px' },
		],
		example: html`
			<wpd-steps>
				<wpd-step title="Configure">Open OS Settings → AI.</wpd-step>
				<wpd-step title="Connect" done>Key confirmed.</wpd-step>
			</wpd-steps>
		`,
	} as const;

	protected render() {
		const title = ( this as unknown as { title: string | null } ).title || '';
		return html`
			<div class="wpd-step__body">
				<div class="wpd-step__title">${ title }</div>
				<slot></slot>
			</div>
		`;
	}
}
defineComponent( 'wpd-step', WpdStep );
