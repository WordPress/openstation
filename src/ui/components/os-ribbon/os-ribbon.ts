/**
 * `<os-ribbon>` — diagonal corner ribbon.
 *
 * A small, decorative "wrap-around-the-corner" banner — the kind that
 * stamps a card with FEATURED, NEW, BETA, SALE, etc. The component
 * auto-positions itself at one of the four corners of its (positioned)
 * parent, so consumers only need to drop it inside a `position:
 * relative` container.
 *
 * Usage:
 *
 *   <article style="position: relative;">
 *     <os-ribbon>Featured</os-ribbon>
 *     …card content…
 *   </article>
 *
 *   <os-ribbon placement="bottom-start" tone="success">NEW</os-ribbon>
 *
 * The parent MUST be a positioned ancestor (relative / absolute /
 * fixed / sticky). Without that, the ribbon anchors to the next
 * positioned element up the tree — usually the viewport — which is
 * never what you want.
 *
 * Slot contents flow through to the rotated banner. Keep the label
 * short — the visible slice is ~80px wide and tightly cropped.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-ribbon.styles';

export type OsRibbonPlacement =
	| 'top-end'
	| 'top-start'
	| 'bottom-end'
	| 'bottom-start';

export type OsRibbonTone =
	| 'primary'
	| 'success'
	| 'warning'
	| 'danger'
	| 'info'
	| 'neutral';

export class OsRibbon extends Component {
	static props = [ 'placement', 'tone' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Ribbon',
		summary:
			'45° corner ribbon. Wraps the top-end (default), top-start, bottom-end, or bottom-start corner of its positioned parent. The host owns clipping + rotation; consumers only set position-relative on the parent and drop a label inside.',
		status: 'stable',
		props: [
			{
				name: 'placement',
				type: '"top-end" | "top-start" | "bottom-end" | "bottom-start"',
				description:
					'Which corner of the parent the ribbon hugs. Defaults to `top-end` (logical right in LTR, left in RTL).',
			},
			{
				name: 'tone',
				type: '"primary" | "success" | "warning" | "danger" | "info" | "neutral"',
				description:
					'Background color tone. Defaults to `primary` (the admin theme accent).',
			},
		],
		slots: [ { name: '(default)', description: 'Ribbon label text. Keep short.' } ],
		cssProps: [
			{ name: '--os-ui-ribbon-size', default: '90px', description: 'Square clipping window edge.' },
			{ name: '--os-ui-ribbon-banner-width', default: '140px', description: 'Width of the rotated strip.' },
			{ name: '--os-ui-ribbon-banner-offset', default: '20px', description: 'Distance from corner to strip center.' },
			{ name: '--os-ui-ribbon-banner-pull', default: '-36px', description: 'How far the strip overhangs the clip edge.' },
			{ name: '--os-ui-ribbon-bg', default: 'var(--wp-admin-theme-color, #2271b1)' },
			{ name: '--os-ui-ribbon-fg', default: '#fff' },
			{ name: '--os-ui-ribbon-shadow', default: '0 2px 4px rgba(0,0,0,0.2)' },
			{ name: '--os-ui-ribbon-padding', default: '4px 0' },
			{ name: '--os-ui-ribbon-font', default: '700 10px/1.4 system-ui' },
			{ name: '--os-ui-ribbon-tracking', default: '0.06em' },
			{ name: '--os-ui-ribbon-z', default: '2' },
		],
		example: html`
			<div
				style="position: relative; width: 240px; height: 120px;
				       border: 1px solid #ccc; border-radius: 8px;
				       padding: 16px; box-sizing: border-box;"
			>
				<os-ribbon>Featured</os-ribbon>
				Card body…
			</div>
		`,
	} as const;

	protected render() {
		return html`<span class="banner" part="banner"><slot></slot></span>`;
	}
}
defineComponent( 'os-ribbon', OsRibbon );
