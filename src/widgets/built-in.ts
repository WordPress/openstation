/**
 * Desktop Mode — Built-in widgets.
 *
 * Ships one widget on first run: a PixiJS analog wall clock. The
 * face, bezel, ticks, hands, and a cursor-tracking specular highlight
 * are all drawn into a WebGL canvas; PIXI is lazy-loaded the first
 * time the widget mounts so users who never enable widgets pay none
 * of the bytes.
 *
 * If PIXI fails to load (CSP, no WebGL, offline) the widget falls
 * back to a DOM-only digital readout — a clock that can't render is
 * still a clock.
 *
 * @since 0.7.0
 */

import { __ } from '../i18n';
import { loadModules } from '../modules/registry';
import * as registry from './registry';
import type { WidgetDef } from './types';

/**
 * PixiJS types. The package is NOT bundled — `loadModules(['pixijs'])`
 * injects the vendored `pixi.min.js` and attaches `window.PIXI`. Typing
 * the global lets every class access (`pixi.Application`, …) be
 * checked against the library's first-party definitions with zero
 * runtime overhead.
 */
import type { Application, Container, Graphics, Text } from 'pixi.js';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

/**
 * Visual / motion tuning. Pulled out so a future "more saturated" or
 * "calmer" preset is a one-line change rather than a hunt through
 * the draw routine.
 */
const CONFIG = {
	/** Outer-ring stroke as a fraction of clock radius. */
	ringWidth: 0.045,
	/** Hour tick length / minute tick length, fraction of radius. */
	hourTickLen: 0.11,
	minuteTickLen: 0.045,
	/** Hand widths in CSS pixels at the reference 220px clock. */
	hourHandWidth: 7,
	minuteHandWidth: 5,
	secondHandWidth: 2,
	/** Hand lengths as fraction of radius. */
	hourHandLen: 0.5,
	minuteHandLen: 0.74,
	secondHandLen: 0.82,
	/** Red second-hand counterweight length, fraction of radius. */
	secondCounterLen: 0.18,
	/** Max parallax tilt in CSS pixels at the corners of the stage. */
	parallaxRange: 8,
	/** Lerp factor per frame for parallax — lower = smoother / slower. */
	parallaxLerp: 0.12,
	/** Specular highlight radius, fraction of clock radius. */
	highlightRadius: 0.55,
	/** Highlight alpha when cursor is inside the face. */
	highlightAlpha: 0.22,
};

/**
 * Cardinal numerals (12, 3, 6, 9). Drawn larger than the hour ticks
 * to anchor the eye; the other 8 hours are tick-only so the face
 * doesn't read as cluttered at small widget sizes.
 */
const CARDINALS: Array<{ hour: 12 | 3 | 6 | 9; label: string }> = [
	{ hour: 12, label: '12' },
	{ hour: 3, label: '3' },
	{ hour: 6, label: '6' },
	{ hour: 9, label: '9' },
];

const clock: WidgetDef = {
	id: 'clock',
	// Labels/descriptions on built-in defs stay string-literal at
	// module-eval time so the extract-pot pass picks them up. The
	// values are wrapped in `__()` so they translate at runtime.
	get label(): string {
		return __( 'Clock' );
	},
	get description(): string {
		return __( 'A live analog wall clock rendered with WebGL.' );
	},
	icon: 'dashicons-clock',
	movable: true,
	resizable: true,
	minWidth: 160,
	minHeight: 200,
	defaultWidth: 240,
	defaultHeight: 280,
	mount: async ( container ): Promise< () => void > => {
		container.classList.add( 'wp-desktop-widget-clock' );

		const stage = document.createElement( 'div' );
		stage.className = 'wp-desktop-widget-clock__stage';
		container.appendChild( stage );

		const digital = document.createElement( 'div' );
		digital.className = 'wp-desktop-widget-clock__digital';
		container.appendChild( digital );

		// Drive the digital readout immediately so the widget reads
		// as "alive" before / even if PIXI loads. Aligned to the
		// wall-clock second boundary so it flips in sync with every
		// other clock onscreen.
		let digitalInterval: number | null = null;
		const renderDigital = (): void => {
			const now = new Date();
			digital.textContent = now.toLocaleTimeString( undefined, {
				hour: '2-digit',
				minute: '2-digit',
			} );
		};
		renderDigital();
		const msUntilNextSecond = 1000 - ( Date.now() % 1000 );
		const digitalKickoff = window.setTimeout( () => {
			renderDigital();
			digitalInterval = window.setInterval( renderDigital, 1000 );
		}, msUntilNextSecond );

		// Lazy-load PIXI. If it fails (CSP, network), the digital
		// readout above is still ticking so the widget is functional.
		try {
			await loadModules( [ 'pixijs' ] );
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[wp-desktop-mode] Clock widget could not load PIXI; ' +
						'falling back to digital-only readout.',
					err,
				);
			}
			return () => {
				window.clearTimeout( digitalKickoff );
				if ( digitalInterval !== null ) {
					window.clearInterval( digitalInterval );
				}
			};
		}

		const sceneTeardown = await mountClockScene( stage );

		return () => {
			window.clearTimeout( digitalKickoff );
			if ( digitalInterval !== null ) {
				window.clearInterval( digitalInterval );
			}
			sceneTeardown();
		};
	},
};

/**
 * Build the Pixi clock face into `stage`. Returns a teardown that
 * destroys the Application, removes listeners, and disconnects the
 * resize observer. Assumes `window.PIXI` is defined — caller awaits
 * `loadModules(['pixijs'])` first.
 */
async function mountClockScene( stage: HTMLElement ): Promise< () => void > {
	const pixi = window.PIXI;
	if ( ! pixi ) {
		// Defensive — `loadModules` resolves only when the global is
		// set, so the only way to get here is a vendor script that
		// failed to attach `window.PIXI`. Log loudly; widget keeps
		// working on the digital readout.
		throw new Error(
			'[wp-desktop-mode] window.PIXI is undefined after loadModules.',
		);
	}

	const app: Application = new pixi.Application();
	await app.init( {
		resizeTo: stage,
		backgroundAlpha: 0,
		antialias: true,
		autoDensity: true,
		resolution: Math.min( window.devicePixelRatio || 1, 2 ),
	} );
	stage.appendChild( app.canvas );

	// Two layers: `face` carries everything that should parallax-tilt
	// (bezel, ticks, numerals, highlight, hands). `overlay` is empty
	// for now but kept as an extension point for things that should
	// stay locked to the stage (e.g. a future "tap to set" UI).
	const face: Container = new pixi.Container();
	app.stage.addChild( face );

	const bezel: Graphics = new pixi.Graphics();
	const ticks: Graphics = new pixi.Graphics();
	const highlight: Graphics = new pixi.Graphics();
	const hourHand: Graphics = new pixi.Graphics();
	const minuteHand: Graphics = new pixi.Graphics();
	const secondHand: Graphics = new pixi.Graphics();
	const cap: Graphics = new pixi.Graphics();

	// Stack order: bezel → ticks → highlight (additive shine) →
	// hands → cap. The highlight is below the hands so a hand never
	// looks "behind" the gloss when it sweeps across.
	face.addChild( bezel );
	face.addChild( ticks );
	face.addChild( highlight );
	face.addChild( hourHand );
	face.addChild( minuteHand );
	face.addChild( secondHand );
	face.addChild( cap );

	// Cardinal numerals — created once, repositioned on layout. Pixi
	// Text uses a canvas-backed bitmap, so these don't blur on resize
	// the way a scaled sprite would.
	const numerals: Text[] = CARDINALS.map( ( { label } ) => {
		const t: Text = new pixi.Text( {
			text: label,
			style: {
				fontFamily:
					'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
				fontSize: 16,
				fontWeight: '600',
				fill: 0xffffff,
				align: 'center',
			},
		} );
		t.anchor.set( 0.5 );
		t.alpha = 0.85;
		face.addChild( t );
		return t;
	} );

	// Layout state — recomputed on resize, read every frame.
	let cx = 0;
	let cy = 0;
	let radius = 0;

	const drawStaticFace = (): void => {
		// Outer rim — a thin white stroke giving the face its edge.
		bezel.clear();
		bezel.circle( cx, cy, radius );
		bezel.stroke( {
			width: radius * CONFIG.ringWidth,
			color: 0xffffff,
			alpha: 0.18,
		} );
		// Inner accent ring — a hair inside the rim, dimmer, gives
		// the bezel depth without needing an actual 3D bevel.
		bezel.circle( cx, cy, radius * 0.93 );
		bezel.stroke( {
			width: 1,
			color: 0xffffff,
			alpha: 0.08,
		} );

		// Tick marks — 60 minutes, every 5th drawn longer / brighter
		// as an hour mark. Drawing once per resize (not per frame)
		// since they don't move.
		ticks.clear();
		for ( let i = 0; i < 60; i++ ) {
			const angle = ( i / 60 ) * Math.PI * 2 - Math.PI / 2;
			const isHour = i % 5 === 0;
			const len = radius * ( isHour ? CONFIG.hourTickLen : CONFIG.minuteTickLen );
			const inner = radius * 0.88 - len;
			const outer = radius * 0.88;
			const x1 = cx + Math.cos( angle ) * inner;
			const y1 = cy + Math.sin( angle ) * inner;
			const x2 = cx + Math.cos( angle ) * outer;
			const y2 = cy + Math.sin( angle ) * outer;
			ticks.moveTo( x1, y1 );
			ticks.lineTo( x2, y2 );
			ticks.stroke( {
				width: isHour ? 2 : 1,
				color: 0xffffff,
				alpha: isHour ? 0.85 : 0.32,
			} );
		}

		// Position cardinal numerals just inside the inner tick edge.
		const numeralRadius = radius * 0.7;
		for ( let i = 0; i < CARDINALS.length; i++ ) {
			const { hour } = CARDINALS[ i ];
			const angle = ( hour / 12 ) * Math.PI * 2 - Math.PI / 2;
			const t = numerals[ i ];
			t.x = cx + Math.cos( angle ) * numeralRadius;
			t.y = cy + Math.sin( angle ) * numeralRadius;
			// Scale numerals with face size — feels balanced from the
			// 160px minimum widget all the way up to a fully-resized
			// floating clock.
			t.style.fontSize = Math.max( 11, Math.round( radius * 0.13 ) );
		}

		// Center cap — small filled disc + pin. Drawn once because
		// the cap doesn't move; the second hand passes underneath it
		// (we add the cap last to the face container).
		cap.clear();
		cap.circle( cx, cy, Math.max( 3, radius * 0.04 ) );
		cap.fill( { color: 0xffffff, alpha: 0.95 } );
		cap.circle( cx, cy, Math.max( 1.5, radius * 0.018 ) );
		cap.fill( { color: 0xff3b3b, alpha: 1 } );
	};

	const layout = (): void => {
		const w = stage.clientWidth || 1;
		const h = stage.clientHeight || 1;
		cx = w / 2;
		cy = h / 2;
		// 4% padding inside the stage so the rim stroke isn't clipped
		// by the rounded-corner overflow.
		radius = Math.max( 8, Math.min( w, h ) / 2 - Math.min( w, h ) * 0.04 );
		drawStaticFace();
	};
	layout();

	const resizeObserver = new ResizeObserver( () => layout() );
	resizeObserver.observe( stage );

	// Pointer state — positions in stage-local CSS pixels. `inside`
	// gates the highlight so the gloss fades out when the cursor
	// leaves the widget.
	let pointerX = 0;
	let pointerY = 0;
	let pointerInside = false;
	// Smoothed parallax — eased toward the raw pointer offset every
	// frame. Lerping keeps the face from snapping when the cursor
	// jumps in (e.g. tabbing back).
	let tiltX = 0;
	let tiltY = 0;
	// Smoothed highlight alpha — eased toward 0 / target when the
	// cursor leaves / enters, so the gloss fades instead of popping.
	let highlightAlpha = 0;

	const onPointerMove = ( e: PointerEvent ): void => {
		const rect = stage.getBoundingClientRect();
		pointerX = e.clientX - rect.left;
		pointerY = e.clientY - rect.top;
		pointerInside = true;
	};
	const onPointerLeave = (): void => {
		pointerInside = false;
	};
	stage.addEventListener( 'pointermove', onPointerMove );
	stage.addEventListener( 'pointerleave', onPointerLeave );
	stage.addEventListener( 'pointercancel', onPointerLeave );

	// Pause when the tab is hidden — there's no point burning a
	// WebGL frame budget while the clock is offscreen, and on
	// background tabs `requestAnimationFrame` is throttled anyway.
	let visible = ! document.hidden;
	const onVisibility = (): void => {
		visible = ! document.hidden;
		if ( visible ) {
			app.ticker.start();
		} else {
			app.ticker.stop();
		}
	};
	document.addEventListener( 'visibilitychange', onVisibility );

	// Per-frame: update parallax, redraw highlight, redraw hands.
	// Hands are cleared + redrawn rather than rotated as a single
	// rigid sprite so the hour-hand thickness stays crisp regardless
	// of the angle (rotation of a thin stroked sprite blurs).
	const tick = (): void => {
		const w = stage.clientWidth || 1;
		const h = stage.clientHeight || 1;

		// Parallax target: pointer offset from center, normalized to
		// [-1, 1] across the stage, then scaled to `parallaxRange`.
		// When the pointer leaves we ease back to (0, 0).
		const targetX = pointerInside
			? ( ( pointerX - cx ) / ( w / 2 ) ) * CONFIG.parallaxRange
			: 0;
		const targetY = pointerInside
			? ( ( pointerY - cy ) / ( h / 2 ) ) * CONFIG.parallaxRange
			: 0;
		tiltX += ( targetX - tiltX ) * CONFIG.parallaxLerp;
		tiltY += ( targetY - tiltY ) * CONFIG.parallaxLerp;
		face.x = tiltX;
		face.y = tiltY;

		// Specular highlight — a soft radial gradient under the
		// cursor, additive-blended on top of the face. Implemented as
		// a stack of concentric translucent circles since Pixi
		// Graphics doesn't have a true radial-gradient fill.
		const targetAlpha = pointerInside ? CONFIG.highlightAlpha : 0;
		highlightAlpha += ( targetAlpha - highlightAlpha ) * 0.12;
		highlight.clear();
		if ( highlightAlpha > 0.005 ) {
			const hx = pointerX - tiltX; // un-shift back into face space
			const hy = pointerY - tiltY;
			const hr = radius * CONFIG.highlightRadius;
			const steps = 6;
			for ( let i = steps; i >= 1; i-- ) {
				const t = i / steps;
				highlight.circle( hx, hy, hr * t );
				highlight.fill( {
					color: 0xffffff,
					alpha: highlightAlpha * ( 1 - t ) * 0.45,
				} );
			}
			highlight.blendMode = 'add';
		}

		// Time -> hand angles. Smooth (sub-second) sweep on every
		// hand so the second hand glides instead of stepping; the
		// minute hand inherits the partial-second so the minute hand
		// also moves continuously.
		const now = new Date();
		const ms =
			now.getMilliseconds() +
			now.getSeconds() * 1000 +
			now.getMinutes() * 60 * 1000 +
			now.getHours() * 60 * 60 * 1000;
		const secondsFloat = ( ms / 1000 ) % 60;
		const minutesFloat = ( ms / ( 1000 * 60 ) ) % 60;
		const hoursFloat = ( ms / ( 1000 * 60 * 60 ) ) % 12;
		const secondAngle = ( secondsFloat / 60 ) * Math.PI * 2 - Math.PI / 2;
		const minuteAngle = ( minutesFloat / 60 ) * Math.PI * 2 - Math.PI / 2;
		const hourAngle = ( hoursFloat / 12 ) * Math.PI * 2 - Math.PI / 2;

		// Width scales with face size so the hands feel right at
		// every widget dimension; reference is the 220px clock that
		// `hourHandWidth` etc. were tuned for.
		const widthScale = Math.max( 0.5, radius / 110 );

		drawHand(
			hourHand,
			cx,
			cy,
			hourAngle,
			radius * CONFIG.hourHandLen,
			CONFIG.hourHandWidth * widthScale,
			0xffffff,
			0.92,
		);
		drawHand(
			minuteHand,
			cx,
			cy,
			minuteAngle,
			radius * CONFIG.minuteHandLen,
			CONFIG.minuteHandWidth * widthScale,
			0xffffff,
			0.85,
		);
		drawSecondHand(
			secondHand,
			cx,
			cy,
			secondAngle,
			radius * CONFIG.secondHandLen,
			radius * CONFIG.secondCounterLen,
			CONFIG.secondHandWidth * widthScale,
		);
	};

	app.ticker.add( tick );

	return () => {
		app.ticker.remove( tick );
		stage.removeEventListener( 'pointermove', onPointerMove );
		stage.removeEventListener( 'pointerleave', onPointerLeave );
		stage.removeEventListener( 'pointercancel', onPointerLeave );
		document.removeEventListener( 'visibilitychange', onVisibility );
		resizeObserver.disconnect();
		// `removeView: true` strips the canvas from the DOM, so the
		// stage is empty and ready for a future re-mount.
		app.destroy( true, { children: true, texture: true } );
	};
}

/**
 * Draw a rounded-cap clock hand from (cx, cy) outward at `angle` for
 * `length` CSS pixels with the given stroke width / color / alpha.
 * Clears prior geometry first — caller invokes once per frame.
 */
function drawHand(
	g: Graphics,
	cx: number,
	cy: number,
	angle: number,
	length: number,
	width: number,
	color: number,
	alpha: number,
): void {
	g.clear();
	const x = cx + Math.cos( angle ) * length;
	const y = cy + Math.sin( angle ) * length;
	g.moveTo( cx, cy );
	g.lineTo( x, y );
	g.stroke( { width, color, alpha, cap: 'round' } );
}

/**
 * Second hand has its own routine because it's the visual focal
 * point: thin red, tiny counterweight on the opposite side, and a
 * small disc on the tip for that "wall clock" silhouette.
 */
function drawSecondHand(
	g: Graphics,
	cx: number,
	cy: number,
	angle: number,
	length: number,
	counterLength: number,
	width: number,
): void {
	g.clear();
	const tipX = cx + Math.cos( angle ) * length;
	const tipY = cy + Math.sin( angle ) * length;
	const tailX = cx - Math.cos( angle ) * counterLength;
	const tailY = cy - Math.sin( angle ) * counterLength;
	g.moveTo( tailX, tailY );
	g.lineTo( tipX, tipY );
	g.stroke( {
		width,
		color: 0xff3b3b,
		alpha: 0.95,
		cap: 'round',
	} );
	// Tip disc — sits on the very end of the hand, reads as the
	// classic "rounded counterweight wall clock" detail at any
	// face size.
	g.circle( tipX, tipY, Math.max( 2, width * 1.6 ) );
	g.fill( { color: 0xff3b3b, alpha: 0.95 } );
}

/**
 * Register all built-in widgets. Called once during shell boot,
 * BEFORE {@link WidgetLayer#hydrate} so the `clock` default is in
 * the registry when the layer looks it up.
 */
export function registerBuiltInWidgets(): void {
	registry.register( clock );
}
