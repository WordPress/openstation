import type { Application, Container, Graphics } from 'pixi.js';
import { doAction } from '../hooks';
import { resizeMioCanvas } from './canvas-resize';
import { advanceMioThinking, mioThinkingExpression } from './thinking';
import {
	chromeOnly,
	clampOutsideChrome,
	collectObstacles,
	findEscape,
	magnetPull,
	type Obstacle,
} from './environment';
import { createObstacleTrack } from './obstacle-track';
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

const SURFACE_REFRESH_MS = 50;

const BLINK_MIN_GAP = 2.6;
const BLINK_MAX_EXTRA = 4.5;
const BLINK_DURATION = 0.14;

const HANDLE_SCALE = 2.1;

const AMBIENT_RAKE_RATE = 0.42;

const FULL_RAKE_SPEED = 900;

const MORPH_SECONDS = 2.6;

const MAX_RIM_POINTS = 64;

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

const IDLE_RAKE = 0.62;

const TRAPPED_DWELL_S = 0.22;

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

	let morphFrom: MioShapePreset | null = null;

	let morphAt = 0;

	let nextShuffle = shuffleDelay( config.physics.shapeShuffle );

	let shape: MioShapePreset = config.physics.shapePreset;

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

	const retargetShape = ( next: MioShapePreset ): void => {
		if ( next === shape ) {
			return;
		}
		morphFrom = shape;
		morphAt = 0;
		shape = next;

		nextShuffle = shuffleDelay( config.physics.shapeShuffle );
		doAction( 'os.mio.shape-changed', { shape, from: morphFrom } );
	};

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

	const syncResolution = (): void => {
		const want = neededPoints();
		if ( want !== body.rim.length ) {
			resampleBody( body, want );
		}
	};

	const handle = document.createElement( 'div' );
	handle.className = 'os-mio__handle';
	handle.setAttribute( 'aria-hidden', 'true' );
	sizeHandle( handle, config );
	host.appendChild( handle );

	const pointer: PointerTracker = createPointerTracker();
	const desk = createObstacleTrack( SURFACE_REFRESH_MS );
	let obstacles: readonly Obstacle[] = [];
	let lastSurfaceRead = 0;
	let animating = true;
	let destroyed = false;
	let elapsed = 0;
	let nextBlinkAt = BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
	let blinkStartedAt = -1;
	let dragging = false;
	let anchor: { x: number; y: number } | null = null;

	let floating = false;
	let persistentAnchor = false;

	let trappedFor = 0;
	let dragPointerId: number | null = null;
	let dragTarget: { x: number; y: number } | null = null;
	let dragGrab = { x: 0, y: 0 };

	let tiltAngle = 0;
	let thinking = 0;
	let tilt = { x: 1, y: 0 };

	let reducedMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	let driftVx = 0;
	let driftVy = 0;
	let lastCore = { x: body.core.x, y: body.core.y };

	const forgetMotion = (): void => {
		lastCore = { x: body.core.x, y: body.core.y };
	};

	const updateTilt = ( seconds: number ): void => {
		if ( seconds > 0 ) {
			const vx = ( body.core.x - lastCore.x ) / seconds;
			const vy = ( body.core.y - lastCore.y ) / seconds;
			const blend = Math.min( 1, seconds * 6 );
			driftVx += ( vx - driftVx ) * blend;
			driftVy += ( vy - driftVy ) * blend;
		}
		forgetMotion();

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
		if ( host.dataset.mioWindow ) {
			origin = originOf();
			desk.reset();
			obstacles = [];
			return;
		}
		if ( nowMs - lastSurfaceRead >= SURFACE_REFRESH_MS ) {
			lastSurfaceRead = nowMs;
			origin = originOf();
			const surfaces = window.wp?.os?.getWallpaperSurfaces?.();
			desk.sample(
				Array.isArray( surfaces )
					? collectObstacles( surfaces, origin, size() )
					: [],
				nowMs,
			);
		}
		obstacles = desk.at( nowMs );
	};

	const toLayer = ( p: { x: number; y: number } ): { x: number; y: number } => ( {
		x: p.x - origin.left,
		y: p.y - origin.top,
	} );

	const toViewport = (): { x: number; y: number } => ( {
		x: body.core.x + origin.left,
		y: body.core.y + origin.top,
	} );

	let flickVx = 0;
	let flickVy = 0;
	let lastDragAt = 0;
	let lastDragPoint: { x: number; y: number } | null = null;

	const nowMs = (): number =>
		typeof performance !== 'undefined' ? performance.now() : elapsed * 1000;

	const clampTarget = ( p: { x: number; y: number } ): { x: number; y: number } => {
		const bounds = size();
		const r = body.radius;

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
		if ( ! persistentAnchor ) {
			anchor = null;
		}
		dragPointerId = e.pointerId;

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

			}
		}

		if ( throwIt ) {
			const boost = config.physics.throwBoost;

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

	const onHandleContextMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		e.stopPropagation();
		openMioMenu( { x: e.clientX, y: e.clientY } );
	};

	handle.addEventListener( 'pointerdown', onHandleDown );
	handle.addEventListener( 'contextmenu', onHandleContextMenu );
	handle.addEventListener( 'lostpointercapture', onLostCapture );

	window.addEventListener( 'pointermove', onDragMove, true );
	window.addEventListener( 'pointerup', onDragEnd, true );
	window.addEventListener( 'pointercancel', onDragCancel, true );
	window.addEventListener( 'blur', onWindowBlur );

	let blink = 0;
	const paint = (): void => {
		const cursor = pointer.get();
		const expression = mioThinkingExpression(
			{
				rim: body.rim,
				centre: body.core,
				radius: body.radius,
				elapsed,
				gaze: cursor ? toLayer( cursor ) : null,
				blink,
				tilt,
			},
			config.appearance, thinking, reducedMotion,
		);
		drawMio( layers, expression.frame, expression.appearance );

		const half = ( body.radius * HANDLE_SCALE ) / 2;
		handle.style.transform = `translate3d(${ body.core.x - half }px, ${
			body.core.y - half
		}px, 0)`;
	};

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

		const solid = floating ? chromeOnly( obstacles ) : obstacles;

		if ( ! dragging ) {
			const escape = findEscape(
				body.core.x,
				body.core.y,
				body.radius,
				solid,
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

		const magnet = dragging || floating
			? null
			: magnetPull(
				body.core.x,
				body.core.y,
				body.radius,
				solid,
				config.physics.magnetRange,
			);

		stepSoftBody( body, seconds, {
			physics: config.physics,
			magnet,

			obstacles: solid,
			bounds,
			dragTarget,
			anchor: dragging ? null : anchor,
		} );

		updateTilt( seconds );
		updateShape( seconds );
		syncResolution();

		if ( blinkStartedAt < 0 && elapsed >= nextBlinkAt ) {
			blinkStartedAt = elapsed;
		}
		blink = 0;
		if ( blinkStartedAt >= 0 ) {
			const t = ( elapsed - blinkStartedAt ) / BLINK_DURATION;
			if ( t >= 1 ) {
				blinkStartedAt = -1;
				nextBlinkAt = elapsed + BLINK_MIN_GAP + Math.random() * BLINK_MAX_EXTRA;
			} else {
				blink = Math.sin( t * Math.PI );
			}
		}

		thinking = advanceMioThinking( thinking, host.dataset.mioThinking === 'true', seconds, reducedMotion );
		paint();
	};

	app.ticker.add( tick );

	const resizeObserver = new ResizeObserver( () => {
		if ( destroyed ) {
			return;
		}

		if (
			! host.isConnected ||
			host.clientWidth <= 0 ||
			host.clientHeight <= 0
		) {
			return;
		}
		const { width, height } = size();
		resizeMioCanvas( app, { width, height }, () => {
			origin = originOf();

			desk.reset();

			const r = body.radius;
			const x = clamp( body.core.x, r, Math.max( r, width - r ) );
			const y = clamp( body.core.y, r, Math.max( r, height - r ) );
			if ( x !== body.core.x || y !== body.core.y ) {
				translateBody( body, x, y );
				forgetMotion();
			}
			paint();
		} );
	} );
	resizeObserver.observe( host );

	const onVisibility = (): void => {
		setAnimating( ! document.hidden );
	};
	document.addEventListener( 'visibilitychange', onVisibility );

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
			anchor = null;
			origin = originOf();
			desk.reset();
			obstacles = [];
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
		setFloating: ( next: boolean ) => {
			floating = next;
		},
		setAnchor: ( position, persistent = true ) => {
			origin = originOf();
			anchor = position ? toLayer( position ) : null;
			persistentAnchor = persistent;
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
				syncResolution();
			}
		},
		destroy: () => {
			if ( destroyed ) {
				return;
			}
			destroyed = true;

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

			app.destroy( { removeView: true }, { children: true, texture: true } );
			doAction( 'os.mio.unmounted', {} );
		},
	};
}

function calmed( config: MioConfig ): MioConfig {
	const reduce =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	if ( ! reduce ) {
		return config;
	}
	return {

		appearance: { ...config.appearance, hueDrift: 0, hueSpin: 0 },

		physics: { ...config.physics, floatAmplitude: 0, shapeShuffle: 0 },
	};
}

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
	const liner: Graphics = new pixi.Graphics();
	const core: Graphics = new pixi.Graphics();
	const eyes: Graphics = new pixi.Graphics();

	halo.blendMode = 'add';
	bloom.blendMode = 'add';

	sheen.blendMode = 'add';

	root.addChild( halo );
	root.addChild( bloom );
	root.addChild( body );
	root.addChild( sheen );

	root.addChild( liner );
	root.addChild( core );
	root.addChild( eyes );
	app.stage.addChild( root );

	const layers: MioLayers = {
		root,
		halo,
		bloom,
		body,
		sheen,
		liner,
		core,
		eyes,
	};
	applyGlow( pixi, layers, config );
	applySheenBlur( pixi, layers, config );
	return layers;
}

const GLOW_BLEND = 'add';

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

					blendMode: GLOW_BLEND,
				} ),
			];
		} catch {
			layer.filters = [];
		}
	}
}

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

				blendMode: GLOW_BLEND,
			} ),
		];
	} catch {
		layers.sheen.filters = [];
	}
}

function sizeHandle( handle: HTMLElement, config: MioConfig ): void {
	const px = `${ config.appearance.radius * HANDLE_SCALE }px`;
	handle.style.width = px;
	handle.style.height = px;
}

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

function smoothstep( t: number ): number {
	const x = Math.min( 1, Math.max( 0, t ) );
	return x * x * ( 3 - 2 * x );
}

function shuffleDelay( every: number ): number {
	return every > 0 ? every * ( 0.75 + Math.random() * 0.5 ) : 0;
}

function pickShape( current: MioShapePreset ): MioShapePreset {
	const options = SHUFFLE_SHAPES.filter( ( s ) => s !== current );
	return options[ Math.floor( Math.random() * options.length ) ] ?? current;
}
