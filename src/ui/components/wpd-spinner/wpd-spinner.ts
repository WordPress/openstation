/**
 * `<wpd-spinner>` — animated WordPress-mark loading indicator.
 *
 * Drop-in:
 *
 * ```html
 * <wpd-spinner></wpd-spinner>                              <!-- classic, 48px, WP blue -->
 * <wpd-spinner preset="comet" size="80"></wpd-spinner>
 * <wpd-spinner preset="orbit" color="#0f4c6b"></wpd-spinner>
 * <wpd-spinner preset="pulse" accent="#fff8e7"></wpd-spinner>
 * ```
 *
 * ## Presets
 *
 * Four curated looks. Pick one with the `preset` attribute; every
 * other knob (speeds, arc lengths, ring directions, pulse, dot count)
 * defaults to the preset's value but can be individually overridden:
 *
 *   - `classic` (default) — clean three-ring WordPress mark.
 *   - `comet` — long arcs + 5 trailing dots, all spinning the same
 *     way. Reads as a comet trail.
 *   - `orbit` — half-rings counter-rotating with an opacity breathe.
 *     Reads as planetary orbit.
 *   - `pulse` — short arcs + 8 dots + scale + opacity pulse. Reads
 *     as a heartbeat.
 *
 * Override anything from the preset:
 *
 * ```html
 * <wpd-spinner preset="comet" sp1="6" dots="8"></wpd-spinner>
 * ```
 *
 * ## Color model
 *
 * Two colors are driven by CSS custom properties — set them via the
 * `color` / `accent` attributes (string shortcuts) or via CSS
 * directly. The accent (the W mark inside the disc) defaults to
 * white but is fully configurable so a dark-on-light mark works the
 * same way as the canonical white-on-blue.
 *
 *   - `--wpd-spinner-color` — disc + ring + dot color. Default:
 *     `var( --wp-admin-theme-color, #21759b )`.
 *   - `--wpd-spinner-accent` — W-mark color. Default: `#fff`.
 *   - `--wpd-spinner-size` — host width/height. Default: `48px`.
 *     The shorthand `size` attribute writes a px value here.
 *
 * ## Reduced motion
 *
 * `prefers-reduced-motion: reduce` disables every animation inside
 * the SVG. The mark + rings still render statically.
 *
 * @since 0.6.0
 */

import { Component, defineComponent, html, type TemplateResult } from '../../core';
import { styles } from './wpd-spinner.styles';

export type WpdSpinnerPreset = 'classic' | 'comet' | 'orbit' | 'pulse';

export type WpdSpinnerPulse = 'none' | 'scale' | 'opacity' | 'both';

/**
 * Numeric configuration shape mirrored from the prototype. `sp*`
 * values are deciseconds (sp1=12 → 1.2s); arcs are 0–100 percent
 * of the ring's circumference. `dir2` / `dir3` flip ring direction;
 * ring 1 is always clockwise (the "anchor" ring).
 */
export interface WpdSpinnerConfig {
	sp1: number;
	sp2: number;
	sp3: number;
	a1: number;
	a2: number;
	a3: number;
	gap: number;
	dir2: 1 | -1;
	dir3: 1 | -1;
	pulse: WpdSpinnerPulse;
	dots: number;
}

/**
 * The four curated presets. Tuned so each reads as a distinct
 * "personality" at any size — classic is the canonical WP loader,
 * the other three each emphasise a different visual idea
 * (trails / orbit / pulse).
 */
export const WPD_SPINNER_PRESETS: Readonly<
	Record< WpdSpinnerPreset, Readonly< WpdSpinnerConfig > >
> = Object.freeze( {
	classic: {
		sp1: 12,
		sp2: 24,
		sp3: 40,
		a1: 28,
		a2: 15,
		a3: 8,
		gap: 4,
		dir2: 1,
		dir3: -1,
		pulse: 'none',
		dots: 0,
	},
	comet: {
		sp1: 8,
		sp2: 14,
		sp3: 26,
		a1: 50,
		a2: 28,
		a3: 12,
		gap: 3,
		dir2: 1,
		dir3: 1,
		pulse: 'none',
		dots: 5,
	},
	orbit: {
		sp1: 10,
		sp2: 10,
		sp3: 32,
		a1: 50,
		a2: 50,
		a3: 8,
		gap: 5,
		dir2: -1,
		dir3: -1,
		pulse: 'opacity',
		dots: 3,
	},
	pulse: {
		sp1: 6,
		sp2: 18,
		sp3: 30,
		a1: 20,
		a2: 12,
		a3: 6,
		gap: 4,
		dir2: 1,
		dir3: -1,
		pulse: 'both',
		dots: 8,
	},
} );

/**
 * Geometry constants from the original WordPress mark SVG. The disc
 * radius (DISC_R) and centre (CX/CY) are baked into the path data —
 * don't change them without re-deriving the W path coordinates.
 */
const CX = 61.26;
const CY = 61.26;
const DISC_R = 58.453;

/**
 * Compound paths for the WordPress "W" mark. Lifted as-is from the
 * original SVG. Drawn over the disc using `--wpd-spinner-accent`
 * (white by default) so the same paths work on any disc color.
 */
const W_PATHS =
	'<path d="m8.708 61.26c0 20.802 12.089 38.779 29.619 47.298l-25.069-68.686c-2.916 6.536-4.55 13.769-4.55 21.388z"/>' +
	'<path d="m96.74 58.608c0-6.495-2.333-10.993-4.334-14.494-2.664-4.329-5.161-7.995-5.161-12.324 0-4.831 3.664-9.328 8.825-9.328.233 0 .454.029.681.042-9.35-8.566-21.807-13.796-35.489-13.796-18.36 0-34.513 9.42-43.91 23.688 1.233.037 2.395.063 3.382.063 5.497 0 14.006-.667 14.006-.667 2.833-.167 3.167 3.994.337 4.329 0 0-2.847.335-6.015.501l19.138 56.925 11.501-34.493-8.188-22.434c-2.83-.166-5.511-.501-5.511-.501-2.832-.166-2.5-4.496.332-4.329 0 0 8.679.667 13.843.667 5.496 0 14.006-.667 14.006-.667 2.835-.167 3.168 3.994.337 4.329 0 0-2.853.335-6.015.501l18.992 56.494 5.242-17.517c2.272-7.269 4.001-12.49 4.001-16.989z"/>' +
	'<path d="m62.184 65.857-15.768 45.819c4.708 1.384 9.687 2.141 14.846 2.141 6.12 0 11.989-1.058 17.452-2.979-.141-.225-.269-.464-.374-.724z"/>' +
	'<path d="m107.376 36.046c.226 1.674.354 3.471.354 5.404 0 5.333-.996 11.328-3.996 18.824l-16.053 46.413c15.624-9.111 26.133-26.038 26.133-45.426.001-9.137-2.333-17.729-6.438-25.215z"/>';

export class WpdSpinner extends Component {
	static props = [
		'preset',
		'size',
		'color',
		'accent',
		'sp1',
		'sp2',
		'sp3',
		'a1',
		'a2',
		'a3',
		'gap',
		'dir2',
		'dir3',
		'pulse',
		'dots',
		'label',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Spinner',
		summary:
			'Animated WordPress-mark loading indicator with four curated presets and full per-attribute overrides. CSS variables drive disc + accent colors and size; reduced-motion preferences are respected.',
		status: 'experimental',
		since: '0.6.0',
		props: [
			{
				name: 'preset',
				type: '"classic" | "comet" | "orbit" | "pulse"',
				default: 'classic',
				description:
					'Visual personality. Every other attribute defaults to the preset\'s value and can be overridden individually.',
			},
			{
				name: 'size',
				type: 'integer (px) or CSS length',
				default: '48',
				description:
					'Sets `--wpd-spinner-size`. Bare numbers are treated as px; pass a CSS length (e.g. `2em`) to opt into ems / rems.',
			},
			{
				name: 'color',
				type: 'CSS color',
				description:
					'Disc + ring + dot color. Sets `--wpd-spinner-color`. Default inherits the WP admin theme color.',
			},
			{
				name: 'accent',
				type: 'CSS color',
				default: '#fff',
				description:
					'Color of the W mark inside the disc. Sets `--wpd-spinner-accent`. Default white — change for dark-on-light or themed marks.',
			},
			{
				name: 'sp1, sp2, sp3',
				type: 'integer (deciseconds)',
				description:
					'Per-ring rotation duration in tenths-of-a-second (12 → 1.2s). Higher = slower.',
			},
			{
				name: 'a1, a2, a3',
				type: 'integer (0-100)',
				description: 'Per-ring arc length as a percentage of the ring circumference.',
			},
			{
				name: 'gap',
				type: 'integer',
				description: 'Gap between concentric rings (units approximate to px at 120-viewport).',
			},
			{
				name: 'dir2, dir3',
				type: '"1" | "-1" | "cw" | "ccw"',
				description: 'Per-ring direction; ring 1 is always clockwise.',
			},
			{
				name: 'pulse',
				type: '"none" | "scale" | "opacity" | "both"',
				description: 'Pulse animation applied to the disc + W mark.',
			},
			{
				name: 'dots',
				type: 'integer',
				description: 'Outer trailing dot count. Sensible values: 0, 3, 5, 8.',
			},
			{
				name: 'label',
				type: 'string',
				default: 'Loading',
				description: 'Accessible name for the SVG (`role="img"` + `aria-label`).',
			},
		],
		cssProps: [
			{ name: '--wpd-spinner-color', default: 'var(--wp-admin-theme-color, #21759b)' },
			{ name: '--wpd-spinner-accent', default: '#fff' },
			{ name: '--wpd-spinner-size', default: '48px' },
		],
		example: html`<wpd-spinner preset="comet" size="80"></wpd-spinner>`,
	} as const;

	private _paintScheduled = false;

	connectedCallback(): void {
		super.connectedCallback();
		this._schedulePaint();
	}

	protected render(): TemplateResult {
		// Static skeleton — the actual SVG is painted imperatively.
		// SVG can't be reliably built via the html template tag because
		// inner SVG elements parse in HTML namespace when nested
		// templates are involved.
		return html`<div class="root" part="root"></div>`;
	}

	protected requestUpdate(): void {
		super.requestUpdate();
		this._schedulePaint();
	}

	private _schedulePaint(): void {
		if ( this._paintScheduled || ! this.isConnected ) {
			return;
		}
		this._paintScheduled = true;
		queueMicrotask( () => {
			this._paintScheduled = false;
			if ( ! this.isConnected ) {
				return;
			}
			this._paint();
		} );
	}

	private _paint(): void {
		this._syncCssVars();
		const root = this.shadowRoot?.querySelector(
			'.root',
		) as HTMLElement | null;
		if ( ! root ) {
			return;
		}
		root.innerHTML = this._buildSvg();
	}

	/**
	 * Reflect the color / accent / size attributes onto CSS custom
	 * properties on the host. Removing the attribute clears the var
	 * so the default cascades back in.
	 */
	private _syncCssVars(): void {
		const sync = (
			attr: string,
			varName: string,
			transform?: ( v: string ) => string,
		): void => {
			const v = this.getAttribute( attr );
			if ( v === null ) {
				this.style.removeProperty( varName );
			} else {
				this.style.setProperty(
					varName,
					transform ? transform( v ) : v,
				);
			}
		};
		sync( 'color', '--wpd-spinner-color' );
		sync( 'accent', '--wpd-spinner-accent' );
		sync( 'size', '--wpd-spinner-size', ( v ) =>
			/^-?\d+(\.\d+)?$/.test( v.trim() ) ? `${ v }px` : v,
		);
	}

	private _effectiveConfig(): WpdSpinnerConfig {
		const presetName = this.getAttribute( 'preset' ) ?? 'classic';
		const preset =
			WPD_SPINNER_PRESETS[ presetName as WpdSpinnerPreset ] ??
			WPD_SPINNER_PRESETS.classic;

		const num = ( attr: string, fallback: number ): number => {
			const v = this.getAttribute( attr );
			if ( v === null ) {
				return fallback;
			}
			const n = parseFloat( v );
			return Number.isFinite( n ) ? n : fallback;
		};
		const dir = ( attr: string, fallback: 1 | -1 ): 1 | -1 => {
			const v = this.getAttribute( attr );
			if ( v === null ) {
				return fallback;
			}
			const lc = v.toLowerCase();
			if ( lc === '-1' || lc === 'ccw' || lc === 'reverse' ) {
				return -1;
			}
			return 1;
		};
		const pulse = (): WpdSpinnerPulse => {
			const v = this.getAttribute( 'pulse' );
			if (
				v === 'scale' ||
				v === 'opacity' ||
				v === 'both' ||
				v === 'none'
			) {
				return v;
			}
			return preset.pulse;
		};

		return {
			sp1: num( 'sp1', preset.sp1 ),
			sp2: num( 'sp2', preset.sp2 ),
			sp3: num( 'sp3', preset.sp3 ),
			a1: num( 'a1', preset.a1 ),
			a2: num( 'a2', preset.a2 ),
			a3: num( 'a3', preset.a3 ),
			gap: num( 'gap', preset.gap ),
			dir2: dir( 'dir2', preset.dir2 ),
			dir3: dir( 'dir3', preset.dir3 ),
			pulse: pulse(),
			dots: Math.max( 0, Math.floor( num( 'dots', preset.dots ) ) ),
		};
	}

	private _buildSvg(): string {
		const cfg = this._effectiveConfig();
		const label = escAttr( this.getAttribute( 'label' ) ?? 'Loading' );

		const pad = cfg.gap * 3 + 14;
		const vbMin = -pad;
		const vbSize = 122.52 + pad * 2;

		const r1 = DISC_R + cfg.gap + 2;
		const r2 = r1 + cfg.gap + 2;
		const r3 = r2 + cfg.gap + 1.5;

		const ring1Anim = `animation: wpd-spinner-spin ${ ( cfg.sp1 / 10 ).toFixed( 2 ) }s linear infinite`;
		const ring2Anim = `animation: wpd-spinner-spin ${ ( cfg.sp2 / 10 ).toFixed( 2 ) }s linear infinite${
			cfg.dir2 < 0 ? ' reverse' : ''
		}`;
		const ring3Anim = `animation: wpd-spinner-spin ${ ( cfg.sp3 / 10 ).toFixed( 2 ) }s linear infinite${
			cfg.dir3 < 0 ? ' reverse' : ''
		}`;

		// Pulse durations scale with ring 1 so a fast spinner pulses
		// fast and a slow one breathes — matches the prototype's feel.
		const pspd = ( ( cfg.sp1 * 1.8 ) / 10 ).toFixed( 1 );
		const ospd = ( ( cfg.sp1 * 2.3 ) / 10 ).toFixed( 1 );
		let pulseStyle = '';
		if ( cfg.pulse === 'scale' ) {
			pulseStyle = `animation: wpd-spinner-scale ${ pspd }s ease-in-out infinite`;
		} else if ( cfg.pulse === 'opacity' ) {
			pulseStyle = `animation: wpd-spinner-opacity ${ ospd }s ease-in-out infinite`;
		} else if ( cfg.pulse === 'both' ) {
			pulseStyle = `animation: wpd-spinner-scale ${ pspd }s ease-in-out infinite, wpd-spinner-opacity ${ ospd }s ease-in-out infinite`;
		}

		// Trailing dots — equally-spaced points on a fourth ring,
		// rotated together with ring 1's tempo so they read as a tail.
		let dotEls = '';
		if ( cfg.dots > 0 ) {
			const dr = r3 + cfg.gap + 1;
			const dc2 = 2 * Math.PI * dr;
			const dsz = 1.6;
			const dotDur = ( ( cfg.sp1 * 0.65 ) / 10 ).toFixed( 2 );
			for ( let i = 0; i < cfg.dots; i++ ) {
				const offset = -( i / cfg.dots ) * dc2;
				dotEls +=
					`<circle cx="${ CX }" cy="${ CY }" r="${ dr.toFixed( 2 ) }"` +
					` fill="none" stroke="currentColor" stroke-width="${ dsz }"` +
					` stroke-dasharray="${ dsz.toFixed( 2 ) } ${ ( dc2 - dsz ).toFixed( 2 ) }"` +
					` stroke-dashoffset="${ offset.toFixed( 2 ) }"` +
					` stroke-linecap="round" stroke-opacity="0.65"` +
					` style="transform-origin:${ CX }px ${ CY }px;animation: wpd-spinner-spin ${ dotDur }s linear infinite"/>`;
			}
		}

		return (
			`<svg xmlns="http://www.w3.org/2000/svg"` +
			` viewBox="${ vbMin } ${ vbMin } ${ vbSize } ${ vbSize }"` +
			` role="img" aria-label="${ label }">` +
			`<g style="transform-origin:${ CX }px ${ CY }px${ pulseStyle ? ';' + pulseStyle : '' }">` +
			`<circle cx="${ CX }" cy="${ CY }" r="${ DISC_R }" fill="currentColor"/>` +
			`<g class="mark">${ W_PATHS }</g>` +
			`</g>` +
			// Ring 1 — anchor track + active arc.
			`<circle cx="${ CX }" cy="${ CY }" r="${ r1.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="0.6" stroke-opacity="0.2"/>` +
			`<circle cx="${ CX }" cy="${ CY }" r="${ r1.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="2.2"` +
			` stroke-dasharray="${ dasharray( r1, cfg.a1 ) }"` +
			` stroke-linecap="round"` +
			` style="transform-origin:${ CX }px ${ CY }px;${ ring1Anim }"/>` +
			// Ring 2.
			`<circle cx="${ CX }" cy="${ CY }" r="${ r2.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="0.5" stroke-opacity="0.15"/>` +
			`<circle cx="${ CX }" cy="${ CY }" r="${ r2.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.8"` +
			` stroke-dasharray="${ dasharray( r2, cfg.a2 ) }"` +
			` stroke-linecap="round"` +
			` style="transform-origin:${ CX }px ${ CY }px;${ ring2Anim }"/>` +
			// Ring 3.
			`<circle cx="${ CX }" cy="${ CY }" r="${ r3.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="0.4" stroke-opacity="0.12"/>` +
			`<circle cx="${ CX }" cy="${ CY }" r="${ r3.toFixed( 2 ) }"` +
			` fill="none" stroke="currentColor" stroke-width="1.0" stroke-opacity="0.6"` +
			` stroke-dasharray="${ dasharray( r3, cfg.a3 ) }"` +
			` stroke-linecap="round"` +
			` style="transform-origin:${ CX }px ${ CY }px;${ ring3Anim }"/>` +
			dotEls +
			`</svg>`
		);
	}
}

/**
 * Compute the `stroke-dasharray` pair (visible, gap) that draws an
 * arc covering `pct`% of a circle of radius `r`.
 */
function dasharray( r: number, pct: number ): string {
	const c = 2 * Math.PI * r;
	const visible = ( pct / 100 ) * c;
	const gap = c - visible;
	return `${ visible.toFixed( 2 ) } ${ gap.toFixed( 2 ) }`;
}

/**
 * Minimal HTML attribute escape for user-provided strings (color
 * values, the aria-label). We never accept arbitrary markup, but
 * setting `innerHTML` from `aria-label` content makes belt-and-braces
 * escaping cheap insurance.
 */
function escAttr( s: string ): string {
	return String( s )
		.replace( /&/g, '&amp;' )
		.replace( /"/g, '&quot;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

defineComponent( 'wpd-spinner', WpdSpinner );
