/**
 * Desktop Mode — Window transition effect types.
 *
 * A "window effect" animates a single window through a lifecycle
 * transition — opening, closing, minimising, maximising, gaining or
 * losing focus — as a PixiJS object on the canvas stage.
 *
 * **How a window becomes a Pixi object** — one of two ways, chosen by
 * the engine per transition:
 *
 * - **Live** (`drag`, `open`): the element is promoted to a direct
 *   child of the stage canvas with `Node.moveBefore()` — atomic and
 *   state-preserving, so iframes do not reload — and `HTMLSource`
 *   re-uploads it into `ctx.texture` on every canvas paint. The pixels
 *   the effect deforms are alive: video keeps playing, keystrokes keep
 *   rendering, all mid-effect. This is the HTML-in-Canvas spec's own
 *   pattern (compare Chrome's "deformable page" demo).
 * - **Frozen** (`close`, `minimize`, `restore`, `maximize`,
 *   `unmaximize`, and the fallback when promotion is not possible):
 *   the stage's desktop texture already contains the window, so the
 *   engine freezes its rectangle out (`renderer.generateTexture()`),
 *   hides the real element, and hands the effect those frozen pixels.
 *   For after-the-fact transitions the staleness is the point — the
 *   snapshot is the only remaining record of the "before" state.
 *
 * Effects need not care which model is active: `ctx.sprite` and
 * `ctx.texture` behave identically, the live texture simply keeps
 * refreshing underneath.
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
	/**
	 * @deprecated Never offered in the UI — see {@link WINDOW_TRANSITIONS}.
	 */
	| 'focus'
	/**
	 * @deprecated Never offered in the UI — see {@link WINDOW_TRANSITIONS}.
	 */
	| 'blur'
	/**
	 * Sustained, not momentary: it begins on drag-start and runs until
	 * drag-end aborts it, rather than for a fixed duration. An effect
	 * claiming it should loop until `ctx.signal` aborts.
	 */
	| 'drag';

/**
 * Every transition the settings panel offers, in order.
 *
 * **Focus and blur are deliberately absent.** They cannot work in this
 * architecture, and the two ways of trying both fail:
 *
 * - Hide the real window and animate the copy — but focus fires
 *   mid-click, so the window vanishes under the pointer and swallows the
 *   click that caused it. You cannot press close or start a drag.
 * - Leave the window visible and animate a copy over it — you see the
 *   window twice, and every single click flashes a ghost.
 *
 * There is no third option: an effect animates a *copy* of the window,
 * and a copy is only ever invisible or duplicated. Transitions where the
 * window is arriving, leaving or already captured by a drag do not have
 * this problem, because hiding the original is exactly right there.
 *
 * Focus styling is already well served by the unfocus-effect system
 * (OS Settings → Effects), which uses cheap CSS filters on the real
 * element and never duplicates anything.
 */
export const WINDOW_TRANSITIONS: readonly WindowTransition[] = [
	'open',
	'close',
	'minimize',
	'restore',
	'maximize',
	'unmaximize',
	'drag',
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
	 * The window's pixels, already mounted at its on-screen position.
	 * Move, scale, tint or replace it freely; the engine destroys it
	 * afterwards. For `drag` and `open` the pixels are LIVE — they keep
	 * re-uploading from the real window every paint; for the other
	 * transitions they are a frozen snapshot.
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
	/**
	 * A drawn copy of the window's CSS drop shadow, sitting behind the
	 * sprite. `null` when the window has no shadow, or for transitions
	 * that end with the window gone.
	 *
	 * Captures are taken from the border box and `box-shadow` paints
	 * outside it, so a stand-in has no shadow of its own; without this
	 * one the shadow snapped into existence the moment the window was
	 * handed back.
	 *
	 * **The engine keeps it aligned to `sprite` for you** — position,
	 * scale, rotation and alpha — right up until you hide the sprite or
	 * fade it to nothing. At that point you have replaced the stand-in
	 * with something of your own, the engine stops tracking, and the
	 * shadow is yours to move and fade with it. See `cloth.ts` and
	 * `reconstruct.ts` for the two shapes that takes.
	 */
	shadow: Container | null;
	/** Where the window is, in CSS pixels relative to the stage. */
	from: StageRect;
	/**
	 * The real window element, still in the DOM and still being moved by
	 * the window manager. Sustained effects read its live position each
	 * frame to follow a drag; momentary ones rarely need it. Do not
	 * restyle it — the engine owns its visibility, its transform and,
	 * during live transitions, its place in the DOM.
	 */
	element: HTMLElement;
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
