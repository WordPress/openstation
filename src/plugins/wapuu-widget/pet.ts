/**
 * Desktop Mode — Wapuu widget: animation engine.
 *
 * Ported from the original pet demo's `js/wapuu-pet.js` and retyped
 * against `pixi.js` v8. This is *just the pet*, and he stays put: he
 * breathes, blinks, follows the cursor with his eyes, twitches his
 * ears, wags his tail, and dozes off when
 * left alone. Click him for a pet (hearts!).
 *
 * Deliberately removed from the source demo:
 *   - the control dock (wave / spin-ball buttons),
 *   - the stage background (gradient / spotlight / floor),
 *   - grabbing Wapuu and tossing him *inside* the card,
 *   - all horizontal movement (roaming). The whole WIDGET is draggable
 *     instead (framework chrome); Wapuu himself never walks sideways.
 *   - the random idle jump (distracting). The in-place jump remains,
 *     but only on request via the public API (`jump()`).
 *
 * The tail sway is slowed from the source — see the `tailSpd` note —
 * which whipped "ultra fast" when Wapuu got excited.
 *
 * @since 0.19.0
 */

import type { Application, Container, Graphics, Ticker } from 'pixi.js';
import { __ } from '../../i18n';
import type { WapuuParts } from './rig';
import {
	appendChatMessage,
	createAskBalloon,
	createBalloon,
	createTypingIndicator,
	fitBalloon,
	markAskSent,
	refreshChatThread,
	updateChatTail,
} from './balloons';
import type {
	BalloonType,
	TailSide,
	WapuuChatMessage,
	WapuuChatSession,
} from './balloons';

/** What the WordPress ball is currently showing. */
export type BallMode = 'w' | 'question';

/** Where a tap landed on Wapuu. */
export type ClickTarget = 'ball' | 'body' | 'none';

/** Options for {@link PetController.chat}. */
export interface WapuuChatOptions {
	/** Seed thread, OpenAI chat format. */
	messages?: WapuuChatMessage[];
	/** Input placeholder. */
	placeholder?: string;
	/** Called with each message the user sends. */
	onSend?: ( text: string ) => void;
	/** Called once when the chat closes (explicitly or replaced). */
	onClose?: () => void;
}

/** The `pixi.js` module namespace, resolved at runtime from `window.PIXI`. */
type Pixi = typeof import( 'pixi.js' );

/**
 * Handle returned by {@link startWapuuPet}. Pointer input is driven
 * from the DOM (the framework's whole-card chrome overlay owns the
 * drag), so the engine exposes `pet` + pointer feeders rather than
 * wiring PixiJS event listeners itself.
 */
export interface PetController {
	/** Tear down the ticker, timers, observers, and effect children. */
	destroy(): void;
	/** Trigger a pet (hearts + squish). Called on a tap on the widget. */
	pet(): void;
	/** Feed a pointer position (client coords) so the eyes track it. */
	setPointer( clientX: number, clientY: number ): void;
	/** Pointer left the widget — eyes drift back to neutral. */
	clearPointer(): void;
	/**
	 * Pop a comic balloon above Wapuu's head. Replaces any balloon
	 * currently showing. Wakes Wapuu.
	 *
	 * @param text       Short message or an emoji.
	 * @param type       `'speak'` | `'yell'` | `'think'`.
	 * @param durationMs How long to hold before fading (default 2600).
	 */
	say( text: string, type: BalloonType, durationMs?: number ): void;
	/**
	 * Pop a chat-styled balloon — a message thread + an integrated text
	 * box — and wait for a reply. `opts.messages` (OpenAI chat format,
	 * incl. assistant `tool_calls` and `role: 'tool'` results) seeds the
	 * thread; `prompt` is appended as a final assistant message. Stays
	 * open (no auto-dismiss) until the user submits (Enter / send) or
	 * cancels (Escape); a submitted reply is appended to the thread,
	 * then the balloon lingers `durationMs` (default 1800) and fades.
	 * Resolves with the typed text, or `null` if cancelled or replaced.
	 * Keeps Wapuu awake and still (no idle hop / doze) while open.
	 *
	 * @param prompt Question appended to the thread.
	 * @param opts   `messages` seed thread; `durationMs` post-submit
	 *               linger; `placeholder` text.
	 */
	ask(
		prompt: string,
		opts?: {
			durationMs?: number;
			placeholder?: string;
			messages?: WapuuChatMessage[];
		},
	): Promise< string | null >;
	/**
	 * Open a PERSISTENT chat balloon for back-and-forth. Returns a
	 * session handle: each user message arrives via `opts.onSend`, the
	 * caller pushes responses with `session.append(...)`, and the
	 * balloon stays open until `session.close()`. Unlike {@link ask},
	 * the input stays usable across turns and nothing auto-fades.
	 */
	chat( opts?: WapuuChatOptions ): WapuuChatSession;
	/**
	 * Classify where a tap landed: the WordPress BALL (the W/? help
	 * button), Wapuu's BODY, or neither.
	 */
	getClickTarget( clientX: number, clientY: number ): ClickTarget;
	/** What the ball is currently showing (`'w'` or `'question'`). */
	getBallMode(): BallMode;
	/**
	 * Swap the ball between the W logo and the "?" — the current glyph
	 * shrinks away, the other pops in (same painted-on-sphere style).
	 */
	setBallMode( mode: BallMode ): void;
	/**
	 * Hover affordance for the ball button: gently scales the W/? up
	 * while the pointer is over the ball (paired with a pointer cursor)
	 * so it reads as clickable.
	 */
	setBallHover( on: boolean ): void;
	/** Make Wapuu do an in-place jump (squash, arc, land-bounce). */
	jump(): void;
	/** Send Wapuu to sleep (eyes close, slow breath, zZz). */
	sleep(): void;
	/** Wake Wapuu up. */
	wake(): void;
}

/** What Wapuu is doing right now. */
type PetState = 'idle' | 'hop' | 'pet' | 'sleep';

/** Easing functions. */
const E = {
	linear: ( t: number ): number => t,
	outCubic: ( t: number ): number => 1 - Math.pow( 1 - t, 3 ),
	outBack: ( t: number ): number => {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * Math.pow( t - 1, 3 ) + c1 * Math.pow( t - 1, 2 );
	},
	outElastic: ( t: number ): number => {
		if ( t === 0 || t === 1 ) {
			return t;
		}
		const c4 = ( 2 * Math.PI ) / 3;
		return Math.pow( 2, -10 * t ) * Math.sin( ( t * 10 - 0.75 ) * c4 ) + 1;
	},
};

const clamp = ( v: number, a: number, b: number ): number =>
	Math.max( a, Math.min( b, v ) );
const lerp = ( a: number, b: number, t: number ): number => a + ( b - a ) * t;
const rand = ( a: number, b: number ): number => a + Math.random() * ( b - a );

/**
 * A single closed heart outline (parametric heart curve), in local px,
 * scaled by `k`. Drawing the heart as ONE filled polygon — rather than
 * overlapping circles + a triangle — means it never self-overlaps, so
 * fading the shape's `alpha` stays uniform. (Overlapping same-colour
 * fills under a group alpha double-composite, so their seams look
 * darker as the heart fades — the artifact this avoids.)
 */
function heartPoints( k: number ): number[] {
	const pts: number[] = [];
	const samples = 48;
	for ( let i = 0; i <= samples; i++ ) {
		const t = ( i / samples ) * Math.PI * 2;
		const x = 16 * 1.08 * Math.pow( Math.sin( t ), 3 );
		const y = -(
			13 * Math.cos( t ) -
			5 * Math.cos( 2 * t ) -
			2 * Math.cos( 3 * t ) -
			Math.cos( 4 * t )
		);
		pts.push( x * k, y * k );
	}
	return pts;
}

/** A running tween managed by the engine's own mini scheduler. */
interface Tween {
	t: number;
	dur: number;
	ease: ( t: number ) => number;
	onUpdate?: ( p: number ) => void;
	onComplete?: () => void;
	tag?: string;
}

/** Inputs the engine needs to drive an already-built rig. */
export interface PetDeps {
	/** The widget's PixiJS application (created with `resizeTo: stage`). */
	app: Application;
	/** The animated bones from {@link buildWapuu}. */
	parts: WapuuParts;
	/** The rig root (the engine adds it to the stage itself). */
	root: Container;
	/** The `pixi.js` namespace (`window.PIXI`). */
	pixi: Pixi;
	/** The DOM element the canvas fills — observed for resize. */
	stage: HTMLElement;
	/**
	 * The widget card element, or null. Watched so Wapuu plays the
	 * lean + pinned-ears "being carried" reaction while the WHOLE
	 * widget is dragged across the desktop — the drag animation, now
	 * gathered from the widget's own movement rather than from grabbing
	 * Wapuu inside the card.
	 */
	card: HTMLElement | null;
}

/**
 * Start the Wapuu pet animation. Returns a teardown that removes the
 * ticker, listeners, timers, and effect children — call it on widget
 * unmount.
 *
 * @param deps Engine inputs.
 */
export function startWapuuPet( deps: PetDeps ): PetController {
	const { app, parts, root, pixi, stage, card } = deps;

	// The ground shadow is drawn ONCE at unit size; the tick only touches
	// its (cheap) transform + alpha — rebuilding the Graphics every frame
	// re-tessellated for no reason.
	const shadow: Graphics = new pixi.Graphics();
	shadow.ellipse( 0, 0, 118, 24 ).fill( { color: 0x2a3550, alpha: 0.2 } );
	const fx: Container = new pixi.Container();
	app.stage.addChild( shadow, root, fx );
	// Scratch Points for per-frame coordinate transforms (no allocations).
	const lookIn = new pixi.Point();
	const lookOut = new pixi.Point();

	// Geometry reads are cached per FRAME: getBoundingClientRect forces
	// layout, and several paths (eye tracking per pointermove, balloon
	// positioning, hit tests) used to issue one per call/event. The tick
	// invalidates the cache once per frame.
	let cachedCanvasRect: DOMRect | null = null;
	let cachedLayerRect: DOMRect | null = null;
	const canvasRect = (): DOMRect => {
		if ( ! cachedCanvasRect ) {
			cachedCanvasRect = (
				app.canvas as unknown as HTMLCanvasElement
			).getBoundingClientRect();
		}
		return cachedCanvasRect;
	};
	const layerRectOf = (): DOMRect => {
		if ( ! cachedLayerRect ) {
			cachedLayerRect = balloonLayer.getBoundingClientRect();
		}
		return cachedLayerRect;
	};

	// Balloons are an HTML overlay (not drawn in PixiJS) so one can host
	// real content — the chat text box — and so DOM opacity fades the
	// whole balloon uniformly. It mounts INSIDE the desktop area (like
	// the snap-preview does) at z-index 99: above the wallpaper/widget
	// layer, but under the window stack (windows start at z 100) — a
	// balloon never covers a focused window. Mounting on <body> wouldn't
	// work: the whole shell is one z-100 stacking context, so any
	// body-level sibling is either above ALL of it or below ALL of it.
	// `pointer-events: none` (CSS) keeps dragging Wapuu working.
	const balloonLayer = document.createElement( 'div' );
	balloonLayer.className = 'wapuu-balloon-layer';
	(
		document.getElementById( 'desktop-mode-area' ) ?? document.body
	).appendChild( balloonLayer );

	const resolution = (): number => app.renderer.resolution;
	const W = (): number => app.renderer.width / resolution();
	const H = (): number => app.renderer.height / resolution();
	let groundY = 0;
	let baseScale = 1;
	function layout(): void {
		// Tuned for a small widget card: Wapuu fills ~55 % of the card
		// with room for the jump arc above his head.
		baseScale = clamp( Math.min( W() / 600, H() / 660 ), 0.2, 0.7 );
		groundY = H() * 0.66;
		root.scale.set( baseScale );
	}

	// Wapuu never moves horizontally — `world.x` is always the card
	// centre, recomputed on resize. Only `world.y` animates (the jump +
	// the resting settle).
	const world = { x: 0, y: 0 };
	const REST = {
		bodyY: parts.body.position.y,
		eyeLx: parts.eyeL.position.x,
		eyeLy: parts.eyeL.position.y,
		eyeRx: parts.eyeR.position.x,
		eyeRy: parts.eyeR.position.y,
	};

	// Soft glow ring around the WordPress ball — breathes occasionally
	// as a "this is interactive" cue. Inserted at index 0 of the body
	// bone so it paints BEHIND the sphere and only the overhang shows
	// as a rim of light. Concentric fading strokes ≈ a cheap blur.
	const halo: Graphics = new pixi.Graphics();
	[ 8, 15, 23 ].forEach( ( grow, i ) => {
		halo.circle( 0, 0, parts.ball.radius + grow );
		halo.stroke( {
			color: 0xbdeaff,
			width: 9 - i * 2,
			alpha: 0.45 - i * 0.12,
		} );
	} );
	// parts.ball is root-local; the halo lives in the body bone.
	halo.position.set( parts.ball.x, parts.ball.y - REST.bodyY );
	halo.alpha = 0;
	parts.body.addChildAt( halo, 0 );

	// ---- tweens ----
	const tweens: Tween[] = [];
	function tween(
		o: Omit< Tween, 't' | 'ease' > & { ease?: ( t: number ) => number },
	): Tween {
		const tw: Tween = {
			t: 0,
			dur: o.dur,
			ease: o.ease || E.outCubic,
			onUpdate: o.onUpdate,
			onComplete: o.onComplete,
			tag: o.tag,
		};
		tweens.push( tw );
		return tw;
	}
	function killTag( tag: string ): void {
		for ( let i = tweens.length - 1; i >= 0; i-- ) {
			if ( tweens[ i ].tag === tag ) {
				tweens.splice( i, 1 );
			}
		}
	}

	// ---- state ----
	const eyes = {
		open: 1,
		target: 1,
		blink: 1,
		blinkAt: rand( 2, 4 ),
		look: { x: 0, y: 0 },
	};
	let t = 0;
	let idleTime = 0;
	let asleep = false;
	let state: PetState = 'idle';
	let nextEarTwitch = rand( 2.5, 6 );
	// Help-discovery cues: the periodic W→?→W wink and the halo breath.
	let nextAdvert = rand( 26, 38 );
	let nextHaloPulse = rand( 8, 14 );
	// Pointer state: handlers store CLIENT coords only (no layout reads
	// on the hot pointermove path); the tick converts to canvas-local
	// once per frame via the cached rect.
	const pointer = { clientX: 0, clientY: 0, x: 0, y: 0, has: false };
	let excite = 0;
	let breathSpeed = 1;
	let hopOffset = 0;
	let squashY = 1;
	let squashLand = 1;
	let petBob = 0;
	let tailKick = 0;
	// Accumulated oscillator phases. We integrate `phase += dt * freq`
	// each frame rather than computing `sin( t * freq )`, because `freq`
	// varies (tail with `excite`, breath with `breathSpeed`) and
	// `sin( t * freq )` injects a `t · dfreq/dt` term that makes the
	// phase jump erratically whenever the frequency changes — the tail
	// "flicker"/"two overlapping animations" artifact.
	let tailPhase = 0;
	let breathPhase = 0;
	const earTw: { L: number; R: number } = { L: 0, R: 0 };
	// Drag-reaction state — Wapuu leans into the direction the WHOLE
	// widget is being carried and pins his ears back. `tilt` eases back
	// to 0 once the drag stops.
	let tilt = 0;
	let dragVX = 0;
	let prevCardX = 0;
	let cardTracking = false;

	// Timers — tracked so teardown can clear them.
	let zHandle: ReturnType< typeof setTimeout > | undefined;
	let petEndHandle: ReturnType< typeof setTimeout > | undefined;
	let happyEyesHandle: ReturnType< typeof setTimeout > | undefined;
	let balloonHandle: ReturnType< typeof setTimeout > | undefined;
	let focusHandle: ReturnType< typeof setTimeout > | undefined;
	let activeBalloon: HTMLElement | null = null;
	let balloonScale = 1;
	// Offset (element px) of the balloon's tail tip — pinned to the head.
	let balloonTip = { x: 0, y: 0 };
	// The UNMIRRORED tail-tip offset — the edge-aware side picker derives
	// both candidate placements (canonical and flipped) from this.
	let balloonTipBase = { x: 0, y: 0 };
	// Which edge the tail grows from: bottom-tail balloons hover ABOVE
	// Wapuu; right-tail balloons (the chat) sit NEXT to him.
	let balloonSide: TailSide = 'bottom';
	// The active balloon's style — needed to re-fit its SVG shape when
	// the edge-aware placement flips sides.
	let balloonType: BalloonType = 'speak';
	// Edge-aware mirror state: mirrorX flips which side of Wapuu the
	// balloon sits on; mirrorY drops a comic balloon BELOW him (tail
	// pointing up) when the widget is parked against the top edge.
	let balloonMirrorX = false;
	let balloonMirrorY = false;
	// Gap between Wapuu's feet (root origin) and a below-anchored
	// balloon's tail tip.
	const BALLOON_BELOW_GAP = 28;
	// Visual extent that hangs BELOW the element box (the chat's input
	// bar is absolutely positioned below the bubble) — folded into the
	// viewport clamp so the bar never falls off-screen.
	let balloonExtraBottom = 0;
	// While an `ask` balloon waits for input, Wapuu holds still (no idle
	// hop / doze) so the text box doesn't drift, and `pendingAskCancel`
	// resolves the pending promise (as null) if the balloon is cleared.
	let asking = false;
	let pendingAskCancel: ( () => void ) | null = null;
	// Called when the active balloon is cleared by ANYTHING (a new
	// balloon, unmount) so a live chat session learns it was closed.
	let balloonClearedCb: ( () => void ) | null = null;

	function wake(): void {
		if ( asleep ) {
			asleep = false;
			killTag( 'sleep' );
			eyes.target = 1;
			breathSpeed = 1;
			clearTimeout( zHandle );
		}
		idleTime = 0;
		if ( state === 'sleep' ) {
			state = 'idle';
		}
	}
	function interacted(): void {
		idleTime = 0;
		nextAdvert = rand( 26, 38 );
		wake();
	}
	function busy(): boolean {
		return state === 'hop';
	}
	function endAct(): void {
		if ( state === 'hop' || state === 'pet' ) {
			state = 'idle';
		}
	}

	// ================= ACTIONS =================
	// In-place vertical jump. No horizontal travel — `world.x` is never
	// touched here.
	function hop(): void {
		interacted();
		if ( busy() ) {
			return;
		}
		state = 'hop';
		const height = clamp( H() * 0.16, 36, 90 );
		excite = Math.max( excite, 0.5 );
		tween( {
			dur: 0.62,
			tag: 'act',
			ease: E.linear,
			onUpdate( p ) {
				const arc = Math.sin( p * Math.PI );
				hopOffset = arc * height;
				// Smooth squash-and-stretch: crouched at takeoff/landing
				// (p≈0 and p≈1), stretched at the apex. `cos²` ramps the
				// crouch in/out instead of the old hard step at p=0.12 /
				// 0.88 (which popped rather than blended).
				const crouch = 0.14 * Math.pow( Math.cos( p * Math.PI ), 2 );
				squashY = 1 + arc * 0.12 - crouch;
			},
			onComplete() {
				hopOffset = 0;
				squashY = 1;
				landSquash();
				endAct();
			},
		} );
	}
	function landSquash(): void {
		tween( {
			dur: 0.34,
			tag: 'land',
			ease: E.outElastic,
			onUpdate( p ) {
				squashLand = lerp( 0.8, 1, p );
			},
		} );
	}

	function pet(): void {
		interacted();
		if ( state !== 'pet' ) {
			state = 'pet';
			killTag( 'act' );
			// A tap can interrupt a jump. `killTag` drops the hop tween
			// without running its `onComplete`, so reset the offsets it
			// was driving — otherwise Wapuu freezes floating mid-air.
			hopOffset = 0;
			squashY = 1;
		}
		happyEyes( 0.7 );
		excite = 1;
		tailKick = 1;
		// An integer 1 or 2 — `rand(1, 2)` returned a float in (1, 2),
		// which the `i < n` loop read as "always 2 hearts".
		spawnHearts( Math.random() < 0.5 ? 1 : 2 );
		killTag( 'petsquish' );
		tween( {
			dur: 0.5,
			tag: 'petsquish',
			ease: E.outBack,
			onUpdate( p ) {
				petBob = Math.sin( p * Math.PI ) * 9;
			},
		} );
		clearTimeout( petEndHandle );
		petEndHandle = setTimeout( () => {
			if ( state === 'pet' ) {
				petBob = 0;
				endAct();
			}
		}, 650 );
	}

	function happyEyes( dur: number ): void {
		eyes.target = 0.42;
		clearTimeout( happyEyesHandle );
		happyEyesHandle = setTimeout( () => {
			if ( ! asleep ) {
				eyes.target = 1;
			}
		}, dur * 1000 );
	}

	function sleep(): void {
		if ( asleep ) {
			return;
		}
		killTag( 'act' );
		// Same hazard as pet(): killing an in-flight hop tween skips its
		// onComplete, so reset what it drove — otherwise a jump() followed
		// by sleep() leaves Wapuu dozing in mid-air.
		hopOffset = 0;
		squashY = 1;
		state = 'sleep';
		asleep = true;
		// Closed but clearly visible — 0.08 squished the small eyes to an
		// almost-invisible sliver. ~0.3 + the widen below reads as a calm
		// shut "— —" eye.
		eyes.target = 0.3;
		breathSpeed = 0.5;
		scheduleZ();
	}
	function scheduleZ(): void {
		if ( ! asleep ) {
			return;
		}
		// Skip spawning while the tab is hidden: the rAF-driven ticker is
		// frozen there, so spawned z's would pile up un-animated (and
		// un-destroyed) until refocus. The chain keeps polling cheaply.
		if ( ! document.hidden ) {
			spawnZ();
		}
		zHandle = setTimeout( scheduleZ, 1400 );
	}

	// ================= FX =================
	const topY = (): number => root.y - 250 * baseScale;
	function spawnHearts( n: number ): void {
		for ( let i = 0; i < n; i++ ) {
			const h: Graphics = new pixi.Graphics();
			const color = i % 2 ? 0xff5a7a : 0xff8a00;
			// One closed polygon, one fill — no self-overlap, so the
			// alpha fade stays uniform (no darker seams).
			h.poly( heartPoints( 0.7 ) ).fill( color );
			const sx = world.x + rand( -40, 40 );
			const sy = topY() + rand( -10, 20 );
			h.position.set( sx, sy );
			h.alpha = 0;
			fx.addChild( h );
			const vx = rand( -30, 30 );
			const life = rand( 1.1, 1.7 );
			const rot = rand( -0.4, 0.4 );
			tween( {
				dur: life,
				ease: E.linear,
				onUpdate( p ) {
					h.y = sy - p * 120 * baseScale;
					h.x = sx + Math.sin( p * 6 + i ) * 14 + vx * p;
					h.alpha = p < 0.2 ? p / 0.2 : 1 - ( p - 0.2 ) / 0.8;
					h.rotation = rot * p;
					h.scale.set( baseScale * ( 1.4 + p * 0.5 ) );
				},
				onComplete() {
					fx.removeChild( h );
					h.destroy();
				},
			} );
		}
	}
	function spawnZ(): void {
		const z = new pixi.Text( {
			text: 'z',
			style: {
				fontFamily: 'Baloo 2, system-ui, sans-serif',
				fontSize: 44,
				fontWeight: '800',
				fill: 0x8fa2bd,
			},
		} );
		z.anchor.set( 0.5 );
		const sx = world.x + 80 * baseScale;
		const sy = topY();
		z.position.set( sx, sy );
		z.alpha = 0;
		fx.addChild( z );
		tween( {
			dur: 2.2,
			ease: E.outCubic,
			onUpdate( p ) {
				z.x = sx + p * 60 * baseScale;
				z.y = sy - p * 90 * baseScale;
				z.alpha = p < 0.2 ? p / 0.2 : 1 - ( p - 0.2 ) / 0.8;
				z.scale.set( baseScale * ( 0.9 + p * 0.8 ) );
			},
			onComplete() {
				fx.removeChild( z );
				z.destroy();
			},
		} );
	}

	// ================= BALLOONS =================
	// Pin the balloon's bottom-centre (its anchor) just above Wapuu's
	// head. `world.x` / `root.y` are PixiJS stage coords, which map 1:1
	// to the canvas-local CSS pixels the balloon layer lives in (under
	// autoDensity), so no conversion is needed.
	// Last values painted to the balloon — positionBalloon runs every
	// frame, but writes (style + the tail's SVG path) only happen when an
	// input actually changed. Skipping the writes keeps the layout clean,
	// so the per-frame reads stay cheap (no forced reflow interleave).
	const balloonPaint = { left: NaN, top: NaN, scale: NaN, tailX: NaN, tailY: NaN };
	// Fit the active balloon's SVG shape with the current mirror state
	// and refresh both tip offsets (the live one used for painting and
	// the unmirrored base the side picker reasons from).
	function fitActiveBalloon( el: HTMLElement ): void {
		balloonTip = fitBalloon( el, balloonType, balloonSide, {
			mirrorX: balloonMirrorX,
			mirrorY: balloonMirrorY,
		} );
		balloonTipBase = {
			x: balloonMirrorX ? el.offsetWidth - balloonTip.x : balloonTip.x,
			y: balloonMirrorY ? el.offsetHeight - balloonTip.y : balloonTip.y,
		};
	}
	// How far a box at `pos` (layer-local) pokes past the layer on either
	// side — 0 when it fits with `margin` to spare.
	const balloonOverflow = ( pos: number, size: number, limit: number, margin: number ): number =>
		Math.max( 0, margin - pos ) +
		Math.max( 0, pos + size - ( limit - margin ) );
	// Prefer the canonical side; mirror only when it overflows the layer
	// and the flipped side is meaningfully better (the slack keeps the
	// choice from flapping around the break-even point mid-drag).
	const pickMirror = ( overNormal: number, overMirrored: number ): boolean =>
		overNormal > 4 && overMirrored + 8 < overNormal;
	function positionBalloon(): void {
		const el = activeBalloon;
		if ( ! el ) {
			return;
		}
		// Map Wapuu's anchors (canvas-local stage coords) to viewport
		// coords via the canvas's on-screen rect (frame-cached), so the
		// area-level balloon lines up even though it lives outside the
		// clipped card.
		const rect = canvasRect();
		const layerRect = layerRectOf();
		const a = parts.anchors;
		const margin = 10;
		const w = el.offsetWidth;
		const h = el.offsetHeight + balloonExtraBottom;

		// ---- edge awareness ----
		// Pick which side of Wapuu the balloon lives on from the space
		// actually available, so a widget parked against a screen edge
		// gets its balloon flipped INTO the viewport instead of clamped
		// over Wapuu's face (or pushed off-screen). Decided from STABLE
		// anchors (groundY, not the bobbing root.y) so the choice can't
		// flap with the breath cycle — it only moves when the widget is
		// dragged or the layout changes.
		const cx = rect.left - layerRect.left + world.x;
		const cy = rect.top - layerRect.top + groundY;
		let wantX: boolean;
		let wantY = false;
		if ( balloonSide === 'right' ) {
			// Chat: beside Wapuu — flip to his right when the left side
			// can't fit the bubble. (Vertical stays clamp-only: the chat
			// tail re-aims dynamically, so a raised bubble still reads.)
			const leftN = cx + a.chatSide.x * baseScale - balloonTipBase.x;
			const leftM =
				cx - a.chatSide.x * baseScale - ( w - balloonTipBase.x );
			wantX = pickMirror(
				balloonOverflow( leftN, w, layerRect.width, margin ),
				balloonOverflow( leftM, w, layerRect.width, margin ),
			);
		} else {
			// Comic: above Wapuu, extending up-left — flip horizontally
			// when the left side is tight, and drop BELOW him when the
			// sky above is too short (widget docked at the top edge).
			const leftN =
				cx + a.headTop.x * baseScale - 60 - balloonTipBase.x;
			const leftM =
				cx + a.headTop.x * baseScale + 60 - ( w - balloonTipBase.x );
			wantX = pickMirror(
				balloonOverflow( leftN, w, layerRect.width, margin ),
				balloonOverflow( leftM, w, layerRect.width, margin ),
			);
			const topN =
				cy + a.headTop.y * baseScale - 20 - balloonTipBase.y;
			const topM =
				cy +
				BALLOON_BELOW_GAP -
				( el.offsetHeight - balloonTipBase.y );
			wantY = pickMirror(
				balloonOverflow( topN, h, layerRect.height, margin ),
				balloonOverflow( topM, h, layerRect.height, margin ),
			);
		}
		if ( wantX !== balloonMirrorX || wantY !== balloonMirrorY ) {
			balloonMirrorX = wantX;
			balloonMirrorY = wantY;
			fitActiveBalloon( el );
			// The rebuilt shape must repaint (and the chat tail re-aim)
			// even if left/top land on the same values.
			balloonPaint.left = NaN;
			balloonPaint.tailX = NaN;
		}

		let headX: number;
		let headY: number;
		if ( balloonSide === 'right' ) {
			// Chat balloon sits NEXT to Wapuu (on whichever side has
			// room), raised a touch above his head line. Anchored to the
			// STABLE groundY — not the live root.y, which bobs with the
			// breath cycle — so the balloon holds still while the user
			// types (it still follows the widget when the card is
			// dragged, via the canvas rect).
			const sideX = balloonMirrorX ? -a.chatSide.x : a.chatSide.x;
			headX = rect.left + world.x + sideX * baseScale;
			headY = rect.top + groundY + a.chatSide.y * baseScale;
		} else {
			// Comic balloons hover ABOVE him, nudged up-left of his head
			// (mirrored X: up-right; mirrored Y: they hang below his
			// feet, tail pointing up at him).
			const nudge = balloonMirrorX ? 60 : -60;
			headX = rect.left + world.x + a.headTop.x * baseScale + nudge;
			headY = balloonMirrorY
				? rect.top + root.y + BALLOON_BELOW_GAP
				: rect.top + root.y + a.headTop.y * baseScale - 20;
		}
		// Place the element so its tail tip sits at the anchor; the
		// transform-origin (set to the tip in fitBalloon) keeps the tip
		// pinned through the pop/fade scale. Coords are layer-local
		// (balloons are absolute children of the layer), so subtract the
		// layer's own viewport offset.
		let left = headX - balloonTip.x - layerRect.left;
		let top = headY - balloonTip.y - layerRect.top;
		// Smart clamp (final guard): keep the WHOLE balloon (incl. the
		// chat's input bar that hangs below) inside the visible layer, so
		// it never runs off-screen when Wapuu sits near an edge. Sizes
		// are at scale 1 (the resting state); during the smaller pop the
		// box is well within these bounds anyway.
		left = clamp( left, margin, Math.max( margin, layerRect.width - w - margin ) );
		top = clamp( top, margin, Math.max( margin, layerRect.height - h - margin ) );
		// Quantise to 0.1px and dirty-check before touching the DOM.
		left = Math.round( left * 10 ) / 10;
		top = Math.round( top * 10 ) / 10;
		const scale = Math.round( balloonScale * 1000 ) / 1000;
		if (
			left !== balloonPaint.left ||
			top !== balloonPaint.top ||
			scale !== balloonPaint.scale
		) {
			balloonPaint.left = left;
			balloonPaint.top = top;
			balloonPaint.scale = scale;
			el.style.left = `${ left }px`;
			el.style.top = `${ top }px`;
			el.style.transform = `scale(${ scale })`;
		}

		// Dynamic notch: aim the chat bubble's tail at Wapuu's MOUTH —
		// it points right at him wherever the bubble sits (raised,
		// clamped at a screen edge) and follows his breathing. Mouth in
		// viewport coords → element-local, compensating for the pop scale
		// (transform-origin is the virtual tip = balloonTip). The path is
		// only rewritten when the aim actually moved (≥ 0.5px).
		if ( balloonSide === 'right' ) {
			const mouthX = rect.left + world.x + a.mouth.x * baseScale;
			const mouthY = rect.top + root.y + a.mouth.y * baseScale;
			const rawX = mouthX - layerRect.left - left;
			const rawY = mouthY - layerRect.top - top;
			const s = balloonScale || 1;
			const lx =
				Math.round( ( balloonTip.x + ( rawX - balloonTip.x ) / s ) * 2 ) / 2;
			const ly =
				Math.round( ( balloonTip.y + ( rawY - balloonTip.y ) / s ) * 2 ) / 2;
			if ( lx !== balloonPaint.tailX || ly !== balloonPaint.tailY ) {
				balloonPaint.tailX = lx;
				balloonPaint.tailY = ly;
				updateChatTail( el, lx, ly );
			}
		}
	}
	function clearBalloon(): void {
		clearTimeout( balloonHandle );
		clearTimeout( focusHandle );
		killTag( 'balloon' );
		asking = false;
		// A fresh balloon element must get its first paint even if it
		// computes to the same spot as the last one.
		balloonPaint.left = NaN;
		balloonPaint.top = NaN;
		balloonPaint.scale = NaN;
		balloonPaint.tailX = NaN;
		balloonPaint.tailY = NaN;
		// Resolve a still-pending ask (as cancelled) before we drop it.
		if ( pendingAskCancel ) {
			const cancel = pendingAskCancel;
			pendingAskCancel = null;
			cancel();
		}
		// Notify a live chat session that it's gone.
		if ( balloonClearedCb ) {
			const cb = balloonClearedCb;
			balloonClearedCb = null;
			cb();
		}
		if ( activeBalloon ) {
			activeBalloon.remove();
			activeBalloon = null;
		}
	}
	// Fade a balloon out, then clear it. Shared by say's linger, ask's
	// linger, and the chat session's close().
	function fadeOutBalloon( el: HTMLElement ): void {
		tween( {
			dur: 0.4,
			tag: 'balloon',
			ease: E.outCubic,
			onUpdate( p ) {
				balloonScale = 1 + 0.12 * p;
				el.style.opacity = String( 1 - p );
			},
			onComplete() {
				if ( activeBalloon === el ) {
					clearBalloon();
				}
			},
		} );
	}
	// Pop a balloon in (scale + fade up). We animate the ROOT element's
	// opacity so the whole balloon (shape + tail/dots + text) fades as
	// one group — no per-layer alpha double-composite. Shared by every
	// balloon kind.
	function popInBalloon( el: HTMLElement ): void {
		balloonScale = 0.4;
		tween( {
			dur: 0.32,
			tag: 'balloon',
			ease: E.outBack,
			onUpdate( p ) {
				balloonScale = 0.4 + 0.6 * p;
				el.style.opacity = String( Math.min( 1, p * 1.6 ) );
			},
		} );
	}
	// The chat input bar hangs BELOW the balloon box (absolute, 12px gap
	// — see styles.css). Measure its real extent instead of hardcoding,
	// so a CSS tweak can't silently desync the viewport clamp.
	function measureBalloonExtraBottom( el: HTMLElement ): number {
		const row = el.querySelector< HTMLElement >( '.wapuu-chat__row' );
		return row ? 12 + row.offsetHeight : 0;
	}
	function say( text: string, type: BalloonType, durationMs = 2600 ): void {
		interacted();
		clearBalloon();
		const el = createBalloon( type, text );
		el.style.opacity = '0';
		// Append first so the content is measurable, then fit the SVG
		// shape to it and learn where the tail tip lands.
		balloonLayer.appendChild( el );
		balloonSide = 'bottom';
		balloonType = type;
		balloonMirrorX = false;
		balloonMirrorY = false;
		balloonExtraBottom = 0;
		fitActiveBalloon( el );
		activeBalloon = el;
		positionBalloon();
		popInBalloon( el );
		// Hold, then fade out + drift up a touch.
		balloonHandle = setTimeout( () => {
			if ( activeBalloon === el ) {
				fadeOutBalloon( el );
			}
		}, durationMs );
	}

	function ask(
		prompt: string,
		opts?: {
			durationMs?: number;
			placeholder?: string;
			messages?: WapuuChatMessage[];
		},
	): Promise< string | null > {
		interacted();
		clearBalloon();
		const askParts = createAskBalloon(
			prompt || '',
			opts?.placeholder || __( 'Type a reply…' ),
			opts?.messages || [],
		);
		const { el, input, send } = askParts;
		el.style.opacity = '0';
		balloonLayer.appendChild( el );
		balloonSide = 'right'; // the chat sits NEXT to Wapuu
		balloonType = 'speak';
		balloonMirrorX = false;
		balloonMirrorY = false;
		fitActiveBalloon( el );
		balloonExtraBottom = measureBalloonExtraBottom( el );
		refreshChatThread( askParts ); // now in the DOM: scroll + hint
		activeBalloon = el;
		asking = true; // hold still + stay awake while waiting for input
		positionBalloon();
		popInBalloon( el );
		// Focus the field once it has popped in.
		focusHandle = setTimeout( () => {
			try {
				input.focus( { preventScroll: true } );
			} catch {
				// Focus is best-effort.
			}
		}, 60 );

		return new Promise< string | null >( ( resolve ) => {
			let settled = false;
			const settle = ( value: string | null ): void => {
				if ( settled ) {
					return;
				}
				settled = true;
				pendingAskCancel = null;
				resolve( value );
			};
			// A new balloon / unmount clears this one → resolve null.
			pendingAskCancel = () => settle( null );

			// Resolve, then linger + fade out. `asking` stays true until
			// the balloon actually clears (clearBalloon flips it), so
			// Wapuu doesn't resume hopping while the chat is on screen.
			const endAsk = ( value: string | null, linger: number ): void => {
				if ( settled ) {
					return;
				}
				settle( value );
				balloonHandle = setTimeout( () => {
					if ( activeBalloon === el ) {
						fadeOutBalloon( el );
					}
				}, Math.max( 0, linger ) );
			};

			const submit = (): void => {
				const value = input.value.trim();
				if ( ! value || settled ) {
					return;
				}
				input.value = '';
				input.disabled = true;
				markAskSent( askParts );
				// Drop the reply straight into its real slot and re-fit the
				// bubble instantly — no cross-element flight to mis-land.
				// The chip itself does a quick rise-and-fade in place (CSS
				// `--enter`), so it reads as "sent" while staying exact.
				appendChatMessage( askParts, { role: 'user', content: value } );
				(
					askParts.thread.lastElementChild as HTMLElement | null
				)?.classList.add( 'wapuu-chat__msg--enter' );
				fitActiveBalloon( el );
				refreshChatThread( askParts );
				positionBalloon();
				endAsk( value, opts?.durationMs ?? 1800 );
			};
			send.addEventListener( 'click', submit );
			input.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
				if ( e.key === 'Enter' ) {
					e.preventDefault();
					e.stopPropagation();
					submit();
				} else if ( e.key === 'Escape' ) {
					e.preventDefault();
					e.stopPropagation();
					endAsk( null, 0 ); // cancel → fade right away
				}
			} );
		} );
	}

	function chat( opts?: WapuuChatOptions ): WapuuChatSession {
		interacted();
		clearBalloon();
		const askParts = createAskBalloon(
			'',
			opts?.placeholder || __( 'Message…' ),
			opts?.messages || [],
		);
		const { el, input, send } = askParts;
		el.style.opacity = '0';
		balloonLayer.appendChild( el );
		balloonSide = 'right';
		balloonType = 'speak';
		balloonMirrorX = false;
		balloonMirrorY = false;
		fitActiveBalloon( el );
		balloonExtraBottom = measureBalloonExtraBottom( el );
		refreshChatThread( askParts );
		activeBalloon = el;
		asking = true; // chat holds Wapuu still + awake the whole time
		positionBalloon();
		popInBalloon( el );
		focusHandle = setTimeout( () => {
			try {
				input.focus( { preventScroll: true } );
			} catch {
				// Focus is best-effort.
			}
		}, 60 );

		let typingEl: HTMLElement | null = null;
		let closed = false;
		const isLive = (): boolean => ! closed && activeBalloon === el;

		// Re-fit the bubble around the thread + re-pin + scroll. `animate`
		// gives the newest chip its quick rise-and-fade.
		const repaint = ( animate: boolean ): void => {
			if ( animate ) {
				(
					askParts.thread.lastElementChild as HTMLElement | null
				)?.classList.add( 'wapuu-chat__msg--enter' );
			}
			fitActiveBalloon( el );
			refreshChatThread( askParts );
			positionBalloon();
		};

		// Teardown hooks (backdrop listener, context menu) registered
		// below — markClosed runs them all however the chat ends.
		const sessionCleanups: Array< () => void > = [];
		const markClosed = (): void => {
			if ( closed ) {
				return;
			}
			closed = true;
			asking = false;
			for ( const fn of sessionCleanups.splice( 0 ) ) {
				try {
					fn();
				} catch {
					// Best-effort.
				}
			}
			opts?.onClose?.();
		};
		// External clear (a `say`, unmount, …) closes the session too.
		balloonClearedCb = markClosed;

		// One insertion path for both append flavours: keeps the
		// typing indicator pinned to the bottom across inserts.
		const insertMessages = ( messages: WapuuChatMessage[] ): void => {
			if ( ! isLive() ) {
				return;
			}
			typingEl?.remove();
			for ( const m of messages ) {
				appendChatMessage( askParts, m );
			}
			if ( typingEl ) {
				askParts.thread.appendChild( typingEl );
			}
			repaint( true );
		};

		const session: WapuuChatSession = {
			append( msg ) {
				insertMessages( [ msg ] );
			},
			appendMany( messages ) {
				insertMessages( messages );
			},
			setTyping( on ) {
				if ( ! isLive() ) {
					return;
				}
				if ( on && ! typingEl ) {
					typingEl = createTypingIndicator();
					askParts.thread.appendChild( typingEl );
					repaint( false );
				} else if ( ! on && typingEl ) {
					typingEl.remove();
					typingEl = null;
					repaint( false );
				}
			},
			clear() {
				if ( ! isLive() ) {
					return;
				}
				typingEl?.remove();
				typingEl = null;
				askParts.thread.replaceChildren();
				repaint( false );
			},
			close() {
				if ( closed ) {
					return;
				}
				balloonClearedCb = null; // we own the teardown now
				markClosed();
				if ( activeBalloon === el ) {
					fadeOutBalloon( el );
				}
			},
		};

		const submit = (): void => {
			const value = input.value.trim();
			if ( ! value || ! isLive() ) {
				return;
			}
			input.value = '';
			typingEl?.remove();
			appendChatMessage( askParts, { role: 'user', content: value } );
			if ( typingEl ) {
				askParts.thread.appendChild( typingEl );
			}
			repaint( true );
			opts?.onSend?.( value ); // caller responds via session.append
		};
		send.addEventListener( 'click', submit );
		input.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key === 'Enter' ) {
				e.preventDefault();
				e.stopPropagation();
				submit();
			} else if ( e.key === 'Escape' ) {
				e.preventDefault();
				e.stopPropagation();
				session.close();
			}
		} );

		// Backdrop close: a pointerdown anywhere OUTSIDE the chat closes
		// it (and the index-side onClose restores the W). Clicks on the
		// widget card are exempt — the card's own handlers manage those
		// (closing here too would make the ball click close-then-reopen).
		// Clicks inside the chat's context menu are exempt as well.
		const onBackdropDown = ( ev: PointerEvent ): void => {
			const tgt = ev.target as HTMLElement | null;
			if (
				! tgt ||
				el.contains( tgt ) ||
				( card && card.contains( tgt ) ) ||
				tgt.closest?.( '.wapuu-chat__menu' )
			) {
				return;
			}
			session.close();
		};
		document.addEventListener( 'pointerdown', onBackdropDown, true );
		sessionCleanups.push( () =>
			document.removeEventListener( 'pointerdown', onBackdropDown, true ),
		);

		// Right-click on the chat → context menu: Clear chat / Close
		// chat. Same `<wpd-context-menu>` pattern as the heartbeat
		// widget (the elements are defined by the main desktop bundle).
		let closeOpenMenu: ( () => void ) | null = null;
		const openChatMenu = ( ev: MouseEvent ): void => {
			ev.preventDefault();
			ev.stopPropagation();
			closeOpenMenu?.();
			document
				.querySelectorAll( '.wapuu-chat__menu' )
				.forEach( ( n ) => n.remove() );

			const menu = document.createElement( 'wpd-context-menu' );
			menu.className = 'wapuu-chat__menu';
			menu.setAttribute( 'open', '' );
			menu.style.position = 'fixed';
			menu.style.left = `${ ev.clientX }px`;
			menu.style.top = `${ ev.clientY }px`;
			menu.style.zIndex = '10500';

			const makeOption = ( value: string, label: string ): HTMLElement => {
				const o = document.createElement( 'wpd-context-menu-option' );
				o.setAttribute( 'value', value );
				o.textContent = label;
				return o;
			};
			menu.appendChild( makeOption( 'clear', __( 'Clear chat' ) ) );
			menu.appendChild( makeOption( 'close', __( 'Close chat' ) ) );

			const closeMenu = (): void => {
				closeOpenMenu = null;
				menu.remove();
				document.removeEventListener( 'pointerdown', onOutside, true );
				document.removeEventListener( 'keydown', onKey, true );
			};
			closeOpenMenu = closeMenu;
			const onOutside = ( e2: Event ): void => {
				if ( ! menu.contains( e2.target as Node ) ) {
					closeMenu();
				}
			};
			const onKey = ( e2: KeyboardEvent ): void => {
				if ( e2.key === 'Escape' ) {
					closeMenu();
				}
			};
			menu.addEventListener( 'wpd-context-menu-pick', ( e2: Event ) => {
				const value = ( e2 as CustomEvent< { value?: string } > ).detail
					?.value;
				closeMenu();
				if ( value === 'clear' ) {
					session.clear();
				} else if ( value === 'close' ) {
					session.close();
				}
			} );

			document.body.appendChild( menu );
			// Clamp to the viewport.
			const rect = menu.getBoundingClientRect();
			if ( rect.right > window.innerWidth ) {
				menu.style.left = `${ Math.max( 4, window.innerWidth - rect.width - 8 ) }px`;
			}
			if ( rect.bottom > window.innerHeight ) {
				menu.style.top = `${ Math.max( 4, window.innerHeight - rect.height - 8 ) }px`;
			}
			document.addEventListener( 'pointerdown', onOutside, true );
			document.addEventListener( 'keydown', onKey, true );
		};
		el.addEventListener( 'contextmenu', openChatMenu );
		sessionCleanups.push( () => {
			el.removeEventListener( 'contextmenu', openChatMenu );
			// closeMenu (not just node removal) so the menu's document-
			// level capture listeners can't outlive the session.
			closeOpenMenu?.();
		} );

		return session;
	}

	// ================= BALL BUTTON (W ⇄ ?) =================
	let ballMode: BallMode = 'w';
	function getBallMode(): BallMode {
		return ballMode;
	}
	// The raw glyph swap (shrink current, pop the other in). Used by
	// setBallMode AND by the idle "wink" advert, which must not count
	// as an interaction (it can fire while Wapuu sleeps).
	function swapBallGlyph( mode: BallMode ): void {
		if ( mode === ballMode ) {
			return;
		}
		ballMode = mode;
		const show = mode === 'question' ? parts.question : parts.logo;
		const hide = mode === 'question' ? parts.logo : parts.question;
		killTag( 'ballmode' );
		// Tween from the glyphs' CURRENT scales — a swap can interrupt an
		// in-flight swap (e.g. a tap racing the advert wink's restore),
		// and hardcoded 1→0 / 0→1 endpoints made the first frame snap.
		const hideFrom = hide.scale.x;
		const showFrom = show.scale.x;
		tween( {
			dur: 0.16,
			tag: 'ballmode',
			ease: E.outCubic,
			onUpdate( p ) {
				hide.scale.set( hideFrom * ( 1 - p ) );
			},
			onComplete() {
				hide.scale.set( 0 );
				tween( {
					dur: 0.3,
					tag: 'ballmode',
					ease: E.outBack,
					onUpdate( p ) {
						show.scale.set( showFrom + ( 1 - showFrom ) * p );
					},
					onComplete() {
						show.scale.set( 1 );
					},
				} );
			},
		} );
	}
	function setBallMode( mode: BallMode ): void {
		if ( mode === ballMode ) {
			return;
		}
		interacted();
		swapBallGlyph( mode );
	}
	// Idle advert — "psst, I can help": briefly wink the W to "?" and
	// back. Skipped whenever the "?" is already meaningful (chat open).
	let advertHandle: ReturnType< typeof setTimeout > | undefined;
	function advertWink(): void {
		if ( ballMode !== 'w' || asking ) {
			return;
		}
		swapBallGlyph( 'question' );
		advertHandle = setTimeout( () => {
			// Restore — unless the user opened the chat mid-wink.
			if ( ballMode === 'question' && ! asking ) {
				swapBallGlyph( 'w' );
			}
		}, 1300 );
	}

	let ballHovered = false;
	const ballBaseX = parts.ballButton.position.x;
	function setBallHover( on: boolean ): void {
		if ( on === ballHovered ) {
			return;
		}
		ballHovered = on;
		const fromScale = parts.ballButton.scale.x;
		const toScale = on ? 1.12 : 1;
		// The grown disc's LEFT edge would collide with the blue ball's
		// black stroke, so the hover also nudges the button slightly
		// RIGHT (away from that edge); it slides back on leave. ~8 rig
		// px ≈ a couple of on-screen px at widget scale.
		const fromX = parts.ballButton.position.x;
		const toX = ballBaseX + ( on ? 8 : 0 );
		killTag( 'ballhover' );
		tween( {
			dur: 0.16,
			tag: 'ballhover',
			ease: E.outCubic,
			onUpdate( p ) {
				parts.ballButton.scale.set(
					fromScale + ( toScale - fromScale ) * p,
				);
				parts.ballButton.position.x = fromX + ( toX - fromX ) * p;
			},
		} );
	}

	/** Map a client point to root-local rig coords (pre-baseScale). */
	function toRigLocal( clientX: number, clientY: number ): { x: number; y: number } {
		const r = canvasRect();
		return {
			x: ( clientX - r.left - world.x ) / baseScale,
			y: ( clientY - r.top - root.y ) / baseScale,
		};
	}
	function getClickTarget( clientX: number, clientY: number ): ClickTarget {
		const p = toRigLocal( clientX, clientY );
		const hit = parts.anchors.bodyHit;
		// Ball first — it sits inside the body circle.
		if ( Math.hypot( p.x - parts.ball.x, p.y - parts.ball.y ) <= parts.ball.radius ) {
			return 'ball';
		}
		if ( Math.hypot( p.x - hit.x, p.y - hit.y ) <= hit.radius ) {
			return 'body';
		}
		return 'none';
	}

	// ================= INPUT =================
	// PixiJS processes no pointer events — the framework's transparent
	// chrome overlay sits above the canvas and owns the whole-widget
	// drag. The widget (index.ts) forwards tap=pet + pointer-tracking
	// into these two feeders. setPointer stores CLIENT coords only —
	// pointermove can outpace the frame rate, so no geometry reads here;
	// the tick converts once per frame via the cached canvas rect.
	function setPointer( clientX: number, clientY: number ): void {
		pointer.clientX = clientX;
		pointer.clientY = clientY;
		pointer.has = true;
		idleTime = 0;
		wake();
	}
	function clearPointer(): void {
		pointer.has = false;
	}

	// ================= LOOP =================
	const tick = ( ticker: Ticker ): void => {
		const dt = Math.min( ticker.deltaMS / 1000, 0.05 );
		t += dt;

		// New frame: drop the cached geometry, convert the latest pointer
		// position once (instead of once per pointermove event).
		cachedCanvasRect = null;
		cachedLayerRect = null;
		if ( pointer.has ) {
			const r = canvasRect();
			pointer.x = pointer.clientX - r.left;
			pointer.y = pointer.clientY - r.top;
		}

		for ( let i = tweens.length - 1; i >= 0; i-- ) {
			const tw = tweens[ i ];
			tw.t += dt;
			const p = clamp( tw.t / tw.dur, 0, 1 );
			tw.onUpdate?.( tw.ease( p ) );
			if ( p >= 1 ) {
				tweens.splice( i, 1 );
				tw.onComplete?.();
			}
		}

		// Settle toward the ground (the jump's only vertical force is the
		// hopOffset applied in the pose below).
		world.y = lerp( world.y, groundY, 0.2 );

		// ---- widget-drag reaction ----
		// The framework adds `--dragging` to the card while the WHOLE
		// widget is being moved. Read the card's on-screen horizontal
		// velocity from that and lean Wapuu into it (+ pin his ears),
		// reproducing the source demo's pick-up animation — but sourced
		// from the widget's movement, not from grabbing Wapuu.
		const dragging =
			!! card &&
			card.classList.contains( 'desktop-mode-widgets__card--dragging' );
		if ( dragging && card ) {
			// The framework drag writes the card's inline `left` each
			// pointermove — read THAT (no layout) instead of forcing a
			// reflow with getBoundingClientRect mid-drag.
			const styleLeft = parseFloat( card.style.left );
			const left = Number.isNaN( styleLeft )
				? card.getBoundingClientRect().left
				: styleLeft;
			if ( cardTracking ) {
				dragVX = left - prevCardX;
			}
			prevCardX = left;
			cardTracking = true;
			idleTime = 0;
			wake();
			excite = 1;
		} else {
			cardTracking = false;
			dragVX *= 0.8;
		}
		const targetTilt = dragging ? clamp( -dragVX * 0.012, -0.4, 0.4 ) : 0;
		tilt = lerp( tilt, targetTilt, dragging ? 0.5 : 0.15 );

		// ---- idle timers ----
		if ( state === 'idle' ) {
			idleTime += dt;
			if ( ! asleep && ! asking && idleTime > 8.5 ) {
				sleep();
			}
			nextEarTwitch -= dt;
			if ( ! asleep && nextEarTwitch <= 0 ) {
				nextEarTwitch = rand( 3, 7 );
				const which: 'L' | 'R' = Math.random() < 0.5 ? 'L' : 'R';
				tween( {
					dur: 0.5,
					ease: E.outElastic,
					onUpdate( p ) {
						earTw[ which ] = Math.sin( p * Math.PI ) * ( 1 - p ) * 1.6;
					},
					onComplete() {
						earTw[ which ] = 0;
					},
				} );
			}
			// (No random idle jump — it read as distracting. The jump
			// stays available programmatically via the public API.)
		}

		// ---- help-discovery cues ----
		// Deliberately OUTSIDE the idle gate: Wapuu dozes off after just
		// 8.5s, and these cues exist for the passive VIEWER — gating them
		// on `state === 'idle'` froze their countdowns exactly when they
		// mattered. They run while idle OR asleep, never mid-chat and
		// never while the tab is hidden (frozen ticker would queue them).
		if (
			( state === 'idle' || state === 'sleep' ) &&
			! asking &&
			! document.hidden
		) {
			// Advert: every ~30s the W winks to "?" and back.
			if ( ballMode === 'w' ) {
				nextAdvert -= dt;
				if ( nextAdvert <= 0 ) {
					nextAdvert = rand( 26, 38 );
					advertWink();
				}
			}
			// Halo breath: a soft glow ring swells around the ball now
			// and then — same "psst, this is clickable" channel.
			nextHaloPulse -= dt;
			if ( nextHaloPulse <= 0 ) {
				nextHaloPulse = rand( 9, 16 );
				killTag( 'halo' );
				tween( {
					dur: 1.6,
					tag: 'halo',
					ease: E.linear,
					onUpdate( p ) {
						halo.alpha = Math.sin( p * Math.PI ) * 0.55;
						halo.scale.set( 1 + p * 0.1 );
					},
					onComplete() {
						halo.alpha = 0;
						halo.scale.set( 1 );
					},
				} );
			}
		}

		// ---- blink ----
		if ( ! asleep && eyes.target > 0.8 ) {
			eyes.blinkAt -= dt;
			if ( eyes.blinkAt <= 0 && eyes.open >= 0.9 ) {
				eyes.blinkAt = rand( 2.4, 5.2 );
				tween( {
					dur: 0.16,
					ease: E.linear,
					onUpdate( p ) {
						eyes.blink = p < 0.5 ? 1 - p * 2 : ( p - 0.5 ) * 2;
					},
					onComplete() {
						eyes.blink = 1;
					},
				} );
			}
		}
		eyes.open = lerp( eyes.open, eyes.target, 0.2 );

		excite = Math.max( 0, excite - dt * ( state === 'pet' ? 0 : 0.7 ) );
		tailKick = Math.max( 0, tailKick - dt * 1.5 );

		// ================= POSE =================
		breathPhase += dt * 1.8 * breathSpeed;
		const br = Math.sin( breathPhase );
		const sY = squashY * squashLand * ( 1 + br * ( asleep ? 0.05 : 0.03 ) );
		const sX =
			( 1 / Math.sqrt( squashY * squashLand ) ) *
			( 1 - br * ( asleep ? 0.035 : 0.022 ) );
		parts.body.scale.set( sX, sY );
		parts.body.position.y = REST.bodyY + ( asleep ? 6 : 0 );

		const renderY =
			world.y - hopOffset - petBob - ( asleep ? 0 : Math.max( 0, br ) * 2 );
		root.position.set( world.x, renderY );
		// Lean while carried, with a tiny wobble; settle upright otherwise.
		root.rotation = tilt + ( dragging ? Math.sin( t * 5 ) * 0.02 : 0 );

		// Tail sway frequency. The source demo whipped it "ultra fast"
		// when excited (`1.5 + excite * 4` → 5.5 rad/s). Excitement now
		// barely raises the FREQUENCY — it shows as a bigger AMPLITUDE
		// (the `excite`/`tailKick` terms below) instead, so a happy wag
		// reads as energetic, not frantic. `1.0 + excite * 0.35` →
		// idle ≈ 0.16 Hz, excited ≈ 0.21 Hz. Phase is integrated (see
		// `tailPhase`) so this varying frequency stays glitch-free.
		const tailSpd = 1.0 + excite * 0.35;
		tailPhase += dt * tailSpd;
		parts.tail.rotation =
			Math.sin( tailPhase ) * ( 0.12 + excite * 0.18 + tailKick * 0.25 );

		// Ears: pin back while carried, otherwise a gentle breathing bob.
		const earBob = dragging ? -0.18 : br * 0.03;
		parts.earL.rotation = lerp( parts.earL.rotation, earBob + earTw.L, 0.3 );
		parts.earR.rotation = lerp( parts.earR.rotation, -earBob + earTw.R, 0.3 );

		// Eyes: blink scale + cursor look. While the pointer hovers the
		// ball button, Wapuu glances DOWN at his own ball instead —
		// directing the user's attention to the thing under their cursor.
		const oy = eyes.open * eyes.blink;
		if ( ! asleep ) {
			if ( ballHovered ) {
				eyes.look.x = lerp( eyes.look.x, -4, 0.2 );
				eyes.look.y = lerp( eyes.look.y, 4, 0.2 );
			} else {
				// Scratch Points — toLocal with an out-param avoids two
				// object allocations per frame in this always-on path.
				lookIn.set(
					pointer.has ? pointer.x : world.x,
					pointer.has ? pointer.y : renderY - 300,
				);
				const lp = root.toLocal( lookIn, undefined, lookOut );
				eyes.look.x = lerp(
					eyes.look.x,
					clamp( lp.x / 320, -1, 1 ) * 5,
					0.15,
				);
				eyes.look.y = lerp(
					eyes.look.y,
					clamp( ( lp.y + 150 ) / 360, -1, 1 ) * 4,
					0.15,
				);
			}
		}
		parts.eyeL.position.set( REST.eyeLx + eyes.look.x, REST.eyeLy + eyes.look.y );
		parts.eyeR.position.set( REST.eyeRx + eyes.look.x, REST.eyeRy + eyes.look.y );
		// Widen the eyes a touch while asleep so the closed lids read as a
		// soft "— —" line rather than a near-invisible squished dot.
		const eyeX = asleep ? 1.5 : 1;
		const eyeY = clamp( oy, 0.05, 1 );
		parts.eyeL.scale.set( eyeX, eyeY );
		parts.eyeR.scale.set( eyeX, eyeY );

		// ---- shadow ----
		// Transform + alpha only — the ellipse was drawn once at setup;
		// rebuilding the Graphics each frame re-tessellated for nothing.
		const airborne = clamp( groundY - world.y + hopOffset + petBob, 0, 320 );
		const k = clamp( 1 - airborne / 360, 0.35, 1 );
		shadow.scale.set( baseScale * k );
		shadow.alpha = k;
		shadow.position.set( world.x, groundY + 64 * baseScale );

		// Keep any active balloon hovering above Wapuu's head.
		if ( activeBalloon ) {
			positionBalloon();
		}
	};
	app.ticker.add( tick );

	// ================= LAYOUT / RESIZE =================
	function onResize(): void {
		// Force the renderer to match the (resizeTo) stage now so the
		// dimensions we read below are fresh, not a frame stale.
		try {
			( app as unknown as { resize?: () => void } ).resize?.();
		} catch {
			// Best-effort — the next tick re-runs the pose regardless.
		}
		const first = world.y === 0;
		layout();
		// Always horizontally centred — Wapuu never walks sideways.
		world.x = W() / 2;
		world.y = first ? groundY : clamp( world.y, 0, groundY );
	}
	const ro = new ResizeObserver( () => onResize() );
	ro.observe( stage );
	window.addEventListener( 'resize', onResize );
	onResize();

	// ================= CONTROLLER =================
	return {
		destroy: (): void => {
			app.ticker.remove( tick );
			ro.disconnect();
			window.removeEventListener( 'resize', onResize );
			clearTimeout( zHandle );
			clearTimeout( petEndHandle );
			clearTimeout( happyEyesHandle );
			clearTimeout( advertHandle );
			clearBalloon();
			tweens.length = 0;
			fx.removeChildren().forEach( ( c ) => c.destroy() );
			balloonLayer.remove();
		},
		pet,
		setPointer,
		clearPointer,
		say,
		ask,
		chat,
		getClickTarget,
		getBallMode,
		setBallMode,
		setBallHover,
		jump: hop,
		sleep,
		wake,
	};
}
