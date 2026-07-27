/**
 * Desktop Mode — Canvas stage types.
 *
 * The "stage" is the whole desktop shell mirrored into a
 * `<canvas layoutsubtree>` through the experimental HTML-in-Canvas
 * browser API, so fragment shaders can post-process every pixel of the
 * desktop at once. A "screen effect" is one shader in that chain —
 * scanlines, a CRT tube, pixel-art quantization.
 *
 * The shell stays real, live DOM inside the canvas: it is laid out,
 * hit-tested and exposed to the accessibility tree exactly as before.
 * Only its *pixels* take the detour through the GPU. That is what keeps
 * iframe windows, text inputs, links and focus working untouched.
 *
 * An effect def is deliberately thin: it builds a Pixi `Filter` and
 * (optionally) refreshes it when a parameter changes or a frame ticks.
 * The stage owns *when* filters run and in what order; the def owns
 * *what* the shader does — the same division of labour the unfocus
 * effects use (see `src/effects/types.ts`).
 *
 * @since 0.9.8
 */

import type { Filter } from 'pixi.js';

/**
 * A user-tunable knob on an effect, rendered as a slider in
 * OS Settings → Experimental. Values are always plain numbers so the
 * whole selection round-trips through user meta as simple JSON.
 */
export interface ScreenEffectParam {
	/** Key the value is stored under. Matches `/^[a-zA-Z0-9_]+$/`. */
	key: string;
	/** Human-readable label for the slider. */
	label: string;
	/** Inclusive lower bound. Values below are clamped up. */
	min: number;
	/** Inclusive upper bound. Values above are clamped down. */
	max: number;
	/** Slider granularity. */
	step: number;
	/** Value used when the user has not set one (or set a broken one). */
	default: number;
	/** Optional unit suffix shown after the value (`'px'`, `'%'`). */
	suffix?: string;
}

/**
 * Everything an effect needs to build or refresh its filter. Handed to
 * `createFilter`, `update` and `tick`; never held onto by the stage
 * between frames, so treat it as read-only.
 */
export interface ScreenEffectContext {
	/**
	 * The vendor-loaded Pixi namespace (`window.PIXI`). Effects read
	 * `Filter`, `GlProgram` and `UniformGroup` off this rather than
	 * importing `pixi.js`, because Pixi ships as a runtime global.
	 */
	pixi: typeof import( 'pixi.js' );
	/**
	 * Current parameter values, already clamped to each param's
	 * `min`/`max` with missing entries filled from `default`. Every key
	 * declared in `params` is guaranteed present.
	 */
	params: Readonly< Record< string, number > >;
	/** Stage size in CSS pixels. */
	screen: { width: number; height: number };
	/** Device pixel ratio the stage renders at. */
	resolution: number;
	/**
	 * Whether the user has asked for reduced motion
	 * (`prefers-reduced-motion: reduce`).
	 *
	 * The stage does NOT silently suppress your animation — it reports
	 * the preference and leaves the decision to the effect, the same way
	 * the rest of the framework hands apps state rather than policy. Do
	 * honour it: a full-screen shader that pulses or scrolls is exactly
	 * the kind of motion the setting exists for, and at some rates
	 * brightness flicker is a photosensitivity risk, not a taste
	 * question.
	 */
	reducedMotion: boolean;
}

/**
 * A screen effect: one fragment shader in the desktop's post-processing
 * chain. Register with `wp.desktop.stage.registerScreenEffect()`.
 */
export interface ScreenEffectDef {
	/**
	 * Unique id matching `/^[a-z0-9_/-]+$/` — lower-case alphanum plus
	 * hyphen, underscore and slash so plugins can namespace
	 * `vendor/sub-id`, the convention every other JS registry uses.
	 */
	id: string;
	/** Human-readable label shown in OS Settings → Experimental. */
	label: string;
	/** Optional one-line description shown under the toggle. */
	description?: string;
	/**
	 * Chain position — lower numbers run first, so their output feeds
	 * the next effect. Defaults to 100. Keep geometry-changing effects
	 * (pixelation, curvature) early and overlays (scanlines, vignette)
	 * late, or the overlay gets pixelated too.
	 */
	order?: number;
	/** Sliders exposed in OS Settings. Omit for a parameter-less effect. */
	params?: ScreenEffectParam[];
	/**
	 * Build the Pixi filter. Called once when the effect enters the
	 * chain, and again after a stage restart (resolution change, canvas
	 * re-creation). Throwing here drops just this effect — the rest of
	 * the chain still renders.
	 */
	createFilter( ctx: ScreenEffectContext ): Filter;
	/**
	 * Push changed parameter values into an existing filter. Called on
	 * every slider drag. Implement this and parameter changes stay
	 * cheap; omit it and the stage rebuilds the filter instead.
	 */
	update?( filter: Filter, ctx: ScreenEffectContext ): void;
	/**
	 * Per-frame hook for time-driven effects (rolling scanlines, tube
	 * flicker). `elapsed` is seconds since the effect entered the chain.
	 * Omit for static effects — the stage skips the call entirely.
	 */
	tick?( filter: Filter, elapsed: number, ctx: ScreenEffectContext ): void;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * effect. Set it when plugin deactivation should live-unregister the
	 * effect; effects without an owner survive until the next reload.
	 */
	owner?: string;
}

/**
 * One entry in the user's saved chain: an effect id plus the parameter
 * values they dialled in. This is the shape persisted in the
 * `screenEffects` OS setting.
 */
export interface ScreenEffectSelection {
	id: string;
	params?: Record< string, number >;
}

/**
 * A selection matched against a registered def, with parameters
 * validated and defaults filled in. Produced by `resolveEffectChain()`.
 */
export interface ResolvedScreenEffect {
	def: ScreenEffectDef;
	params: Record< string, number >;
}
