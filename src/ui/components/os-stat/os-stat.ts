/**
 * `<os-stat>` — big number, small uppercase label, optional footnote.
 *
 * The stat tile every dashboard-ish surface ends up drawing — before
 * this component, three apps' surfaces drew it three times with three
 * stylesheets. Compose a strip with `<os-grid>`.
 *
 * Usage:
 *
 *   <os-stat value="1,204" label="Events"></os-stat>
 *   <os-stat value="9 days" label="Longest streak" caption="Mar 3 → Mar 12"></os-stat>
 *   <os-stat value="12" label="Warnings" swatch data-tone="warning"></os-stat>
 *
 * `swatch` renders a small colour chip beside the label, filled from
 * the app runtime's tone contract: put `data-tone="danger|warning|
 * neutral|info"` on the element (inside an app root) and the chip
 * picks up the matching status colour via `--os-app-tone`.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-stat.styles';

export class OsStat extends Component {
	static props = [ 'value', 'label', 'caption', 'swatch' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Stat',
		summary:
			'One stat tile: big value, small uppercase label, optional caption. `swatch` adds a severity chip coloured by the app tone contract (data-tone on the host).',
		status: 'stable',
		props: [
			{ name: 'value', type: 'string', description: 'The headline number (pre-formatted).' },
			{ name: 'label', type: 'string', description: 'Small uppercase label under the value.' },
			{ name: 'caption', type: 'string', description: 'Optional footnote under the label.' },
			{
				name: 'swatch',
				type: 'boolean',
				description:
					'Render a colour chip beside the label, filled from --os-app-tone (set data-tone on the host inside an app root).',
			},
		],
		slots: [],
		cssProps: [
			{ name: '--os-ui-stat-border', default: 'var(--os-ui-border, #dcdcde)' },
			{ name: '--os-ui-stat-bg', default: 'transparent' },
			{ name: '--os-ui-stat-value-color', default: 'var(--wp-admin-theme-color, #2271b1)' },
			{ name: '--os-ui-stat-value-size', default: '20px' },
			{ name: '--os-ui-stat-label-color', default: 'var(--os-ui-fg-muted, #646970)' },
			{ name: '--os-ui-stat-padding', default: '10px 12px' },
			{ name: '--os-ui-stat-radius', default: '8px' },
		],
		example: html`
			<os-grid style="--os-ui-grid-columns: repeat( 3, minmax( 0, 1fr ) );">
				<os-stat value="1,204" label="Events"></os-stat>
				<os-stat value="9 days" label="Longest streak" caption="Mar 3 → Mar 12"></os-stat>
				<os-stat value="12" label="Warnings" swatch data-tone="warning"></os-stat>
			</os-grid>
		`,
	} as const;

	protected render() {
		const self = this as unknown as {
			value: string | null;
			label: string | null;
			caption: string | null;
		};
		const caption = self.caption || '';
		return html`
			<span class="value" part="value">${ self.value || '' }</span>
			<span class="label" part="label">
				${ this.hasAttribute( 'swatch' ) ? html`<i class="swatch" aria-hidden="true"></i>` : '' }
				${ self.label || '' }
			</span>
			${ caption ? html`<span class="caption" part="caption">${ caption }</span>` : '' }
		`;
	}
}
defineComponent( 'os-stat', OsStat );
