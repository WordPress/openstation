/**
 * Desktop Mode — Window transition effect types.
 *
 * A "window effect" animates a single window through a lifecycle
 * transition — opening, closing, minimising, maximising, gaining or
 * losing focus — as a PixiJS object on the canvas stage.
 *
 * **How a window becomes a Pixi object.** Not by reparenting it into
 * the canvas: `HTMLSource` requires its element to be a direct child,
 * so moving windows there would reload every iframe and break the
 * window manager's layout, z-order and snapping. Instead the stage
 * already holds a live texture of the entire shell, windows included,
 * so the engine freezes the window's rectangle out of that texture
 * (`renderer.generateTexture()`), hides the real element, and hands the
 * effect a sprite of those frozen pixels to animate. PixiJS documents
 * this exact pattern for "shatter"-style effects.
 *
 * The engine owns capture, positioning, cleanup and timing. A def owns
 * only the animation — which is why the built-in dissolve is about
 * eighty lines rather than a subsystem.
 *
 * @since 0.9.8
 */

import type { Container, Sprite, Texture, Ticker } from 'pixi.js';
import type { ScreenEffectParam } from '../types';

/** A point in a window's lifecycle that an effect can animate. */
export type WindowTransition =
	| 'open'
	| 'close'
	| 'minimize'
	| 'restore'
	| 'maximize'
	| 'unmaximize'
	| 'focus'
	| 'blur';

/** Every transition, in the order the settings panel lists them. */
export const WINDOW_TRANSITIONS: readonly WindowTransition[] = [
	'open',
	'close',
	'minimize',
	'restore',
	'maximize',
	'unmaximize',
	'focus',
	'blur',
];

/** Reserved id meaning "no effect for this transition". */
export const WINDOW_EFFECT_NONE = 'none';

/** A rectangle in CSS pixels, relative to the stage canvas. */
export interface StageRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Everything an effect needs to animate one transition. The engine has
 * already frozen the window's pixels and mounted a sprite for them; the
 * effect's whole job is to move that sprite and resolve when done.
 */
export interface WindowEffectRunContext {
	/** The vendor-loaded Pixi namespace. */
	pixi: typeof import( 'pixi.js' );
	/** Which transition is playing. */
	transition: WindowTransition;
	/** Parameter values, clamped and defaulted — never needs validating. */
	params: Readonly< Record< string, number > >;
	/**
	 * The window's frozen pixels, already mounted at its on-screen
	 * position. Move, scale, tint or replace it freely; the engine
	 * destroys it afterwards.
	 */
	sprite: Sprite;
	/** The same pixels as a texture, for effects that build their own display objects. */
	texture: Texture;
	/**
	 * Overlay container the sprite lives in, above the desktop. Add
	 * particle containers or extra sprites here — anything left behind
	 * is removed when the effect finishes.
	 */
	layer: Container;
	/** Where the window is, in CSS pixels relative to the stage. */
	from: StageRect;
	/**
	 * Where the window is heading, when that is known: the dock tile for
	 * a minimise, the new geometry for a maximise. Absent for
	 * transitions with no destination (focus, blur, close).
	 */
	to?: StageRect;
	/** The stage's ticker, for frame-driven animation. */
	ticker: Ticker;
	/**
	 * Aborts when the effect must stop early — the window was destroyed,
	 * the stage was switched off, or a newer transition superseded this
	 * one. Check it in your loop and resolve promptly; the engine cleans
	 * up regardless, but a runaway loop wastes frames.
	 */
	signal: AbortSignal;
}

/**
 * A window transition effect. Register with
 * `wp.desktop.stage.registerWindowEffect()`.
 */
export interface WindowEffectDef {
	/** Unique id matching `/^[a-z0-9_/-]+$/`. `none` is reserved. */
	id: string;
	/** Human-readable label shown in OS Settings → Experimental. */
	label: string;
	/** Optional one-line description shown under the picker. */
	description?: string;
	/**
	 * Transitions this effect can play. It is only offered for these in
	 * the settings UI — a dissolve makes sense on close and nowhere
	 * else, and offering it everywhere just invites disappointment.
	 */
	transitions: readonly WindowTransition[];
	/** Sliders exposed in OS Settings. */
	params?: ScreenEffectParam[];
	/**
	 * How long the effect runs, in milliseconds. Used to size the close
	 * gate's safety net, so be honest: a `run()` that outlives this gets
	 * cut short on close. Defaults to 400.
	 */
	durationMs?( params: Readonly< Record< string, number > > ): number;
	/**
	 * Animate. Resolve when finished — for `close`, the window is not
	 * torn down until this settles (or its duration elapses).
	 *
	 * Throwing or rejecting is safe: the engine cleans up and the
	 * transition completes normally, so a broken effect degrades to no
	 * effect rather than a stuck window.
	 */
	run( ctx: WindowEffectRunContext ): Promise< void > | void;
	/**
	 * Owner tag — the WordPress script handle that registered the
	 * effect, for live unregistration on plugin deactivation.
	 */
	owner?: string;
}

/** The user's per-transition choice, persisted in OS settings. */
export interface WindowEffectSelection {
	/** Effect id, or `'none'`. */
	id: string;
	params?: Record< string, number >;
}
