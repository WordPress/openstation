/**
 * Desktop Mode — Wapuu widget: animation engine.
 *
 * Ported from the original pet demo's `js/wapuu-pet.js` and retyped
 * against `pixi.js` v8. This is *just the pet*, and he stays put: he
 * breathes, blinks, follows the cursor with his eyes, twitches his
 * ears, wags his tail, hops in place now and then, and dozes off when
 * left alone. Click him for a pet (hearts!).
 *
 * Deliberately removed from the source demo:
 *   - the control dock (wave / spin-ball buttons),
 *   - the stage background (gradient / spotlight / floor),
 *   - grabbing Wapuu and tossing him *inside* the card,
 *   - all horizontal movement (roaming). The whole WIDGET is draggable
 *     instead (framework chrome); Wapuu himself never walks sideways.
 *
 * The vertical JUMP is kept (in place). The tail sway is slowed from
 * the source — see the `tailSpd` note — which whipped "ultra fast" when
 * Wapuu got excited.
 *
 * @since 0.19.0
 */

import type { Application, Container, Graphics, Ticker } from 'pixi.js';
import type { WapuuParts } from './rig';

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

	const shadow: Graphics = new pixi.Graphics();
	const fx: Container = new pixi.Container();
	app.stage.addChild( shadow, root, fx );

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
	let nextJump = rand( 4, 9 );
	const pointer = { x: 0, y: 0, has: false };
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
		spawnHearts( rand( 1, 2 ) );
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
		spawnZ();
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

	// ================= INPUT =================
	// PixiJS processes no pointer events — the framework's transparent
	// chrome overlay sits above the canvas and owns the whole-widget
	// drag. The widget (index.ts) forwards tap=pet + pointer-tracking
	// into these two feeders.
	function setPointer( clientX: number, clientY: number ): void {
		const canvas = app.canvas as unknown as HTMLCanvasElement;
		const r = canvas.getBoundingClientRect();
		// PixiJS global coords are logical (CSS) px under autoDensity, so
		// client-minus-rect maps straight onto the rig's coordinate space.
		pointer.x = clientX - r.left;
		pointer.y = clientY - r.top;
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
			const left = card.getBoundingClientRect().left;
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
			if ( ! asleep && idleTime > 8.5 ) {
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
			// Occasional in-place jump — the only locomotion left.
			nextJump -= dt;
			if ( ! asleep && nextJump <= 0 ) {
				nextJump = rand( 5, 11 );
				hop();
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

		// Eyes: blink scale + cursor look.
		const oy = eyes.open * eyes.blink;
		if ( ! asleep ) {
			const lp = root.toLocal( {
				x: pointer.has ? pointer.x : world.x,
				y: pointer.has ? pointer.y : renderY - 300,
			} );
			eyes.look.x = lerp( eyes.look.x, clamp( lp.x / 320, -1, 1 ) * 5, 0.15 );
			eyes.look.y = lerp(
				eyes.look.y,
				clamp( ( lp.y + 150 ) / 360, -1, 1 ) * 4,
				0.15,
			);
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
		const airborne = clamp( groundY - world.y + hopOffset + petBob, 0, 320 );
		const k = clamp( 1 - airborne / 360, 0.35, 1 );
		shadow.clear();
		shadow
			.ellipse( 0, 0, 118 * baseScale * k, 24 * baseScale * k )
			.fill( { color: 0x2a3550, alpha: 0.2 * k } );
		shadow.position.set( world.x, groundY + 64 * baseScale );
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
			tweens.length = 0;
			fx.removeChildren().forEach( ( c ) => c.destroy() );
		},
		pet,
		setPointer,
		clearPointer,
	};
}
