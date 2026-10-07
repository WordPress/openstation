import { Component, defineComponent, html } from '../../core';
import { factStyles, factsStyles } from './os-facts.styles';

export class OsFact extends Component {
	static props = [ 'label' ] as const;
	static styles = [ factStyles ];

	static help = {
		title: 'Fact',
		summary:
			'One label/value row inside an <os-facts> list. The value is the default slot, so it can carry an <os-code>, an <os-relative-time>, a link or a badge.',
		status: 'stable',
		props: [
			{
				name: 'label',
				type: 'string',
				description:
					'The row label. Use the `label` slot instead when the label needs markup.',
			},
		],
		slots: [
			{ name: '(default)', description: 'The value.' },
			{ name: 'label', description: 'The label, when it needs markup.' },
		],
		cssProps: [
			{ name: '--os-ui-facts-code-bg', default: 'transparent' },
			{ name: '--os-ui-facts-code-border', default: 'none' },
			{ name: '--os-ui-facts-code-padding', default: '0' },
			{ name: '--os-ui-facts-code-font-size', default: '1em' },
		],

		example: html`
			<os-facts>
				<os-fact label="File">class-foo.php</os-fact>
				<os-fact label="Occurrences">1,204</os-fact>
			</os-facts>
		`,
	} as const;

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		return html`
			<dt part="label"><slot name="label">${ label }</slot></dt>
			<dd part="value"><slot></slot></dd>
		`;
	}
}
defineComponent( 'os-fact', OsFact );

export class OsFacts extends Component {
	static props = [ 'layout' ] as const;
	static styles = [ factsStyles ];

	static help = {
		title: 'Facts',
		summary:
			'Label/value list — a real <dl> whose rows are <os-fact> children. Labels sit in a content-sized column beside their values; `layout="between"` spreads each pair across its own line and `stacked` puts the label above the value.',
		status: 'stable',
		props: [
			{
				name: 'layout',
				type: "'columns' | 'between'",
				description:
					'`columns` (default) aligns every value in one column. `between` gives each pair its own line with the value pushed to the far edge.',
			},
			{
				name: 'stacked',
				type: 'boolean',
				description:
					'Label above the value rather than beside it, for a narrow pane.',
			},
		],
		slots: [ { name: '(default)', description: '<os-fact> children.' } ],
		cssProps: [
			{ name: '--os-ui-facts-font-size', default: '13px' },
			{ name: '--os-ui-facts-row-gap', default: '6px' },
			{ name: '--os-ui-facts-column-gap', default: '14px' },
			{ name: '--os-ui-facts-label-color', default: 'var(--os-ui-fg-muted, #646970)' },
			{ name: '--os-ui-facts-align', default: 'baseline' },
		],
		example: html`
			<os-facts>
				<os-fact label="File">class-foo.php</os-fact>
				<os-fact label="Source">Plugin: Akismet</os-fact>
				<os-fact label="Occurrences">1,204</os-fact>
			</os-facts>
		`,
	} as const;

	protected render() {
		return html`<dl part="list"><slot></slot></dl>`;
	}
}
defineComponent( 'os-facts', OsFacts );
