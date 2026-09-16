/** App body with persistent header, toolbar and footer around a bounded content region. */
import { Component, defineComponent, html } from '../../core';
import { styles } from './os-app-frame.styles';

export class OsAppFrame extends Component {
	static props = [ 'contained' ] as const;
	static styles = [ styles ];
	static help = {
		title: 'App frame',
		summary: 'Header, toolbar and footer stay visible while the body scrolls. Use contained when a split pane or table owns scrolling.',
		status: 'stable',
		props: [ { name: 'contained', type: 'boolean', description: 'Fill the body with children that own their scrolling; disables frame scrolling.' } ],
		slots: [
			{ name: 'header', description: 'Title or tabs.' },
			{ name: 'toolbar', description: 'Actions and filters.' },
			{ name: '(default)', description: 'Scrollable content, or a filling child when contained.' },
			{ name: 'footer', description: 'Status or pagination.' },
		],
		parts: [ { name: 'content', description: 'The bounded body region.' } ],
		example: html`<os-app-frame style="height: 220px">
			<os-cluster slot="toolbar"><os-button>New item</os-button></os-cluster>
			<os-stack><os-panel>Content</os-panel><os-panel>More content</os-panel></os-stack>
			<span slot="footer">Ready</span>
		</os-app-frame>`,
	} as const;

	protected render() {
		return html`<div><slot name="header"></slot></div>
			<div><slot name="toolbar"></slot></div>
			<div class="content" part="content"><slot></slot></div>
			<div><slot name="footer"></slot></div>`;
	}
}
defineComponent( 'os-app-frame', OsAppFrame );
