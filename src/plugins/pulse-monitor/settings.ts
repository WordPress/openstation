/**
 * Pulse Monitor — user-tunable settings.
 *
 * Values persist through the shell's per-wallpaper settings surface
 * (`ctx.settings` / `ctx.setSettings`), which only round-trips scalars
 * and caps each wallpaper at 32 keys — so the per-source on/off
 * switches travel as ONE comma-separated `muted` string rather than
 * nineteen booleans. {@link sanitizePulseSettings} clamps every field
 * back into range and falls back to the defaults for anything missing
 * or malformed.
 */

import { SOURCE_IDS, type SourceId } from './sources';

export type PulseStyle = 'sweep' | 'scroll';

/**
 * `full`: the trace runs across the whole wallpaper, under the desk.
 * `band`: the shell reserves a strip along the top for the trace and
 * its numbers; no window, icon or widget can be placed there.
 */
export type PulseLayout = 'full' | 'band';

export interface PulseSettings {
	/** `sweep`: a write head crosses the screen and wraps. `scroll`: the trace flows left. */
	style: PulseStyle;
	/** Whole wallpaper, or a reserved band along the top (wallpaper only). */
	layout: PulseLayout;
	/** Height of the reserved band, CSS px. */
	bandHeight: number;
	/** Trace colour (hex). */
	lineColor: string;
	/** Backdrop colour (hex). */
	background: string;
	/** Colour of failed (ectopic) beats and the alarm readout (hex). */
	errorColor: string;
	/** Horizontal speed of the trace, CSS px per second. */
	speed: number;
	/** Beat height multiplier. */
	intensity: number;
	/** Trace stroke width, CSS px. */
	lineWidth: number;
	/** Phosphor glow strength, 0–1. */
	glow: number;
	/** Baseline height as a percentage of the desk, from the top. */
	baseline: number;
	/** Faint ghost traces above and below the main one. */
	echoes: number;
	/** ECG paper grid behind the trace. */
	grid: boolean;
	/** Requests/min, ping, errors and visits/min in the corner. */
	readout: boolean;
	/** Print what caused each spike ("request", "visit", …) above it. */
	labels: boolean;
	/** A short beep on every full beat, and the alarm when the site goes down. */
	sound: boolean;
	/**
	 * Resting heart rate (beats per minute) the trace keeps when the
	 * site is quiet. Activity beats reset it like a pacemaker would.
	 */
	restingBpm: number;
	/** Read the site's health into the rhythm. */
	diagnose: boolean;
	/** Sources the user switched off. */
	muted: SourceId[];
}

export const PULSE_DEFAULTS: PulseSettings = {
	style: 'sweep',
	layout: 'full',
	bandHeight: 88,
	lineColor: '#ff2a2a',
	background: '#000000',
	errorColor: '#ffb020',
	speed: 220,
	intensity: 1,
	lineWidth: 2,
	glow: 0.6,
	baseline: 58,
	echoes: 10,
	grid: false,
	readout: true,
	labels: true,
	sound: false,
	restingBpm: 62,
	diagnose: true,
	muted: [],
};

/** Slider bounds for the config dialog — also the sanitizer clamps. */
export const PULSE_LIMITS = {
	bandHeight: { min: 56, max: 300 },
	speed: { min: 60, max: 600 },
	intensity: { min: 0.3, max: 2 },
	lineWidth: { min: 1, max: 6 },
	glow: { min: 0, max: 1 },
	baseline: { min: 20, max: 80 },
	echoes: { min: 0, max: 24 },
	restingBpm: { min: 0, max: 120 },
} as const;

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

function hex( value: unknown, fallback: string ): string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test( value )
		? value.toLowerCase()
		: fallback;
}

function bool( value: unknown, fallback: boolean ): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

/** Parse the persisted `muted` string (or array) into known source ids. */
export function parseMuted( value: unknown ): SourceId[] {
	let parts: unknown[] = [];
	if ( typeof value === 'string' ) {
		parts = value.split( ',' );
	} else if ( Array.isArray( value ) ) {
		parts = value;
	}
	const known = new Set< string >( SOURCE_IDS );
	const out = new Set< SourceId >();
	for ( const part of parts ) {
		const id = String( part ).trim();
		if ( known.has( id ) ) {
			out.add( id as SourceId );
		}
	}
	return [ ...out ];
}

/** Serialise a muted list for `ctx.setSettings`. */
export function serializeMuted( muted: readonly SourceId[] ): string {
	return muted.join( ',' );
}

/**
 * Coerce an untrusted settings bag into a fully populated
 * {@link PulseSettings}.
 */
export function sanitizePulseSettings(
	raw: Record< string, unknown > | undefined,
): PulseSettings {
	const bag = raw ?? {};
	const d = PULSE_DEFAULTS;
	return {
		style: bag.style === 'scroll' || bag.style === 'sweep' ? bag.style : d.style,
		layout: bag.layout === 'band' || bag.layout === 'full' ? bag.layout : d.layout,
		bandHeight: Math.round( clampNumber( bag.bandHeight, PULSE_LIMITS.bandHeight, d.bandHeight ) ),
		lineColor: hex( bag.lineColor, d.lineColor ),
		background: hex( bag.background, d.background ),
		errorColor: hex( bag.errorColor, d.errorColor ),
		speed: clampNumber( bag.speed, PULSE_LIMITS.speed, d.speed ),
		intensity: clampNumber( bag.intensity, PULSE_LIMITS.intensity, d.intensity ),
		lineWidth: clampNumber( bag.lineWidth, PULSE_LIMITS.lineWidth, d.lineWidth ),
		glow: clampNumber( bag.glow, PULSE_LIMITS.glow, d.glow ),
		baseline: clampNumber( bag.baseline, PULSE_LIMITS.baseline, d.baseline ),
		echoes: Math.round( clampNumber( bag.echoes, PULSE_LIMITS.echoes, d.echoes ) ),
		grid: bool( bag.grid, d.grid ),
		readout: bool( bag.readout, d.readout ),
		labels: bool( bag.labels, d.labels ),
		sound: bool( bag.sound, d.sound ),
		restingBpm: Math.round( clampNumber( bag.restingBpm, PULSE_LIMITS.restingBpm, d.restingBpm ) ),
		diagnose: bool( bag.diagnose, d.diagnose ),
		muted: bag.muted === undefined ? [ ...d.muted ] : parseMuted( bag.muted ),
	};
}

/** `#rrggbb` → `0xrrggbb` for Pixi. */
export function hexToNumber( value: string ): number {
	return parseInt( value.slice( 1 ), 16 );
}
