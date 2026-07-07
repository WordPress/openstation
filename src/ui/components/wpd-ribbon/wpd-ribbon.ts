/**
 * `<wpd-ribbon>` — diagonal corner ribbon.
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
 *     <wpd-ribbon>Featured</wpd-ribbon>
 *     …card content…
 *   </article>
 *
 *   <wpd-ribbon placement="bottom-start" tone="success">NEW</wpd-ribbon>
 *
 * The parent MUST be a positioned ancestor (relative / absolute /
 * fixed / sticky). Without that, the ribbon anchors to the next
 * positioned element up the tree — usually the viewport — which is
 * never what you want.
 *
 * Slot contents flow through to the rotated banner. Keep the label
 * short — the visible slice is ~80px wide and tightly cropped.
 *
 * @since 0.8.6
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-ribbon.styles';

export type WpdRibbonPlacement =
	| 'top-end'
	| 'top-start'
	| 'bottom-end'
	| 'bottom-start';

export type WpdRibbonTone =
	| 'primary'
	| 'success'
	| 'warning'
	| 'danger'
	| 'info'
	| 'neutral';

export class WpdRibbon extends Component {
	static props = [ 'placement', 'tone' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Ribbon',
		summary:
			'45° corner ribbon. Wraps the top-end (default), top-start, bottom-end, or bottom-start corner of its positioned parent. The host owns clipping + rotation; consumers only set position-relative on the parent and drop a label inside.',
		status: 'experimental',
		since: '0.8.6',
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
			{ name: '--wpd-ribbon-size', default: '90px', description: 'Square clipping window edge.' },
			{ name: '--wpd-ribbon-banner-width', default: '140px', description: 'Width of the rotated strip.' },
			{ name: '--wpd-ribbon-banner-offset', default: '20px', description: 'Distance from corner to strip center.' },
			{ name: '--wpd-ribbon-banner-pull', default: '-36px', description: 'How far the strip overhangs the clip edge.' },
			{ name: '--wpd-ribbon-bg', default: 'var(--wp-admin-theme-color, #2271b1)' },
			{ name: '--wpd-ribbon-fg', default: '#fff' },
			{ name: '--wpd-ribbon-shadow', default: '0 2px 4px rgba(0,0,0,0.2)' },
			{ name: '--wpd-ribbon-padding', default: '4px 0' },
			{ name: '--wpd-ribbon-font', default: '700 10px/1.4 system-ui' },
			{ name: '--wpd-ribbon-tracking', default: '0.06em' },
			{ name: '--wpd-ribbon-z', default: '2' },
		],
		example: html`
			<div
				style="position: relative; width: 240px; height: 120px;
				       border: 1px solid #ccc; border-radius: 8px;
				       padding: 16px; box-sizing: border-box;"
			>
				<wpd-ribbon>Featured</wpd-ribbon>
				Card body…
			</div>
		`,
	} as const;

	protected render() {
		return html`<span class="banner" part="banner"><slot></slot></span>`;
	}
}
defineComponent( 'wpd-ribbon', WpdRibbon );
