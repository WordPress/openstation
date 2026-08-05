/**
 * `<os-steps>` + `<os-step>` — ordered / numbered-steps primitive.
 *
 * Replaces the `<os-cluster>` + `<os-display>` + custom number-chip
 * CSS pattern plugin authors were hand-rolling for onboarding / setup
 * flows. Numbers are auto-assigned via a CSS counter — inserting or
 * removing a step renumbers the rest for free.
 *
 * Usage:
 *
 *   <os-steps>
 *     <os-step title="Install the plugin">
 *       Search the plugin directory for “My Plugin” and click Install.
 *     </os-step>
 *     <os-step title="Open Settings">
 *       Navigate to <os-code>Settings → My Plugin</os-code>.
 *     </os-step>
 *     <os-step title="Enter your API key" done>
 *       Already done earlier in this flow.
 *     </os-step>
 *   </os-steps>
 *
 * Mark a step with `done` to render a ✓ instead of the number.
 */

import { Component, defineComponent, html } from '../../core';
import { stepStyles, stepsStyles } from './os-steps.styles';

export class OsSteps extends Component {
	static props = [] as const;
	static styles = [ stepsStyles ];

	static help = {
		title: 'Steps',
		summary:
			'Ordered/numbered-steps container. Children are <os-step> elements; numbers are assigned via a CSS counter so insertions renumber automatically. Use for onboarding, setup flows, migration guides.',
		status: 'stable',
		slots: [
			{
				name: '(default)',
				description:
					'One or more <os-step> elements. Anything else is rendered but not numbered.',
			},
		],
		cssProps: [
			{
				name: '--os-ui-steps-gap',
				default: '16px',
				description: 'Vertical space between steps.',
			},
		],
		example: html`
			<os-steps>
				<os-step title="Install">Click Install in the plugin directory.</os-step>
				<os-step title="Activate">Click Activate on the Plugins page.</os-step>
			</os-steps>
		`,
	} as const;

	protected render() {
		return html`<ol class="os-steps__list"><slot></slot></ol>`;
	}
}
defineComponent( 'os-steps', OsSteps );

export class OsStep extends Component {
	static props = [ 'title', 'done' ] as const;
	static styles = [ stepStyles ];

	static help = {
		title: 'Step',
		summary:
			'A single numbered step inside <os-steps>. Renders an auto-numbered chip and an optional bold title above the slotted body.',
		status: 'stable',
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
			{ name: '--os-ui-step-gap', default: '12px' },
			{ name: '--os-ui-step-chip-size', default: '28px' },
			{
				name: '--os-ui-step-chip-bg',
				default: 'var(--wp-admin-theme-color)',
			},
			{ name: '--os-ui-step-chip-fg', default: '#fff' },
			{
				name: '--os-ui-step-chip-done-bg',
				default: 'var(--os-ui-fg-muted)',
			},
			{ name: '--os-ui-step-chip-font-size', default: '13px' },
		],
		example: html`
			<os-steps>
				<os-step title="Configure">Open OpenStation Settings → AI.</os-step>
				<os-step title="Connect" done>Key confirmed.</os-step>
			</os-steps>
		`,
	} as const;

	protected render() {
		const title = ( this as unknown as { title: string | null } ).title || '';
		return html`
			<div class="os-step__body">
				<div class="os-step__title">${ title }</div>
				<slot></slot>
			</div>
		`;
	}
}
defineComponent( 'os-step', OsStep );
