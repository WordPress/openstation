/**
 * `<wpd-progress-bar>` — determinate or indeterminate progress indicator.
 *
 * Drop-in:
 *
 * ```html
 * <wpd-progress-bar value="42"></wpd-progress-bar>
 * <wpd-progress-bar indeterminate label="Uploading…"></wpd-progress-bar>
 * <wpd-progress-bar value="280" max="320" tone="success"
 *     label="hero.jpg" show-percent></wpd-progress-bar>
 * ```
 *
 * Determinate: set `value` (and optionally `max`, default `100`). The
 * fill width animates between updates. Indeterminate: set the boolean
 * `indeterminate` attribute — a 33% bar sweeps across the track on a
 * 1.1s linear loop.
 *
 * Tone (`default | success | warning | danger`) tints the fill via the
 * shared `--desktop-mode-status-*` palette so the bar reads the same as
 * the rest of the shell. Every visual surface — track, fill, height,
 * radius, label color/size — is overridable via CSS custom properties.
 *
 * @since 0.31.0
 */

import { Component, defineComponent, html, type TemplateResult } from '../../core';
import { styles } from './wpd-progress-bar.styles';

export type WpdProgressTone = 'default' | 'success' | 'warning' | 'danger';

export class WpdProgressBar extends Component {
	static props = [
		'value',
		'max',
		'indeterminate',
		'tone',
		'label',
		'showPercent',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Progress bar',
		summary:
			'Linear progress indicator. Determinate mode shows `value/max` as a fill width; indeterminate mode sweeps across the track. Supports tone tinting, an optional inline label + percent header, and full CSS-variable theming.',
		status: 'experimental',
		since: '0.31.0',
		props: [
			{
				name: 'value',
				type: 'number',
				default: '0',
				description: 'Current progress. Clamped to `[0, max]`.',
			},
			{
				name: 'max',
				type: 'number',
				default: '100',
				description: 'Maximum value. Setting `max <= 0` forces indeterminate.',
			},
			{
				name: 'indeterminate',
				type: 'boolean',
				description:
					'Show the sweeping indeterminate animation instead of a value-driven fill. The `value` attribute is ignored while this is set.',
			},
			{
				name: 'tone',
				type: '"default" | "success" | "warning" | "danger"',
				default: 'default',
				description: 'Tints the fill from the shared status palette.',
			},
			{
				name: 'label',
				type: 'string',
				description:
					'Optional inline label rendered above the track. Also wired into `aria-label` when set.',
			},
			{
				name: 'show-percent',
				type: 'boolean',
				description:
					'Render a right-aligned percent readout next to the label. Only meaningful in determinate mode.',
			},
		],
		cssProps: [
			{
				name: '--wpd-progress-track-bg',
				default: 'var(--desktop-mode-control-bg, rgba(0,0,0,0.08))',
			},
			{
				name: '--wpd-progress-fill',
				default: 'var(--wp-admin-theme-color, #2271b1)',
			},
			{ name: '--wpd-progress-height', default: '6px' },
			{ name: '--wpd-progress-radius', default: '999px' },
			{ name: '--wpd-progress-label-color', default: 'inherit' },
			{ name: '--wpd-progress-label-size', default: '12px' },
			{ name: '--wpd-progress-label-gap', default: '4px' },
		],
		example: html`<wpd-progress-bar
			value="42"
			label="Uploading hero.jpg"
			show-percent
		></wpd-progress-bar>`,
	} as const;

	protected render(): TemplateResult {
		return html`<div class="root" part="root">
			<div class="header" part="header" hidden>
				<span class="label" part="label"></span>
				<span class="percent" part="percent"></span>
			</div>
			<div class="track" part="track">
				<div class="fill" part="fill"></div>
			</div>
		</div>`;
	}

	protected requestUpdate(): void {
		super.requestUpdate();
		queueMicrotask( () => this._paint() );
	}

	connectedCallback(): void {
		super.connectedCallback();
		queueMicrotask( () => this._paint() );
	}

	private _paint(): void {
		const root = this.shadowRoot;
		if ( ! root ) {
			return;
		}
		const max = this._readMax();
		const indeterminate = this.hasAttribute( 'indeterminate' ) || max <= 0;
		const value = indeterminate ? 0 : this._readValue( max );
		const ratio = indeterminate ? 0 : value / max;
		const percent = Math.round( ratio * 100 );
		const label = this.getAttribute( 'label' ) ?? '';
		const showPercent = this.hasAttribute( 'show-percent' );

		const fill = root.querySelector( '.fill' ) as HTMLElement | null;
		if ( fill && ! indeterminate ) {
			fill.style.width = `${ ( ratio * 100 ).toFixed( 2 ) }%`;
		} else if ( fill && indeterminate ) {
			fill.style.removeProperty( 'width' );
		}

		const header = root.querySelector( '.header' ) as HTMLElement | null;
		const labelEl = root.querySelector( '.label' ) as HTMLElement | null;
		const percentEl = root.querySelector( '.percent' ) as HTMLElement | null;
		if ( header && labelEl && percentEl ) {
			const visible = label || ( showPercent && ! indeterminate );
			header.hidden = ! visible;
			labelEl.textContent = label;
			percentEl.hidden = ! ( showPercent && ! indeterminate );
			percentEl.textContent = `${ percent }%`;
		}

		const track = root.querySelector( '.track' ) as HTMLElement | null;
		if ( track ) {
			track.setAttribute( 'role', 'progressbar' );
			track.setAttribute( 'aria-valuemin', '0' );
			if ( indeterminate ) {
				track.removeAttribute( 'aria-valuenow' );
				track.removeAttribute( 'aria-valuemax' );
			} else {
				track.setAttribute( 'aria-valuemax', String( max ) );
				track.setAttribute( 'aria-valuenow', String( value ) );
			}
			if ( label ) {
				track.setAttribute( 'aria-label', label );
			} else {
				track.removeAttribute( 'aria-label' );
			}
		}
	}

	private _readMax(): number {
		const attr = this.getAttribute( 'max' );
		if ( attr === null ) {
			return 100;
		}
		const raw = parseFloat( attr );
		// Keep non-positive values verbatim so the indeterminate
		// fallback can see them; clamp only `NaN` to the default.
		return Number.isFinite( raw ) ? raw : 100;
	}

	private _readValue( max: number ): number {
		const raw = parseFloat( this.getAttribute( 'value' ) ?? '0' );
		if ( ! Number.isFinite( raw ) ) {
			return 0;
		}
		if ( raw < 0 ) {
			return 0;
		}
		if ( raw > max ) {
			return max;
		}
		return raw;
	}
}

defineComponent( 'wpd-progress-bar', WpdProgressBar );
