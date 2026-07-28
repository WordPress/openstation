/**
 * Snow wallpaper — user-tunable settings.
 *
 * Four knobs surface in the wallpaper's config dialog (OS Settings →
 * Wallpaper → "Wallpaper settings"): wind strength, particle count,
 * flake size, and the backdrop colour. Everything else in the
 * simulation stays fixed tuning (see `scene.ts`).
 *
 * Values persist through the shell's per-wallpaper settings surface
 * (`ctx.settings` / `ctx.setSettings`), so they arrive untrusted —
 * {@link sanitizeSnowSettings} clamps every field back to a sane
 * range and falls back to the defaults for anything missing or
 * malformed.
 */

/** Resolved, validated settings the scene consumes. */
export interface SnowSettings {
	/**
	 * Peak horizontal wind (px/s) of the slow global sin sweep.
	 * 0 disables the sweep entirely (per-particle sway remains).
	 */
	wind: number;
	/**
	 * Sprite-pool size — how many flakes can exist at once. Larger =
	 * denser field, heavier frame cost. At saturation the visible rate
	 * of new flakes equals `count / lifetime`, so this (not the spawn
	 * rate) sets the steady-state "actively snowing" feel.
	 */
	particleCount: number;
	/**
	 * Largest flake diameter in CSS px (soft halo included). The
	 * smallest flake is always half this, preserving the field's
	 * near/far depth mix at every size.
	 */
	flakeSize: number;
	/**
	 * Backdrop base colour (hex). The night-sky gradient behind the
	 * canvas is derived from it — see {@link backdropCss}.
	 */
	background: string;
}

/**
 * Defaults — the wallpaper's canonical tuning. The dialog's sliders
 * start here, and {@link sanitizeSnowSettings} falls back here.
 */
export const SNOW_DEFAULTS: SnowSettings = {
	wind: 22,
	particleCount: 660,
	flakeSize: 16,
	background: '#0c1a36',
};

/** Slider bounds for the config dialog — also the sanitizer clamps. */
export const SNOW_LIMITS = {
	wind: { min: 0, max: 80 },
	particleCount: { min: 100, max: 2000 },
	flakeSize: { min: 6, max: 40 },
} as const;

/** Clamp a numeric setting into its limits, defaulting when invalid. */
function clampNumber(
	value: unknown,
	limits: { min: number; max: number },
	fallback: number,
): number {
	if ( typeof value !== 'number' || ! Number.isFinite( value ) ) {
		return fallback;
	}
	return Math.min( limits.max, Math.max( limits.min, value ) );
}

/**
 * Coerce an untrusted settings bag (from `ctx.settings`) into a fully
 * populated {@link SnowSettings}.
 */
export function sanitizeSnowSettings(
	raw: Record< string, unknown > | undefined,
): SnowSettings {
	const bag = raw ?? {};
	return {
		wind: clampNumber( bag.wind, SNOW_LIMITS.wind, SNOW_DEFAULTS.wind ),
		particleCount: Math.round(
			clampNumber(
				bag.particleCount,
				SNOW_LIMITS.particleCount,
				SNOW_DEFAULTS.particleCount,
			),
		),
		flakeSize: clampNumber(
			bag.flakeSize,
			SNOW_LIMITS.flakeSize,
			SNOW_DEFAULTS.flakeSize,
		),
		background:
			typeof bag.background === 'string' &&
			/^#[0-9a-f]{6}$/i.test( bag.background )
				? bag.background.toLowerCase()
				: SNOW_DEFAULTS.background,
	};
}

/**
 * HSL deltas between the backdrop's base colour and its two lighter
 * stops, measured from the canonical midnight gradient
 * (`#0c1a36 → #1d355e @55% → #425d8a @100%`). Applying the deltas to
 * the default base reproduces those stops byte-for-byte; applying
 * them to a user-picked base keeps the same "night sky lightening
 * toward the horizon" relationship — hue drifts slightly, lightness
 * rises, saturation washes out.
 */
const STOP_55_DELTA = { h: -2.1538461538461604, s: -0.10790835181079084, l: 0.11176470588235296 };
const STOP_100_DELTA = { h: -2.5, s: -0.2834224598930483, l: 0.2705882352941177 };

/** Parse `#rrggbb` into HSL (h in degrees, s/l in 0–1). */
function hexToHsl( hex: string ): { h: number; s: number; l: number } {
	const r = parseInt( hex.slice( 1, 3 ), 16 ) / 255;
	const g = parseInt( hex.slice( 3, 5 ), 16 ) / 255;
	const b = parseInt( hex.slice( 5, 7 ), 16 ) / 255;
	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const l = ( max + min ) / 2;
	const d = max - min;
	if ( d === 0 ) {
		return { h: 0, s: 0, l };
	}
	const s = l < 0.5 ? d / ( max + min ) : d / ( 2 - max - min );
	let h;
	if ( max === r ) {
		h = ( g - b ) / d + ( g < b ? 6 : 0 );
	} else if ( max === g ) {
		h = ( b - r ) / d + 2;
	} else {
		h = ( r - g ) / d + 4;
	}
	return { h: h * 60, s, l };
}

/** Convert HSL (h degrees, s/l 0–1, both clamped) back to `#rrggbb`. */
function hslToHex( h: number, s: number, l: number ): string {
	h = ( ( h % 360 ) + 360 ) % 360;
	s = Math.min( 1, Math.max( 0, s ) );
	l = Math.min( 1, Math.max( 0, l ) );
	const c = ( 1 - Math.abs( 2 * l - 1 ) ) * s;
	const x = c * ( 1 - Math.abs( ( ( h / 60 ) % 2 ) - 1 ) );
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if ( h < 60 ) {
		r = c;
		g = x;
	} else if ( h < 120 ) {
		r = x;
		g = c;
	} else if ( h < 180 ) {
		g = c;
		b = x;
	} else if ( h < 240 ) {
		g = x;
		b = c;
	} else if ( h < 300 ) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}
	const channel = ( v: number ): string =>
		Math.round( ( v + m ) * 255 )
			.toString( 16 )
			.padStart( 2, '0' );
	return `#${ channel( r ) }${ channel( g ) }${ channel( b ) }`;
}

/**
 * Build the backdrop CSS gradient from a base colour. Pure CSS — the
 * transparent Pixi canvas overlays it, which is what gives the field
 * its sense of depth.
 *
 * With the default base this returns the canonical
 * `linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)`.
 */
export function backdropCss( background: string ): string {
	const base = hexToHsl( background );
	const mid = hslToHex(
		base.h + STOP_55_DELTA.h,
		base.s + STOP_55_DELTA.s,
		base.l + STOP_55_DELTA.l,
	);
	const bottom = hslToHex(
		base.h + STOP_100_DELTA.h,
		base.s + STOP_100_DELTA.s,
		base.l + STOP_100_DELTA.l,
	);
	return `linear-gradient(180deg, ${ background } 0%, ${ mid } 55%, ${ bottom } 100%)`;
}
