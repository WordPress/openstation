/**
 * Routines — PixiJS visualisation layer.
 *
 * The canvas is hybrid: DOM cards on top (so inputs / textareas /
 * focus / a11y just work), Pixi WebGL underneath drawing everything
 * that benefits from being GPU-rendered:
 *
 *   - **Connector flow** — bezier curves between the trigger card,
 *     condition gate, and step cards. Animated dashed offset gives
 *     a steady downward "flow" that signals data direction.
 *
 *   - **Glow halos** — soft gradient circles behind cards. Trigger
 *     pulses on its own slow rhythm; the focused card glows
 *     accent-coloured.
 *
 *   - **Background field** — subtle dot grid that drifts very slowly,
 *     giving the canvas a depth that flat CSS doesn't.
 *
 *   - **Run animation** — when the user hits Test or Run, a packet
 *     of light traces the connector flow, lighting each step in
 *     sequence with a particle burst on success / error.
 *
 * The layer is purely visual — every interaction (click, drag, edit)
 * is handled by the DOM cards above. Pixi reads card positions on
 * each frame from data-attributes the canvas writes; cards re-flow
 * (via simple top-down layout) and Pixi just follows.
 *
 * Loaded lazily via `wp.desktop.loadVendorScript('…/pixi.min.js')`
 * — the routines bundle stays small and only pays the Pixi cost on
 * first canvas paint.
 *
 * @since 0.22.0
 */

import type { Application, Graphics } from 'pixi.js';

declare global {
	interface Window {
		PIXI?: typeof import( 'pixi.js' );
	}
}

export interface CardAnchor {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	kind: 'trigger' | 'conditions' | 'step' | 'add' | 'branch-then' | 'branch-else';
	parentId?: string;
	/**
	 * Extra incoming connector sources beyond the single
	 * `parentId`. Used for an `if` block's merge: when both
	 * branches end and the outer flow continues, the post-if step
	 * (or the trailing root add-step) receives one connector
	 * from each branch's tail. Drawn alongside the regular
	 * single-parent connector.
	 */
	mergeFromIds?: string[];
	state?: 'idle' | 'active' | 'success' | 'error';
}

export interface PixiLayerHandle {
	setAnchors: ( anchors: CardAnchor[] ) => void;
	/**
	 * Resize the renderer's pixel buffer. Triggers an immediate
	 * synchronous redraw so the canvas never sits empty between
	 * a `clear()` and the next ticker frame — that one-frame gap
	 * is what reads as a "blink" during inspector slide-in.
	 */
	resize: ( width: number, height: number ) => void;
	/**
	 * Apply a viewport pan + zoom transform to the world layer
	 * (halos, connectors, overlay). The renderer stays at native
	 * pixel resolution; the transform is applied at the
	 * scene-graph level, so paths re-rasterise sharp at any zoom
	 * — zero bilinear pixelation.
	 */
	setTransform: ( zoom: number, panX: number, panY: number ) => void;
	pulse: ( anchorId: string, kind: 'success' | 'error' | 'active' ) => void;
	playRun: ( sequence: Array< { id: string; ok: boolean; ms: number } > ) => void;
	destroy: () => void;
}

interface State {
	app: Application;
	bg: Graphics;
	world: import( 'pixi.js' ).Container;
	connectors: Graphics;
	halos: Graphics;
	overlay: Graphics;
	anchors: CardAnchor[];
	t: number; // animation time accumulator (ms)
}

/**
 * Mount a Pixi rendering layer inside `host`. Returns a handle the
 * canvas uses to push anchor updates and trigger animations. The
 * caller is responsible for sizing the host element — the Pixi app
 * matches `host.clientWidth` / `clientHeight` and listens for
 * subsequent `resize()` calls.
 *
 * @param host      Containing element. Should have `position: relative`
 *                  so the absolute-positioned canvas overlays it.
 * @param pluginUrl Plugin URL — used to locate the vendored
 *                  `pixi.min.js`.
 */
export async function mountPixiLayer(
	host: HTMLElement,
	pluginUrl: string,
): Promise< PixiLayerHandle > {
	await ensurePixiLoaded( pluginUrl );
	const PIXI = window.PIXI;
	if ( ! PIXI ) {
		throw new Error( 'PixiJS failed to load.' );
	}

	const app = new PIXI.Application();
	await app.init( {
		background: 'transparent',
		backgroundAlpha: 0,
		antialias: true,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
		width: Math.max( 1, host.clientWidth ),
		height: Math.max( 1, host.clientHeight ),
		// Disable Pixi's EventSystem entirely — the layer is purely
		// presentational. Without this, Pixi v8 attaches pointer +
		// wheel listeners to the canvas (and document) that swallow
		// drag-to-move, click-to-focus, and double-click-to-maximize
		// gestures the host Desktop window relies on.
		eventMode: 'none',
		eventFeatures: {
			move: false,
			globalMove: false,
			click: false,
			wheel: false,
		},
	} );
	app.stage.eventMode = 'none';
	app.stage.interactiveChildren = false;

	const canvas = app.canvas as HTMLCanvasElement;
	canvas.style.cssText =
		'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none;';
	host.prepend( canvas );

	// Two-layer scene graph:
	//   - bg lives in the UNTRANSFORMED root stage so the dot grid
	//     covers the full canvas regardless of zoom.
	//   - world holds halos / connectors / overlay; its scale +
	//     position track the viewport's pan + zoom, so everything
	//     drawn into it stays vector-sharp at any zoom level.
	const bg = new PIXI.Graphics();
	const world = new PIXI.Container();
	const connectors = new PIXI.Graphics();
	const halos = new PIXI.Graphics();
	const overlay = new PIXI.Graphics();
	world.addChild( halos, connectors, overlay );
	app.stage.addChild( bg, world );

	const state: State = {
		app,
		bg,
		world,
		connectors,
		halos,
		overlay,
		anchors: [],
		t: 0,
	};

	const burstParticles: Particle[] = [];
	const flowPackets: FlowPacket[] = [];

	app.ticker.add( ( ticker ) => {
		state.t += ticker.deltaMS;
		drawBackground( state );
		drawHalos( state );
		drawConnectors( state );
		drawOverlay( state, burstParticles, flowPackets, ticker.deltaMS );
	} );

	return {
		setAnchors: ( anchors ) => {
			state.anchors = anchors;
		},
		resize: ( w, h ) => {
			app.renderer.resize( Math.max( 1, w ), Math.max( 1, h ) );
			// Immediate synchronous draw — close the one-frame gap
			// between framebuffer clear and the ticker's next tick
			// that produced the visible "blink" on inspector
			// open/close.
			drawBackground( state );
			drawHalos( state );
			drawConnectors( state );
			drawOverlay( state, burstParticles, flowPackets, 0 );
			app.renderer.render( app.stage );
		},
		setTransform: ( zoom, panX, panY ) => {
			world.scale.set( zoom );
			world.position.set( panX, panY );
		},
		pulse: ( anchorId, kind ) => {
			const a = state.anchors.find( ( x ) => x.id === anchorId );
			if ( ! a ) {
				return;
			}
			let colour = 0x2271b1;
			if ( kind === 'success' ) {
				colour = 0x10b981;
			} else if ( kind === 'error' ) {
				colour = 0xef4444;
			}
			emitBurst( burstParticles, a.x + a.width / 2, a.y + a.height / 2, colour );
		},
		playRun: ( sequence ) => {
			// Build an ordered list of anchor centres to traverse.
			const centres: Array< { id: string; x: number; y: number; ok: boolean } > = [];
			const trigger = state.anchors.find( ( a ) => a.kind === 'trigger' );
			if ( trigger ) {
				centres.push( {
					id: trigger.id,
					x: trigger.x + trigger.width / 2,
					y: trigger.y + trigger.height / 2,
					ok: true,
				} );
			}
			for ( const entry of sequence ) {
				const a = state.anchors.find( ( x ) => x.id === entry.id );
				if ( a ) {
					centres.push( {
						id: a.id,
						x: a.x + a.width / 2,
						y: a.y + a.height / 2,
						ok: entry.ok,
					} );
				}
			}
			for ( let i = 1; i < centres.length; i++ ) {
				flowPackets.push( {
					from: centres[ i - 1 ],
					to: centres[ i ],
					t: 0,
					duration: 240 + i * 80,
					delay: i * 220,
					ok: centres[ i ].ok,
					emitted: false,
				} );
			}
		},
		destroy: () => {
			app.destroy( true, { children: true, texture: true } );
		},
	};
}

// ---- Pixi loader -----------------------------------------------------

let pixiPromise: Promise< void > | null = null;

function ensurePixiLoaded( pluginUrl: string ): Promise< void > {
	if ( window.PIXI ) {
		return Promise.resolve();
	}
	if ( pixiPromise ) {
		return pixiPromise;
	}
	const url = `${ pluginUrl }/assets/vendor/pixi.min.js`;
	pixiPromise = new Promise< void >( ( resolve, reject ) => {
		const existing = document.querySelector(
			`script[src="${ url }"]`,
		) as HTMLScriptElement | null;
		if ( existing ) {
			if ( window.PIXI ) {
				resolve();
				return;
			}
			existing.addEventListener( 'load', () => resolve() );
			existing.addEventListener( 'error', () =>
				reject( new Error( 'pixi.min.js failed to load.' ) ),
			);
			return;
		}
		const tag = document.createElement( 'script' );
		tag.src = url;
		tag.async = true;
		tag.onload = () => resolve();
		tag.onerror = () => reject( new Error( 'pixi.min.js failed to load.' ) );
		document.head.append( tag );
	} );
	return pixiPromise;
}

// ---- Drawing helpers -------------------------------------------------

function drawBackground( state: State ): void {
	const { bg, app, t } = state;
	bg.clear();
	const w = app.renderer.width / ( window.devicePixelRatio || 1 );
	const h = app.renderer.height / ( window.devicePixelRatio || 1 );
	const drift = ( t / 80 ) % 24;
	const spacing = 24;
	const rows = Math.ceil( h / spacing ) + 2;
	const cols = Math.ceil( w / spacing ) + 2;
	for ( let r = 0; r < rows; r++ ) {
		for ( let c = 0; c < cols; c++ ) {
			const x = c * spacing - drift;
			const y = r * spacing - drift;
			bg.circle( x, y, 1 );
		}
	}
	bg.fill( { color: 0x000000, alpha: 0.04 } );
}

function drawHalos( state: State ): void {
	const { halos, anchors, t } = state;
	halos.clear();
	for ( const a of anchors ) {
		if ( a.kind === 'add' ) {
			continue;
		}
		const cx = a.x + a.width / 2;
		const cy = a.y + a.height / 2;
		const radius = Math.max( a.width, a.height ) * 0.55;

		// Gentle ambient pulse on every card; trigger pulses faster.
		const speed = a.kind === 'trigger' ? 1.1 : 0.6;
		const pulse = 0.5 + 0.5 * Math.sin( ( t / 1000 ) * speed );
		const alpha = 0.04 + pulse * 0.05;
		const colour = haloColour( a );

		halos.circle( cx, cy, radius * ( 1 + pulse * 0.06 ) );
		halos.fill( { color: colour, alpha } );
	}
}

function haloColour( a: CardAnchor ): number {
	if ( a.state === 'success' ) {
		return 0x10b981;
	}
	if ( a.state === 'error' ) {
		return 0xef4444;
	}
	if ( a.kind === 'trigger' ) {
		return 0x2271b1;
	}
	if ( a.kind === 'conditions' ) {
		return 0xf59e0b;
	}
	if ( a.kind === 'branch-then' ) {
		return 0x10b981;
	}
	if ( a.kind === 'branch-else' ) {
		return 0xa855f7;
	}
	return 0x6b7280;
}

function drawConnectors( state: State ): void {
	const { connectors, anchors, t } = state;
	connectors.clear();

	// Index anchors by id for O(1) parent lookup.
	const byId = new Map< string, CardAnchor >();
	for ( const a of anchors ) {
		byId.set( a.id, a );
	}

	const dashOffset = ( t / 14 ) % 16;

	for ( const a of anchors ) {
		if ( a.parentId ) {
			const parent = byId.get( a.parentId );
			if ( parent ) {
				drawBezier(
					connectors,
					parent.x + parent.width / 2,
					parent.y + parent.height,
					a.x + a.width / 2,
					a.y,
					dashOffset,
					edgeColour( a ),
				);
			}
		}
		if ( a.mergeFromIds ) {
			// Each branch's tail draws an incoming connector to
			// this anchor (the "merge" — both branches converge).
			// Use a soft grey so the merge reads as a junction
			// rather than another flow line.
			for ( const id of a.mergeFromIds ) {
				const src = byId.get( id );
				if ( ! src ) {
					continue;
				}
				drawBezier(
					connectors,
					src.x + src.width / 2,
					src.y + src.height,
					a.x + a.width / 2,
					a.y,
					dashOffset,
					0x9ca3af,
				);
			}
		}
	}
}

function edgeColour( a: CardAnchor ): number {
	if ( a.kind === 'branch-then' ) {
		return 0x10b981;
	}
	if ( a.kind === 'branch-else' ) {
		return 0xa855f7;
	}
	return 0x9ca3af;
}

function drawBezier(
	g: Graphics,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	dashOffset: number,
	colour: number,
): void {
	const dy = y2 - y1;
	const cx1 = x1;
	const cy1 = y1 + dy * 0.45;
	const cx2 = x2;
	const cy2 = y2 - dy * 0.45;
	// Sample the curve to draw a dashed stroke.
	const segments = 24;
	const dash = 8;
	const gap = 8;
	const step = 1 / segments;
	let lastX = x1;
	let lastY = y1;
	let acc = -dashOffset;
	for ( let i = 1; i <= segments; i++ ) {
		const t = i * step;
		const px = cubic( x1, cx1, cx2, x2, t );
		const py = cubic( y1, cy1, cy2, y2, t );
		const segLen = Math.hypot( px - lastX, py - lastY );
		// Walk the dashed pattern along this segment.
		let remaining = segLen;
		let cursorX = lastX;
		let cursorY = lastY;
		const dx = ( px - lastX ) / segLen || 0;
		const dyn = ( py - lastY ) / segLen || 0;
		while ( remaining > 0 ) {
			const phase = ( acc % ( dash + gap ) + ( dash + gap ) ) % ( dash + gap );
			const inDash = phase < dash;
			const room = inDash ? dash - phase : dash + gap - phase;
			const advance = Math.min( room, remaining );
			if ( inDash ) {
				const nx = cursorX + dx * advance;
				const ny = cursorY + dyn * advance;
				g.moveTo( cursorX, cursorY );
				g.lineTo( nx, ny );
			}
			cursorX += dx * advance;
			cursorY += dyn * advance;
			acc += advance;
			remaining -= advance;
		}
		lastX = px;
		lastY = py;
	}
	g.stroke( { color: colour, alpha: 0.7, width: 2 } );
}

function cubic( a: number, b: number, c: number, d: number, t: number ): number {
	const u = 1 - t;
	return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

// ---- Overlay (run packets + bursts) ---------------------------------

interface FlowPacket {
	from: { x: number; y: number };
	to: { x: number; y: number };
	t: number; // ms elapsed within the move
	duration: number;
	delay: number; // ms remaining before the move starts
	ok: boolean;
	emitted: boolean;
}

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	colour: number;
}

function drawOverlay(
	state: State,
	bursts: Particle[],
	packets: FlowPacket[],
	dt: number,
): void {
	const { overlay } = state;
	overlay.clear();

	// Advance + draw flow packets.
	for ( let i = packets.length - 1; i >= 0; i-- ) {
		const p = packets[ i ];
		if ( p.delay > 0 ) {
			p.delay -= dt;
			continue;
		}
		p.t += dt;
		const k = Math.min( 1, p.t / p.duration );
		const ease = easeInOut( k );
		const px = p.from.x + ( p.to.x - p.from.x ) * ease;
		const py = p.from.y + ( p.to.y - p.from.y ) * ease;
		const colour = p.ok ? 0x60a5fa : 0xef4444;
		overlay.circle( px, py, 6 ).fill( { color: colour, alpha: 0.85 } );
		overlay.circle( px, py, 12 ).fill( { color: colour, alpha: 0.25 } );
		if ( k >= 1 && ! p.emitted ) {
			emitBurst( bursts, p.to.x, p.to.y, colour );
			p.emitted = true;
		}
		if ( k >= 1 ) {
			packets.splice( i, 1 );
		}
	}

	// Advance + draw bursts.
	for ( let i = bursts.length - 1; i >= 0; i-- ) {
		const part = bursts[ i ];
		part.x += part.vx;
		part.y += part.vy;
		part.vx *= 0.94;
		part.vy *= 0.94;
		part.vy += 0.05;
		part.life += dt;
		const lifeT = Math.min( 1, part.life / part.maxLife );
		const alpha = 0.85 * ( 1 - lifeT );
		const radius = 3 * ( 1 - lifeT * 0.5 );
		overlay.circle( part.x, part.y, radius ).fill( { color: part.colour, alpha } );
		if ( lifeT >= 1 ) {
			bursts.splice( i, 1 );
		}
	}
}

function easeInOut( t: number ): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow( -2 * t + 2, 2 ) / 2;
}

function emitBurst(
	out: Particle[],
	cx: number,
	cy: number,
	colour: number,
): void {
	const count = 18;
	for ( let i = 0; i < count; i++ ) {
		const angle = ( i / count ) * Math.PI * 2;
		const speed = 1.5 + Math.random() * 2.5;
		out.push( {
			x: cx,
			y: cy,
			vx: Math.cos( angle ) * speed,
			vy: Math.sin( angle ) * speed,
			life: 0,
			maxLife: 600 + Math.random() * 200,
			colour,
		} );
	}
}
