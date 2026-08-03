/**
 * `<os-spinner>` — animated WordPress-mark loading indicator.
 *
 * Drop-in:
 *
 * ```html
 * <os-spinner></os-spinner>                              <!-- classic, 48px, WP blue -->
 * <os-spinner preset="comet" size="80"></os-spinner>
 * <os-spinner preset="orbit" color="#0f4c6b"></os-spinner>
 * <os-spinner preset="pulse" accent="#fff8e7"></os-spinner>
 * <os-spinner preset="inline"></os-spinner>              <!-- 16px arc, no mark -->
 * ```
 *
 * ## Presets
 *
 * Five curated looks. Pick one with the `preset` attribute; every
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
 *   - `inline` — a different indicator entirely, not a re-tuning of
 *     the other four: ONE track ring with ONE rotating arc, no
 *     WordPress mark, no concentric rings, no dots. The mark and its
 *     three rings need roughly 40px to be recognisable; below that
 *     they collapse into a smudge. Use `inline` for anything that
 *     sits next to a line of text — a button, a list row, a status
 *     line. It defaults to 16px rather than 48px, and inherits
 *     `currentColor` rather than the admin theme color, so it tints
 *     itself from the text it sits beside.
 *
 * Override anything from the preset:
 *
 * ```html
 * <os-spinner preset="comet" sp1="6" dots="8"></os-spinner>
 * ```
 *
 * ## Color model
 *
 * Two colors are driven by CSS custom properties — set them via the
 * `color` / `accent` attributes (string shortcuts) or via CSS
 * directly. The accent (the W mark inside the disc) follows the
 * station's accent and falls back to white, and is fully configurable
 * so a dark-on-light mark works the same way as the canonical
 * white-on-blue.
 *
 *   - `--os-ui-spinner-color` — disc + ring + dot color. Default:
 *     `var( --wp-admin-theme-color, #21759b )`.
 *   - `--os-ui-spinner-accent` — W-mark color. Default:
 *     `var( --os-ui-accent, #fff )`.
 *   - `--os-ui-spinner-size` — host width/height. Default: `48px`.
 *     The shorthand `size` attribute writes a px value here.
 *
 * ## Reduced motion
 *
 * `prefers-reduced-motion: reduce` disables every animation inside
 * the SVG. The mark + rings still render statically.
 */

import { Component, defineComponent, html, type TemplateResult } from '../../core';
import { styles } from './os-spinner.styles';

export type OsSpinnerPreset =
	| 'classic'
	| 'comet'
	| 'orbit'
	| 'pulse'
	| 'inline';

export type OsSpinnerPulse = 'none' | 'scale' | 'opacity' | 'both';

/**
 * Numeric configuration shape mirrored from the prototype. `sp*`
 * values are deciseconds (sp1=12 → 1.2s); arcs are 0–100 percent
 * of the ring's circumference. `dir2` / `dir3` flip ring direction;
 * ring 1 is always clockwise (the "anchor" ring).
 */
export interface OsSpinnerConfig {
	sp1: number;
	sp2: number;
	sp3: number;
	a1: number;
	a2: number;
	a3: number;
	gap: number;
	dir2: 1 | -1;
	dir3: 1 | -1;
	pulse: OsSpinnerPulse;
	dots: number;
}

/**
 * The four curated presets. Tuned so each reads as a distinct
 * "personality" at any size — classic is the canonical WP loader,
 * the other three each emphasise a different visual idea
 * (trails / orbit / pulse).
 */
export const OS_SPINNER_PRESETS: Readonly<
	Record< OsSpinnerPreset, Readonly< OsSpinnerConfig > >
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
	/*
	 * `inline` renders through a separate path, so most of these
	 * fields are inert — only `sp1` (rotation tempo) and `a1` (arc
	 * length as a percentage of the ring) are read. They are spelled
	 * out anyway so the record stays a complete, iterable
	 * `Record< OsSpinnerPreset, OsSpinnerConfig >` for preset-picker
	 * UIs, and so `sp1` / `a1` remain overridable per element exactly
	 * like every other preset.
	 */
	inline: {
		sp1: 8,
		sp2: 8,
		sp3: 8,
		a1: 25,
		a2: 25,
		a3: 25,
		gap: 0,
		dir2: 1,
		dir3: 1,
		pulse: 'none',
		dots: 0,
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
 * original SVG. Drawn over the disc using `--os-ui-spinner-accent`
 * (white by default) so the same paths work on any disc color.
 */
const W_PATHS =
	'<path d="m8.708 61.26c0 20.802 12.089 38.779 29.619 47.298l-25.069-68.686c-2.916 6.536-4.55 13.769-4.55 21.388z"/>' +
	'<path d="m96.74 58.608c0-6.495-2.333-10.993-4.334-14.494-2.664-4.329-5.161-7.995-5.161-12.324 0-4.831 3.664-9.328 8.825-9.328.233 0 .454.029.681.042-9.35-8.566-21.807-13.796-35.489-13.796-18.36 0-34.513 9.42-43.91 23.688 1.233.037 2.395.063 3.382.063 5.497 0 14.006-.667 14.006-.667 2.833-.167 3.167 3.994.337 4.329 0 0-2.847.335-6.015.501l19.138 56.925 11.501-34.493-8.188-22.434c-2.83-.166-5.511-.501-5.511-.501-2.832-.166-2.5-4.496.332-4.329 0 0 8.679.667 13.843.667 5.496 0 14.006-.667 14.006-.667 2.835-.167 3.168 3.994.337 4.329 0 0-2.853.335-6.015.501l18.992 56.494 5.242-17.517c2.272-7.269 4.001-12.49 4.001-16.989z"/>' +
	'<path d="m62.184 65.857-15.768 45.819c4.708 1.384 9.687 2.141 14.846 2.141 6.12 0 11.989-1.058 17.452-2.979-.141-.225-.269-.464-.374-.724z"/>' +
	'<path d="m107.376 36.046c.226 1.674.354 3.471.354 5.404 0 5.333-.996 11.328-3.996 18.824l-16.053 46.413c15.624-9.111 26.133-26.038 26.133-45.426.001-9.137-2.333-17.729-6.438-25.215z"/>';

export class OsSpinner extends Component {
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
			'Animated WordPress-mark loading indicator with five curated presets and full per-attribute overrides. The `inline` preset swaps the mark for a bare arc sized for text-adjacent use. CSS variables drive disc + accent colors and size; reduced-motion preferences are respected.',
		status: 'experimental',
		since: '0.6.0',
		props: [
			{
				name: 'preset',
				type: '"classic" | "comet" | "orbit" | "pulse" | "inline"',
				default: 'classic',
				description:
					'Visual personality. Every other attribute defaults to the preset\'s value and can be overridden individually. `inline` is the odd one out: a bare rotating arc with no WordPress mark, defaulting to 16px and to `currentColor`, for use beside a line of text where the mark would be illegible.',
			},
			{
				name: 'size',
				type: 'integer (px) or CSS length',
				default: '48 (16 for preset="inline")',
				description:
					'Sets `--os-ui-spinner-size`. Bare numbers are treated as px; pass a CSS length (e.g. `2em`) to opt into ems / rems.',
			},
			{
				name: 'color',
				type: 'CSS color',
				description:
					'Disc + ring + dot color. Sets `--os-ui-spinner-color`. Default inherits the WP admin theme color.',
			},
			{
				name: 'accent',
				type: 'CSS color',
				default: '#fff',
				description:
					'Color of the W mark inside the disc. Sets `--os-ui-spinner-accent`. Default white — change for dark-on-light or themed marks.',
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
			{ name: '--os-ui-spinner-color', default: 'var(--wp-admin-theme-color, #21759b)' },
			{
				name: '--os-ui-spinner-accent',
				default: 'var(--os-ui-accent, #fff)',
			},
			{ name: '--os-ui-spinner-size', default: '48px' },
		],
		example: html`<os-spinner preset="comet" size="80"></os-spinner>`,
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
		sync( 'color', '--os-ui-spinner-color' );
		sync( 'accent', '--os-ui-spinner-accent' );
		sync( 'size', '--os-ui-spinner-size', ( v ) =>
			/^-?\d+(\.\d+)?$/.test( v.trim() ) ? `${ v }px` : v,
		);
	}

	private _effectiveConfig(): OsSpinnerConfig {
		const presetName = this.getAttribute( 'preset' ) ?? 'classic';
		const preset =
			OS_SPINNER_PRESETS[ presetName as OsSpinnerPreset ] ??
			OS_SPINNER_PRESETS.classic;

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
		const pulse = (): OsSpinnerPulse => {
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

	/**
	 * The `inline` indicator: one faint track ring, one rotating arc.
	 *
	 * Deliberately not the mark-and-rings SVG at a smaller size. That
	 * artwork carries four concentric strokes plus a 4-path glyph in a
	 * ~150-unit viewBox; at 16px each stroke lands under a physical
	 * pixel and the whole thing greys out into an unreadable blob. A
	 * single 2.4-unit stroke on a 24-unit viewBox stays crisp at 14px
	 * and still reads as motion at a glance.
	 *
	 * `currentColor` rather than `--os-ui-spinner-color` is the point of
	 * the preset — an inline spinner belongs to the text it interrupts,
	 * so it tints itself from that text and can never lose contrast
	 * against a surface the component knows nothing about.
	 */
	private _buildInlineSvg( cfg: OsSpinnerConfig ): string {
		const label = escAttr( this.getAttribute( 'label' ) ?? 'Loading' );
		const r = 9;
		const dur = ( cfg.sp1 / 10 ).toFixed( 2 );

		return (
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"` +
			` role="img" aria-label="${ label }">` +
			// Track — the full circle, faint, so the arc reads as
			// progress around something rather than a floating dash.
			`<circle cx="12" cy="12" r="${ r }" fill="none"` +
			` stroke="currentColor" stroke-width="2.4" stroke-opacity="0.22"/>` +
			// Arc.
			`<circle cx="12" cy="12" r="${ r }" fill="none"` +
			` stroke="currentColor" stroke-width="2.4" stroke-linecap="round"` +
			` stroke-dasharray="${ dasharray( r, cfg.a1 ) }"` +
			` style="transform-origin:12px 12px;animation: os-spinner-spin ${ dur }s linear infinite"/>` +
			`</svg>`
		);
	}

	private _buildSvg(): string {
		const cfg = this._effectiveConfig();

		if ( this.getAttribute( 'preset' ) === 'inline' ) {
			return this._buildInlineSvg( cfg );
		}

		const label = escAttr( this.getAttribute( 'label' ) ?? 'Loading' );

		const pad = cfg.gap * 3 + 14;
		const vbMin = -pad;
		const vbSize = 122.52 + pad * 2;

		const r1 = DISC_R + cfg.gap + 2;
		const r2 = r1 + cfg.gap + 2;
		const r3 = r2 + cfg.gap + 1.5;

		const ring1Anim = `animation: os-spinner-spin ${ ( cfg.sp1 / 10 ).toFixed( 2 ) }s linear infinite`;
		const ring2Anim = `animation: os-spinner-spin ${ ( cfg.sp2 / 10 ).toFixed( 2 ) }s linear infinite${
			cfg.dir2 < 0 ? ' reverse' : ''
		}`;
		const ring3Anim = `animation: os-spinner-spin ${ ( cfg.sp3 / 10 ).toFixed( 2 ) }s linear infinite${
			cfg.dir3 < 0 ? ' reverse' : ''
		}`;

		// Pulse durations scale with ring 1 so a fast spinner pulses
		// fast and a slow one breathes — matches the prototype's feel.
		const pspd = ( ( cfg.sp1 * 1.8 ) / 10 ).toFixed( 1 );
		const ospd = ( ( cfg.sp1 * 2.3 ) / 10 ).toFixed( 1 );
		let pulseStyle = '';
		if ( cfg.pulse === 'scale' ) {
			pulseStyle = `animation: os-spinner-scale ${ pspd }s ease-in-out infinite`;
		} else if ( cfg.pulse === 'opacity' ) {
			pulseStyle = `animation: os-spinner-opacity ${ ospd }s ease-in-out infinite`;
		} else if ( cfg.pulse === 'both' ) {
			pulseStyle = `animation: os-spinner-scale ${ pspd }s ease-in-out infinite, os-spinner-opacity ${ ospd }s ease-in-out infinite`;
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
					` style="transform-origin:${ CX }px ${ CY }px;animation: os-spinner-spin ${ dotDur }s linear infinite"/>`;
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

defineComponent( 'os-spinner', OsSpinner );
