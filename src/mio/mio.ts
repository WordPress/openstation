/**
 * OpenStation — Mio runtime.
 *
 * Owns the PixiJS application, the simulation loop, the drag
 * interaction, and Mio's awareness of the desk around it.
 * Everything expensive lives in this bundle; the always-on shell only
 * ships `src/mio/controller.ts`.
 *
 * **Coordinate spaces.** The shell reports collision surfaces in
 * viewport coordinates; the Pixi canvas draws in coordinates local to
 * Mio layer. The layer's own `getBoundingClientRect()` is the
 * conversion, refreshed on the same throttle as the surfaces so the
 * two never disagree by a frame.
 *
 * **Why the canvas never takes pointer events.** The layer spans the
 * whole shell. If the canvas were interactive, every click anywhere
 * on the desk would land on Mio instead of the window under
 * it, and toggling `pointer-events` per frame from a hit test races
 * the very click it is meant to route. Instead a small invisible
 * round *handle* element rides on the blob: it is the only
 * interactive part of the layer, so a click one pixel off Mio
 * reaches whatever is underneath, exactly as if Mio weren't
 * there.
 */

import type { Application, Container, Graphics } from 'pixi.js';
import { doAction } from '../hooks';
import {
	clampOutsideChrome,
	collectObstacles,
	findEscape,
	magnetPull,
	type Obstacle,
} from './environment';
import { createPointerTracker, type PointerTracker } from './pointer';
import { drawMio, glowBlurStrength, type MioLayers } from './render';
import {
	closeMioMenu,
	closeMioStylePanel,
	openMioMenu,
} from './style-panel';
import {
	addVelocity,
	createSoftBody,
	presetRimPoints,
	resampleBody,
	resetBody,
	shapeProfile,
	stepSoftBody,
	translateBody,
	type SoftBody,
} from './soft-body';
import type {
	MioConfig,
	MioHandle,
	MioMountOptions,
	MioShapePreset,
} from './types';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

/** How often (ms) the desk is re-measured. */
const SURFACE_REFRESH_MS = 50;

/** Blink timing, in seconds. */
const BLINK_MIN_GAP = 2.6;
const BLINK_MAX_EXTRA = 4.5;
const BLINK_DURATION = 0.14;

/** Handle size relative to the rest radius. */
const HANDLE_SCALE = 2.1;

/** Ambient rotation of the hologram's rake, rad/s. */
const AMBIENT_RAKE_RATE = 0.42;
/** Body speed (layer px/s) at which the rake fully commits to the heading. */
const FULL_RAKE_SPEED = 900;
/** How long a silhouette change takes to ease across, in seconds. */
const MORPH_SECONDS = 2.6;

/**
 * Ceiling on the rim resolution a silhouette may ask for.
 *
 * `presetRimPoints()` is a request, not a demand: `custom` derives its
 * answer from a lobe count a plugin supplies, and nothing else in the
 * shape system bounds it. The simulation is linear in the point count
 * across six passes per sub-step at 240 Hz, so this is the line
 * between "a detailed shape costs a little more" and "a shape config
 * can tax every frame".
 */
const MAX_RIM_POINTS = 64;

/**
 * The stock silhouettes the shuffle draws from.
 *
 * `custom` is deliberately absent: it is a shape someone configured on
 * purpose, and wandering into it at random would be indistinguishable
 * from a bug.
 */
const SHUFFLE_SHAPES: readonly MioShapePreset[] = [
	'circle',
	'blob',
	'ghost',
	'potato',
	'star',
	'flower',
	'heart',
	'diamond',
	'drop',
	'cloud',
];

/**
 * Rake strength of Mio that isn't going anywhere.
 *
 * Not much below the moving value: a hologram sitting still is still a
 * hologram, and a rake that only bites once Mio is thrown makes
 * the effect look like a motion artefact rather than a surface.
 */
const IDLE_RAKE = 0.62;

/**
 * How long Mio has to stay buried inside a window before it
 * hops clear, in seconds.
 *
 * Long enough that Mio flying through a window on a hard throw
 * carries itself out under its own momentum; short enough that a
 * window opening on top of it is corrected before the user reads it
 * as broken.
 */
const TRAPPED_DWELL_S = 0.22;

/**
 * Boot Mio into `options.host`.
 *
 * Resolves `null` (after a console warning) when PixiJS could not be
 * loaded — the shell treats that as "Mio unavailable" and leaves
 * the setting on so it retries on the next page load.
 */
export async function mountMio(
	options: MioMountOptions,
): Promise< MioHandle | null > {
	const api = window.wp?.os;
	if ( api?.loadModules ) {
		try {
			await api.loadModules( [ 'pixijs' ] );
		} catch ( err ) {
			console.warn( '[desktop-mode/mio] PixiJS failed to load.', err );
			return null;
		}
	}
	const pixi = window.PIXI;
	if ( ! pixi ) {
		console.warn(
			'[desktop-mode/mio] window.PIXI is undefined; cannot mount.',
		);
		return null;
	}

	const { host, savePosition } = options;

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: host,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	// The caller may have torn us down while Pixi was initialising.
	if ( ! host.isConnected ) {
		app.destroy( { removeView: true }, { children: true, texture: true } );
		return null;
	}

	let requested = options.config;
	let config = calmed( requested );

	const canvas = app.canvas;
	canvas.style.position = 'absolute';
	canvas.style.inset = '0';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	canvas.style.pointerEvents = 'none';
	host.appendChild( canvas );

	const layers = buildLayers( pixi, app, config );

	// ------------------------------------------------------------------
	// Body.
	// ------------------------------------------------------------------
	const originOf = (): { left: number; top: number } => {
		const r = host.getBoundingClientRect();
		return { left: r.left, top: r.top };
	};
	let origin = originOf();
	const size = (): { width: number; height: number } => ( {
		width: host.clientWidth || 1,
		height: host.clientHeight || 1,
	} );

	const start = options.position
		? { x: options.position.x - origin.left, y: options.position.y - origin.top }
		: defaultStart( size(), config.appearance.radius );

	// ------------------------------------------------------------------
	// Silhouette.
	//
	// Mio picks a new stock shape every `shapeShuffle` seconds
	// and eases into it. The transition is a blend of two rest
	// profiles, not a redraw: the springs are handed the interpolated
	// target and pull the body across, so Mio can be poked,
	// dragged, thrown and landed on a window mid-morph and the shape
	// change simply carries on underneath. That is the whole reason the
	// shape lives in rest lengths.
	// ------------------------------------------------------------------

	/** The silhouette being eased away from, or `null` when settled. */
	let morphFrom: MioShapePreset | null = null;
	/** Seconds elapsed into the current morph. */
	let morphAt = 0;
	/** Seconds until the next shuffle. */
	let nextShuffle = shuffleDelay( config.physics.shapeShuffle );
	/** The silhouette currently being pulled toward. */
	let shape: MioShapePreset = config.physics.shapePreset;

	/**
	 * The rest silhouette, bound to whatever config is live.
	 *
	 * Read through `config` rather than captured, so a `setConfig` that
	 * only changes the shape retargets the springs without rebuilding
	 * the body — Mio morphs into its new shape instead of
	 * popping into it.
	 */
	const profile = ( angle: number ): number => {
		const to = shapeProfile( angle, { ...config.physics, shapePreset: shape } );
		if ( ! morphFrom ) {
			return to;
		}
		const from = shapeProfile( angle, {
			...config.physics,
			shapePreset: morphFrom,
		} );
		return from + ( to - from ) * smoothstep( morphAt / MORPH_SECONDS );
	};

	/**
	 * Rim resolution the silhouettes in play need right now.
	 *
	 * `physics.points` is a **floor, not a ceiling**: a five-pointed
	 * star cannot exist on twelve mass points (see `presetRimPoints`),
	 * so the runtime lends the shape the resolution it needs and takes
	 * it back when the shape goes away. Both ends of a morph are
	 * counted, or the shape being eased away from would be resampled
	 * out from under the blend halfway through the transition.
	 */
	const neededPoints = (): number =>
		Math.min(
			MAX_RIM_POINTS,
			Math.max(
				config.physics.points,
				presetRimPoints( { ...config.physics, shapePreset: shape } ),
				morphFrom
					? presetRimPoints( { ...config.physics, shapePreset: morphFrom } )
					: 0,
			),
		);

	/**
	 * Ease toward a silhouette chosen from outside the shuffle — the
	 * "Make it yours" shape picker, or a plugin calling `setConfig`.
	 *
	 * It cannot be left to {@link updateShape} to notice: that only
	 * adopts `config.physics.shapePreset` when the shuffle is switched
	 * off, so with it on a user's pick would sit unapplied until the
	 * next random change came round. Picking a shape has to show the
	 * shape.
	 *
	 * @param next Silhouette to ease into.
	 */
	const retargetShape = ( next: MioShapePreset ): void => {
		if ( next === shape ) {
			return;
		}
		morphFrom = shape;
		morphAt = 0;
		shape = next;
		// Give the pick its full turn on screen rather than however
		// long was left on a clock the user cannot see.
		nextShuffle = shuffleDelay( config.physics.shapeShuffle );
		doAction( 'os.mio.shape-changed', { shape, from: morphFrom } );
	};

	/** Advance the shuffle clock and the morph in progress. */
	const updateShape = ( seconds: number ): void => {
		if ( morphFrom ) {
			morphAt += seconds;
			if ( morphAt >= MORPH_SECONDS ) {
				morphFrom = null;
				morphAt = 0;
			}
		}
		const every = config.physics.shapeShuffle;
		if ( every <= 0 ) {
			// Switched off mid-session: settle on the configured shape
			// rather than freezing wherever the last shuffle left us.
			// Eased, not snapped — unticking "change shape on its own"
			// while Mio happens to be a star should look like it going
			// home, not like a glitch.
			retargetShape( config.physics.shapePreset );
			nextShuffle = 0;
			return;
		}
		nextShuffle -= seconds;
		if ( nextShuffle > 0 || morphFrom ) {
			return;
		}
		const next = pickShape( shape );
		nextShuffle = shuffleDelay( every );
		if ( next === shape ) {
			return;
		}
		morphFrom = shape;
		morphAt = 0;
		shape = next;
		doAction( 'os.mio.shape-changed', { shape, from: morphFrom } );
	};

	let body: SoftBody = createSoftBody(
		clamp( start.x, config.appearance.radius, size().width - config.appearance.radius ),
		clamp( start.y, config.appearance.radius, size().height - config.appearance.radius ),
		config.appearance.radius,
		neededPoints(),
		profile,
	);

	/**
	 * Densify or coarsen the rim to whatever the current silhouette
	 * needs, preserving the pose. A no-op on the overwhelming majority
	 * of frames — the resolution only moves when a shuffle starts or
	 * finishes.
	 */
	const syncResolution = (): void => {
		const want = neededPoints();
		if ( want !== body.rim.length ) {
			resampleBody( body, want );
		}
	};

	// ------------------------------------------------------------------
	// Interaction handle — see the module header for why the canvas
	// itself stays inert.
	// ------------------------------------------------------------------
	const handle = document.createElement( 'div' );
	handle.className = 'os-mio__handle';
	handle.setAttribute( 'aria-hidden', 'true' );
	sizeHandle( handle, config );
	host.appendChild( handle );

	// ------------------------------------------------------------------
	// State.
	// ------------------------------------------------------------------
	const pointer: PointerTracker = createPointerTracker();
	let obstacles: Obstacle[] = [];
	let lastSurfaceRead = 0;
	let animating = true;
	let destroyed = false;
	let elapsed = 0;
	let nextBlinkAt = BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
	let blinkStartedAt = -1;
	let dragging = false;
	/** Seconds the body has been continuously buried in a window. */
	let trappedFor = 0;
	let dragPointerId: number | null = null;
	let dragTarget: { x: number; y: number } | null = null;
	let dragGrab = { x: 0, y: 0 };

	// Hologram rake — see `chroma.ts`. A slow ambient rotation stands in
	// for a viewer shifting in their seat; Mio's own velocity
	// swings it toward the direction of travel and deepens it, which is
	// what makes the ring's colours run when the blob is thrown and
	// settle again when it stops. The ambient half is gated on
	// `hueDrift`, so `calmed()` zeroing that for reduced motion stills
	// the shimmer here too without a second preference to read.
	let tiltAngle = 0;
	let tilt = { x: 1, y: 0 };
	/** Live `prefers-reduced-motion`, kept current by `onMotionChange`. */
	let reducedMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	/** Smoothed body velocity, layer px/s, for the rake above. */
	let driftVx = 0;
	let driftVy = 0;
	let lastCore = { x: body.core.x, y: body.core.y };

	/**
	 * Forget the body's motion history.
	 *
	 * Called after every teleport — an escape hop, `setPosition`, a
	 * resize clamp, a rebuild. Without it the jump lands in the velocity
	 * EMA below as a several-thousand-px/s "throw" and the ring flares
	 * for half a second over something the user never did.
	 */
	const forgetMotion = (): void => {
		lastCore = { x: body.core.x, y: body.core.y };
	};

	/**
	 * Advance the hologram's rake for one frame.
	 *
	 * The velocity is smoothed hard on purpose: a single frame's
	 * centroid delta is far too noisy to steer a colour effect with, and
	 * every contact bounce would strobe the ring.
	 */
	const updateTilt = ( seconds: number ): void => {
		if ( seconds > 0 ) {
			const vx = ( body.core.x - lastCore.x ) / seconds;
			const vy = ( body.core.y - lastCore.y ) / seconds;
			const blend = Math.min( 1, seconds * 6 );
			driftVx += ( vx - driftVx ) * blend;
			driftVy += ( vy - driftVy ) * blend;
		}
		forgetMotion();

		// The hologram's ambient rake is unsolicited motion, so it stops
		// under reduced motion — and only under reduced motion. It used
		// to be gated on `hueDrift !== 0` as a proxy for that, which
		// worked only for as long as a still ring implied a calmed one.
		// The official Mio holds its hues still by choice, so the proxy
		// now says "reduced motion" about a perfectly ordinary desk.
		if ( ! reducedMotion ) {
			tiltAngle += seconds * AMBIENT_RAKE_RATE;
		}
		let x = Math.cos( tiltAngle );
		let y = Math.sin( tiltAngle );

		const speed = Math.hypot( driftVx, driftVy );
		const lead = Math.min( 1, speed / FULL_RAKE_SPEED );
		if ( speed > 1 ) {
			x = x * ( 1 - lead ) + ( driftVx / speed ) * lead;
			y = y * ( 1 - lead ) + ( driftVy / speed ) * lead;
		}
		const len = Math.hypot( x, y ) || 1;
		const strength = IDLE_RAKE + ( 1 - IDLE_RAKE ) * lead;
		tilt = { x: ( x / len ) * strength, y: ( y / len ) * strength };
	};

	const readSurfaces = ( nowMs: number ): void => {
		if ( nowMs - lastSurfaceRead < SURFACE_REFRESH_MS ) {
			return;
		}
		lastSurfaceRead = nowMs;
		origin = originOf();
		const surfaces = window.wp?.os?.getWallpaperSurfaces?.();
		obstacles = Array.isArray( surfaces )
			? collectObstacles( surfaces, origin, size() )
			: [];
	};

	const toLayer = ( p: { x: number; y: number } ): { x: number; y: number } => ( {
		x: p.x - origin.left,
		y: p.y - origin.top,
	} );

	const toViewport = (): { x: number; y: number } => ( {
		x: body.core.x + origin.left,
		y: body.core.y + origin.top,
	} );

	// ------------------------------------------------------------------
	// Drag.
	//
	// Two things make this feel like picking something up rather than
	// dragging a DOM node:
	//
	//   - The drag target is clamped inside the layer, so Mio
	//     can never be hauled out of the canvas it lives in.
	//   - Release is *never* missed. Pointer capture is the happy
	//     path, but a drop outside the layer, a pointer the browser
	//     cancels mid-gesture, an alt-tab, or a capture that never
	//     took would all otherwise strand `dragging = true` and leave
	//     Mio glued to a cursor it can no longer see. Window-
	//     level `pointerup` / `pointercancel` / `blur` plus
	//     `lostpointercapture` close every one of those doors.
	// ------------------------------------------------------------------

	/** Recent pointer velocity, layer px/s, for the throw on release. */
	let flickVx = 0;
	let flickVy = 0;
	let lastDragAt = 0;
	let lastDragPoint: { x: number; y: number } | null = null;

	const nowMs = (): number =>
		typeof performance !== 'undefined' ? performance.now() : elapsed * 1000;

	const clampTarget = ( p: { x: number; y: number } ): { x: number; y: number } => {
		const bounds = size();
		const r = body.radius;
		// Chrome first, layer bounds last: the dock push is the one that
		// can send the target somewhere illegal (a rail on the far side
		// of a narrow layer), and the bounds clamp is what catches it.
		const clear = clampOutsideChrome( p, r, obstacles );
		return {
			x: clamp( clear.x, r, Math.max( r, bounds.width - r ) ),
			y: clamp( clear.y, r, Math.max( r, bounds.height - r ) ),
		};
	};

	const onHandleDown = ( e: PointerEvent ): void => {
		if ( dragging || e.button !== 0 ) {
			return;
		}
		dragging = true;
		dragPointerId = e.pointerId;
		// Grab offset: Mio keeps its position relative to the
		// cursor instead of snapping its centre under it.
		const local = toLayer( { x: e.clientX, y: e.clientY } );
		dragGrab = { x: body.core.x - local.x, y: body.core.y - local.y };
		dragTarget = { x: body.core.x, y: body.core.y };
		flickVx = 0;
		flickVy = 0;
		lastDragAt = nowMs();
		lastDragPoint = { x: local.x, y: local.y };
		handle.classList.add( 'is-dragging' );
		try {
			handle.setPointerCapture( e.pointerId );
		} catch {
			/* Capture is a nicety; the window-level fallbacks cover it. */
		}
		e.preventDefault();
		doAction( 'os.mio.grabbed', { position: toViewport() } );
	};

	const onDragMove = ( e: PointerEvent ): void => {
		if ( ! dragging || e.pointerId !== dragPointerId ) {
			return;
		}
		const local = toLayer( { x: e.clientX, y: e.clientY } );
		dragTarget = clampTarget( {
			x: local.x + dragGrab.x,
			y: local.y + dragGrab.y,
		} );

		// Exponential moving average of the hand's velocity. A single
		// last-two-points sample is far too noisy to throw with — one
		// stationary frame at release and the flick dies.
		const at = nowMs();
		const dt = ( at - lastDragAt ) / 1000;
		if ( lastDragPoint && dt > 0.001 ) {
			const vx = ( local.x - lastDragPoint.x ) / dt;
			const vy = ( local.y - lastDragPoint.y ) / dt;
			const blend = Math.min( 1, dt * 12 );
			flickVx += ( vx - flickVx ) * blend;
			flickVy += ( vy - flickVy ) * blend;
		}
		lastDragAt = at;
		lastDragPoint = local;
	};

	/**
	 * Finish a drag. `throwIt` is false for the paranoid fallbacks
	 * (window blur, lost capture) where we have no idea what the hand
	 * was doing — dropping it in place beats launching it somewhere
	 * the user didn't ask for.
	 */
	const finishDrag = ( throwIt: boolean ): void => {
		if ( ! dragging ) {
			return;
		}
		dragging = false;
		const pointerId = dragPointerId;
		dragPointerId = null;
		dragTarget = null;
		lastDragPoint = null;
		handle.classList.remove( 'is-dragging' );
		if ( pointerId !== null ) {
			try {
				handle.releasePointerCapture( pointerId );
			} catch {
				/* Already released, or never captured. */
			}
		}

		// The throw. Without this Mio inherits only whatever
		// velocity the drag spring happened to hold, which is always
		// short of the hand — flicks land dead.
		if ( throwIt ) {
			const boost = config.physics.throwBoost;
			// Clamp so a jittery trackpad sample can't fire the
			// Mio across the desk at 20,000 px/s.
			const maxSpeed = 4000;
			const speed = Math.hypot( flickVx, flickVy );
			const scale =
				speed > maxSpeed ? ( maxSpeed / speed ) * boost : boost;
			addVelocity( body, flickVx * scale, flickVy * scale );
		}
		flickVx = 0;
		flickVy = 0;

		const dropped = toViewport();
		savePosition( dropped );
		doAction( 'os.mio.dropped', { position: dropped } );
	};

	const onDragEnd = ( e: PointerEvent ): void => {
		if ( ! dragging || e.pointerId !== dragPointerId ) {
			return;
		}
		finishDrag( true );
	};

	const onDragCancel = ( e: PointerEvent ): void => {
		if ( ! dragging || e.pointerId !== dragPointerId ) {
			return;
		}
		finishDrag( false );
	};

	const onLostCapture = (): void => finishDrag( true );
	const onWindowBlur = (): void => finishDrag( false );

	/**
	 * Right-click opens Mio's own menu.
	 *
	 * Bound to the handle, which is the only part of the layer that
	 * takes pointer events — the canvas is inert by design, so a
	 * right-click one pixel off Mio still reaches the wallpaper and
	 * gets the desk's menu, exactly as if Mio weren't there.
	 */
	const onHandleContextMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		e.stopPropagation();
		openMioMenu( { x: e.clientX, y: e.clientY } );
	};

	handle.addEventListener( 'pointerdown', onHandleDown );
	handle.addEventListener( 'contextmenu', onHandleContextMenu );
	handle.addEventListener( 'lostpointercapture', onLostCapture );
	// Window-level, capture phase: these fire wherever the pointer
	// ends up — over an iframe, over the dock, off the layer entirely.
	window.addEventListener( 'pointermove', onDragMove, true );
	window.addEventListener( 'pointerup', onDragEnd, true );
	window.addEventListener( 'pointercancel', onDragCancel, true );
	window.addEventListener( 'blur', onWindowBlur );

	// ------------------------------------------------------------------
	// Frame.
	// ------------------------------------------------------------------
	const tick = (): void => {
		if ( destroyed || ! animating ) {
			return;
		}
		const dtMs = app.ticker.deltaMS;
		const seconds = Math.min( dtMs, 100 ) / 1000;
		elapsed += seconds;

		readSurfaces(
			typeof performance !== 'undefined' ? performance.now() : elapsed * 1000,
		);

		const bounds = size();

		// Trapped? A window opened, moved, or maximised over the
		// Mio. The contact solver can't dig its way out of that —
		// rim points on opposite sides get pushed toward opposite
		// faces and the silhouette tears — so hop out of the whole
		// window cluster and re-form clean.
		//
		// Two guards keep this from firing on things that aren't
		// engulfment. `findEscape` requires real depth, so resting in
		// a corner (where the centroid routinely dips a few pixels
		// past an edge) doesn't count. And the condition has to hold
		// for TRAPPED_DWELL_S, so Mio thrown *through* a window
		// rides its own momentum out instead of being teleported
		// mid-flight.
		if ( ! dragging ) {
			const escape = findEscape(
				body.core.x,
				body.core.y,
				body.radius,
				obstacles,
				bounds,
			);
			if ( escape ) {
				trappedFor += seconds;
				if ( trappedFor >= TRAPPED_DWELL_S ) {
					trappedFor = 0;
					resetBody( body, escape.x, escape.y );
					forgetMotion();
					savePosition( toViewport() );
					doAction( 'os.mio.displaced', {
						position: toViewport(),
					} );
				}
			} else {
				trappedFor = 0;
			}
		} else {
			trappedFor = 0;
		}

		// While dragging, the user's hand overrides the desk: no
		// magnet, so the blob trails the cursor instead of being
		// yanked sideways by whatever window it passes over.
		const magnet = dragging
			? null
			: magnetPull(
				body.core.x,
				body.core.y,
				body.radius,
				obstacles,
				config.physics.magnetRange,
			);

		stepSoftBody( body, seconds, {
			physics: config.physics,
			magnet,
			// Windows stay solid even while you're dragging: the
			// Mio lives ON the desk, and being able to shove it
			// inside a window reads as the physics giving up. The
			// crush that used to cause is handled at the source
			// instead, by `physics.dragMaxAccel` bounding how hard
			// the drag spring can press the body into something it
			// cannot pass through.
			obstacles,
			bounds,
			dragTarget,
		} );

		updateTilt( seconds );
		updateShape( seconds );
		syncResolution();

		// Blink schedule.
		if ( blinkStartedAt < 0 && elapsed >= nextBlinkAt ) {
			blinkStartedAt = elapsed;
		}
		let blink = 0;
		if ( blinkStartedAt >= 0 ) {
			const t = ( elapsed - blinkStartedAt ) / BLINK_DURATION;
			if ( t >= 1 ) {
				blinkStartedAt = -1;
				nextBlinkAt = elapsed + BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
			} else {
				blink = Math.sin( t * Math.PI );
			}
		}

		const cursor = pointer.get();
		drawMio(
			layers,
			{
				rim: body.rim,
				centre: body.core,
				radius: body.radius,
				elapsed,
				gaze: cursor ? toLayer( cursor ) : null,
				blink,
				tilt,
			},
			config.appearance,
		);

		// Ride the handle on the body. Anchored on the *rim centroid*,
		// not the rest position, so a squashed or mid-throw Mio is
		// still grabbable where it actually looks like it is.
		const half = ( body.radius * HANDLE_SCALE ) / 2;
		handle.style.transform = `translate3d(${ body.core.x - half }px, ${
			body.core.y - half
		}px, 0)`;
	};

	app.ticker.add( tick );

	// ------------------------------------------------------------------
	// Resize + visibility.
	// ------------------------------------------------------------------
	const resizeObserver = new ResizeObserver( () => {
		if ( destroyed ) {
			return;
		}
		// A detached or hidden host reports zero, and `size()` floors
		// that to 1 so the renderer never sees a zero dimension. Clamping
		// the body into a 1×1 layer parks it at (radius, radius) — the
		// top-left corner — and because the drop is persisted, Mio comes
		// back there on the next enable. There is nothing meaningful to
		// clamp into while the layer is off screen, so don't.
		if (
			! host.isConnected ||
			host.clientWidth <= 0 ||
			host.clientHeight <= 0
		) {
			return;
		}
		const { width, height } = size();
		app.renderer.resize( width, height );
		origin = originOf();
		// Pull Mio back inside a shrunken shell.
		const r = body.radius;
		const x = clamp( body.core.x, r, Math.max( r, width - r ) );
		const y = clamp( body.core.y, r, Math.max( r, height - r ) );
		if ( x !== body.core.x || y !== body.core.y ) {
			translateBody( body, x, y );
			forgetMotion();
		}
	} );
	resizeObserver.observe( host );

	const onVisibility = (): void => {
		setAnimating( ! document.hidden );
	};
	document.addEventListener( 'visibilitychange', onVisibility );

	// Reduced motion can be toggled mid-session (OS setting, dev
	// tools). Re-derive the calmed config when it flips rather than
	// only reading it at mount.
	const motionQuery =
		typeof window.matchMedia === 'function'
			? window.matchMedia( '(prefers-reduced-motion: reduce)' )
			: null;
	const onMotionChange = (): void => {
		reducedMotion = motionQuery?.matches === true;
		config = calmed( requested );
	};
	motionQuery?.addEventListener?.( 'change', onMotionChange );

	function setAnimating( next: boolean ): void {
		if ( destroyed || animating === next ) {
			return;
		}
		animating = next;
		if ( next ) {
			// Drop the backlog so a tab that was hidden for a minute
			// doesn't resume with a giant catch-up step.
			body.accumulator = 0;
			app.ticker.start();
		} else {
			app.ticker.stop();
		}
	}

	doAction( 'os.mio.mounted', { position: toViewport() } );

	return {
		getPosition: () => toViewport(),
		setPosition: ( x: number, y: number ) => {
			const bounds = size();
			const r = body.radius;
			translateBody(
				body,
				clamp( x - origin.left, r, Math.max( r, bounds.width - r ) ),
				clamp( y - origin.top, r, Math.max( r, bounds.height - r ) ),
			);
			forgetMotion();
			savePosition( toViewport() );
		},
		setAnimating,
		applyConfig: ( next: MioConfig ) => {
			requested = next;
			const calm = calmed( next );
			const rebuild =
				calm.physics.points !== config.physics.points ||
				calm.appearance.radius !== config.appearance.radius;
			const pickedShape =
				calm.physics.shapePreset !== config.physics.shapePreset
					? calm.physics.shapePreset
					: null;
			config = calm;
			if ( pickedShape ) {
				retargetShape( pickedShape );
			}
			applyGlow( pixi, layers, config );
			applySheenBlur( pixi, layers, config );
			sizeHandle( handle, config );
			if ( rebuild ) {
				const at = { x: body.core.x, y: body.core.y };
				body = createSoftBody(
					at.x,
					at.y,
					config.appearance.radius,
					neededPoints(),
					profile,
				);
				forgetMotion();
			} else {
				// A config that only changed the silhouette retargets the
				// springs rather than rebuilding — but the new shape may
				// want a finer rim than the old one, and waiting for the
				// next tick would morph the first frames at the old
				// resolution.
				syncResolution();
			}
		},
		destroy: () => {
			if ( destroyed ) {
				return;
			}
			destroyed = true;
			// Only persist a position that still means something. The
			// teardown runs a frame after the layer is detached, and a
			// position derived from a detached host's origin is fiction.
			// The caller records where Mio was before detaching it.
			if ( host.isConnected ) {
				savePosition( toViewport() );
			}
			app.ticker.remove( tick );
			resizeObserver.disconnect();
			document.removeEventListener( 'visibilitychange', onVisibility );
			motionQuery?.removeEventListener?.( 'change', onMotionChange );
			handle.removeEventListener( 'pointerdown', onHandleDown );
			handle.removeEventListener( 'contextmenu', onHandleContextMenu );
			handle.removeEventListener( 'lostpointercapture', onLostCapture );
			closeMioMenu();
			closeMioStylePanel();
			window.removeEventListener( 'pointermove', onDragMove, true );
			window.removeEventListener( 'pointerup', onDragEnd, true );
			window.removeEventListener( 'pointercancel', onDragCancel, true );
			window.removeEventListener( 'blur', onWindowBlur );
			handle.remove();
			pointer.destroy();
			// NEVER `destroy( true )` — that runs Pixi's
			// `releaseGlobalResources()` and corrupts every other live
			// Application on the page (the active wallpaper, the
			// content graph, OS Settings previews).
			app.destroy( { removeView: true }, { children: true, texture: true } );
			doAction( 'os.mio.unmounted', {} );
		},
	};
}

/**
 * Strip Mio's *ambient* motion when the user has asked for
 * reduced motion: no idle bob, no sway, no hue shimmer.
 *
 * Motion the user causes — a drag, a fall onto a window they just
 * opened, the squash on landing — is deliberately kept. WCAG's
 * concern is unsolicited animation, and a companion that refuses to
 * move when you pick it up isn't accessible, it's broken. A user who
 * wants none of it switches Mio off in the same menu they
 * switched it on.
 */
function calmed( config: MioConfig ): MioConfig {
	const reduce =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	if ( ! reduce ) {
		return config;
	}
	return {
		// Both ways the ring can move on its own: rewriting the hues,
		// and turning the gradient around the ring. Neither is
		// something the user asked for.
		appearance: { ...config.appearance, hueDrift: 0, hueSpin: 0 },
		// The silhouette shuffle goes with the bob and the shimmer: a
		// Mio that reshapes itself while you are reading is textbook
		// unsolicited animation.
		physics: { ...config.physics, floatAmplitude: 0, shapeShuffle: 0 },
	};
}

/** Build the five stacked Graphics layers. */
function buildLayers(
	pixi: typeof import( 'pixi.js' ),
	app: Application,
	config: MioConfig,
): MioLayers {
	const root: Container = new pixi.Container();
	const halo: Graphics = new pixi.Graphics();
	const bloom: Graphics = new pixi.Graphics();
	const body: Graphics = new pixi.Graphics();
	const sheen: Graphics = new pixi.Graphics();
	const core: Graphics = new pixi.Graphics();
	const eyes: Graphics = new pixi.Graphics();

	// These three hold only while the layer is unfiltered — `halo` and
	// `sheen` both take a blur, and a filter cancels the container's
	// blend mode outright. The filters restate it themselves; see
	// {@link GLOW_BLEND} for why that is not optional.
	halo.blendMode = 'add';
	bloom.blendMode = 'add';
	// Additive over the black fill: the sheen can only ever *lift* the
	// interior toward colour, never darken or wash it out.
	sheen.blendMode = 'add';

	root.addChild( halo );
	root.addChild( bloom );
	root.addChild( body );
	root.addChild( sheen );
	root.addChild( core );
	root.addChild( eyes );
	app.stage.addChild( root );

	const layers: MioLayers = { root, halo, bloom, body, sheen, core, eyes };
	applyGlow( pixi, layers, config );
	applySheenBlur( pixi, layers, config );
	return layers;
}

/**
 * Blend mode every filter in this module has to be told about.
 *
 * **A filter silently cancels its layer's blend mode.** `halo` and
 * `sheen` both set `blendMode = 'add'` on the Graphics, and that holds
 * right up until a filter is attached. From then on Pixi renders the
 * layer to a texture and composites that texture with
 * `filter._state.blendMode` — see `FilterSystem.applyFilter`, which
 * draws with `state: filter._state` and never consults the container.
 * `Filter.defaultOptions.blendMode` is `'normal'`, so the layer's own
 * `'add'` is dropped on the floor the moment the blur goes on.
 *
 * That is not a subtle difference for a glow. Additive over a dark
 * desk is light spilling onto the wallpaper; the same band under
 * normal alpha is a flat translucent slab of colour with a visible
 * boundary — a sticker, not a light source. It also makes the filter
 * region's own edge legible, which is where the straight-sided
 * rectangles came from.
 *
 * `BlurFilter` forwards unknown options to `Filter` and its `apply()`
 * assigns `this.blendMode` to the *final* pass (the intermediate one
 * is forced to `'normal'`, which is correct), so passing it here is
 * all that is needed.
 */
const GLOW_BLEND = 'add';

/**
 * Attach (or remove) the blur on the two glow passes.
 *
 * Both, not just the halo: each is drawn as a ramp of concentric
 * shells, and a flat shell against a flat shell is a hard edge. Left
 * crisp, the bloom draws its handful of contour rings inside the
 * halo's smooth wash. The tube stays sharp either way — that is
 * `core`, which is never filtered.
 *
 * Guarded: a trimmed Pixi build without `BlurFilter` still renders a
 * perfectly good Mio, just with a crisper glow.
 */
function applyGlow(
	pixi: typeof import( 'pixi.js' ),
	layers: MioLayers,
	config: MioConfig,
): void {
	const want = config.appearance.glowBlur && config.appearance.glow > 0;
	if ( ! want || typeof pixi.BlurFilter !== 'function' ) {
		layers.halo.filters = [];
		layers.bloom.filters = [];
		return;
	}
	const strength = glowBlurStrength(
		config.appearance.radius,
		config.appearance.glow,
	);
	for ( const [ layer, blur ] of [
		[ layers.halo, strength.halo ],
		[ layers.bloom, strength.bloom ],
	] as const ) {
		try {
			layer.filters = [
				new pixi.BlurFilter( {
					strength: blur,
					quality: 2,
					// Without this the pass stops being additive. See
					// {@link GLOW_BLEND}.
					blendMode: GLOW_BLEND,
				} ),
			];
		} catch {
			layer.filters = [];
		}
	}
}

/**
 * Blur the interior sheen.
 *
 * The sheen is a handful of flat concentric shells, and a flat shell
 * against a flat shell is a hard edge. Unblurred, that reads as
 * contour lines drawn inside Mio, which caps how bright the
 * sheen can get before the banding gives it away. Blurring the layer
 * dissolves the radial steps and the angular facets both, so the
 * shells can be few, coarse, and actually visible.
 *
 * Scaled off the radius rather than fixed: a kiosk-sized Mio needs
 * a proportionally wider blur to hide the same number of shells.
 *
 * Guarded the same way {@link applyGlow} is — a trimmed Pixi build
 * without `BlurFilter` gets a faintly banded sheen, not a broken
 * Mio.
 */
function applySheenBlur(
	pixi: typeof import( 'pixi.js' ),
	layers: MioLayers,
	config: MioConfig,
): void {
	const want = config.appearance.iridescence > 0;
	if ( ! want || typeof pixi.BlurFilter !== 'function' ) {
		layers.sheen.filters = [];
		return;
	}
	try {
		layers.sheen.filters = [
			new pixi.BlurFilter( {
				strength: Math.min(
					24,
					Math.max( 3, config.appearance.radius * 0.12 ),
				),
				quality: 2,
				// Same trap as the halo, and the same fix. The sheen is
				// only ever meant to *lift* the black interior toward
				// colour; under normal alpha it washes it out instead.
				// See {@link GLOW_BLEND}.
				blendMode: GLOW_BLEND,
			} ),
		];
	} catch {
		layers.sheen.filters = [];
	}
}

/** Size the drag handle to the current rest radius. */
function sizeHandle( handle: HTMLElement, config: MioConfig ): void {
	const px = `${ config.appearance.radius * HANDLE_SCALE }px`;
	handle.style.width = px;
	handle.style.height = px;
}

/**
 * First-run position: floating near the inline-start edge, a third of
 * the way up from the bottom — clear of the dock rail and of the
 * widget column on the opposite side.
 */
function defaultStart(
	bounds: { width: number; height: number },
	radius: number,
): { x: number; y: number } {
	return {
		x: clamp( bounds.width * 0.22, radius, bounds.width - radius ),
		y: clamp( bounds.height * 0.62, radius, bounds.height - radius ),
	};
}

function clamp( v: number, lo: number, hi: number ): number {
	return Math.min( Math.max( v, lo ), Math.max( lo, hi ) );
}

/** Smoothstep, so a morph eases out of one shape and into the next. */
function smoothstep( t: number ): number {
	const x = Math.min( 1, Math.max( 0, t ) );
	return x * x * ( 3 - 2 * x );
}

/**
 * How long to wait before the next shuffle.
 *
 * Jittered by ±25% so Mio that has been on screen for an hour is
 * still not something the eye can anticipate — a change exactly every
 * sixty seconds reads as a timer, which is the opposite of alive.
 */
function shuffleDelay( every: number ): number {
	return every > 0 ? every * ( 0.75 + Math.random() * 0.5 ) : 0;
}

/** A stock silhouette that isn't the one already showing. */
function pickShape( current: MioShapePreset ): MioShapePreset {
	const options = SHUFFLE_SHAPES.filter( ( s ) => s !== current );
	return options[ Math.floor( Math.random() * options.length ) ] ?? current;
}
