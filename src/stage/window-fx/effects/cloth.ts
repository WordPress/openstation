/**
 * Desktop Mode — "Cloth" window effect.
 *
 * While you drag a window it stops being a rigid rectangle and starts
 * behaving like fabric pinned along its title bar: it lags behind the
 * pointer, swings, and settles.
 *
 * **How.** The window's pixels are frozen into a texture (the engine
 * does that), stretched over a `MeshPlane` whose vertex grid is driven
 * by a Verlet cloth solver. The top row of particles is pinned to the
 * window's live title-bar edge — read from the real element every frame,
 * because the window manager keeps moving it under the pointer while it
 * is hidden — and the rest hang from it under gravity, held together by
 * distance constraints.
 *
 * Verlet rather than spring-mass on purpose: positions carry their own
 * velocity (`current - previous`), so there is no velocity array to keep
 * in sync, and constraint relaxation is a couple of lines that stays
 * stable at large timesteps. Cloth simulated with explicit springs
 * explodes the moment a frame runs long, which on a desktop that is
 * already compositing itself through a shader chain is not hypothetical.
 *
 * This is a **sustained** effect: it runs from drag-start until the
 * engine aborts it at drag-end — and then keeps running. The abort
 * begins a settle phase in which the sheet swings against a stationary
 * pin line until the motion dies away, because a cloth that stops dead
 * the instant you release the mouse does not read as cloth at all.
 *
 * @since 0.9.8
 */

import { __ } from '../../../i18n';
import type { WindowEffectDef, WindowEffectRunContext } from '../types';

/**
 * Constraint relaxation passes per frame.
 *
 * Each pass pulls the sheet closer to its rest shape, so more passes
 * mean a stiffer, more rigid sheet. Three passes at the old default
 * stiffness solved the grid back to almost exactly a rectangle every
 * frame, which is why it looked rigid WHILE dragging and only read as
 * fabric once the drag stopped. Two is enough to hold it together
 * without erasing the lag that makes it look like cloth.
 */
const RELAX_PASSES = 2;

/** Clamp the timestep so a long frame cannot detonate the simulation. */
const MAX_STEP_S = 1 / 30;

/**
 * Longest the cloth may keep swinging after the drag ends.
 *
 * The settle is what stops the animation ending with a jolt: at
 * drag-end the sheet is still moving, so it keeps simulating against a
 * now-stationary pin line and swings itself to rest. This is the
 * backstop for a sheet that never quite stills — a very low damping
 * value can ring for a long time.
 */
const MAX_SETTLE_MS = 700;

/**
 * Longest the cloth may keep swinging after the drag ends.
 *
 * Also the window over which it is eased back onto the window's exact
 * rectangle — see the settle handling in `step`.
 */

interface Particle {
	x: number;
	y: number;
	/** Previous position — velocity is implied by the difference. */
	px: number;
	py: number;
	pinned: boolean;
}

interface Constraint {
	a: number;
	b: number;
	rest: number;
}

export const clothEffect: WindowEffectDef = {
	id: 'cloth',
	label: __( 'Cloth' ),
	description: __(
		'The window hangs from its title bar like fabric and swings as you drag it.',
	),
	transitions: [ 'drag' ],
	params: [
		{
			key: 'gravity',
			label: __( 'Gravity' ),
			min: 0,
			max: 4000,
			step: 50,
			// Heavy enough that the sheet visibly falls behind the pointer
			// rather than trailing it politely.
			default: 2400,
		},
		{
			key: 'stiffness',
			label: __( 'Stiffness' ),
			min: 0.1,
			max: 1,
			step: 0.05,
			// 1 is a rigid sheet; low values sag and ripple. Low by
			// default — the whole point is to see it deform while it
			// moves, and a stiff sheet just looks like a lagging
			// rectangle.
			default: 0.22,
		},
		{
			key: 'damping',
			label: __( 'Damping' ),
			min: 0.8,
			max: 1,
			step: 0.005,
			// Fraction of velocity kept each frame. Below ~0.9 the cloth
			// stops dead and stops looking like fabric; high values keep
			// it swinging long after you let go.
			default: 0.985,
		},
		{
			key: 'resolution',
			label: __( 'Mesh detail' ),
			min: 4,
			max: 24,
			step: 1,
			default: 12,
		},
	],

	run( ctx: WindowEffectRunContext ) {
		const {
			pixi,
			sprite,
			texture,
			layer,
			shadow,
			from,
			element,
			ticker,
			params,
		} = ctx;
		const { MeshPlane } = pixi as unknown as {
			MeshPlane?: new ( opts: {
				texture: unknown;
				verticesX: number;
				verticesY: number;
			} ) => {
				geometry: {
					positions: Float32Array;
					getBuffer( id: string ): { update(): void };
				};
				destroy( destroyOptions?: unknown ): void;
			};
		};

		// Older Pixi builds, or a trimmed bundle, may not carry the mesh
		// scene graph. Degrade to the plain frozen sprite rather than
		// throwing — the drag still works, it just does not wobble.
		if ( typeof MeshPlane !== 'function' ) {
			return;
		}

		const cols = Math.max( 2, Math.round( params.resolution ) );
		const rows = Math.max( 2, Math.round( params.resolution * 0.7 ) );

		const mesh = new MeshPlane( {
			texture,
			verticesX: cols,
			verticesY: rows,
		} );
		layer.addChild( mesh as unknown as never );

		// The frozen sprite is what the mesh replaces.
		sprite.visible = false;

		// Build the particle grid over the window's starting rectangle.
		const particles: Particle[] = [];
		for ( let row = 0; row < rows; row++ ) {
			for ( let col = 0; col < cols; col++ ) {
				const x = from.x + ( from.width * col ) / ( cols - 1 );
				const y = from.y + ( from.height * row ) / ( rows - 1 );
				particles.push( {
					x,
					y,
					px: x,
					py: y,
					// Only the top edge holds the sheet up.
					pinned: row === 0,
				} );
			}
		}

		// Structural constraints: right and down neighbours. Shear and
		// bend constraints would hold the shape more rigidly, but a
		// window that barely deforms is not what anyone asked for.
		const constraints: Constraint[] = [];
		const restX = from.width / ( cols - 1 );
		const restY = from.height / ( rows - 1 );
		for ( let row = 0; row < rows; row++ ) {
			for ( let col = 0; col < cols; col++ ) {
				const i = row * cols + col;
				if ( col < cols - 1 ) {
					constraints.push( { a: i, b: i + 1, rest: restX } );
				}
				if ( row < rows - 1 ) {
					constraints.push( { a: i, b: i + cols, rest: restY } );
				}
			}
		}

		const canvasOrigin = (): { left: number; top: number } => {
			// The stage canvas is the coordinate space the mesh lives in.
			const host = element.ownerDocument?.getElementById(
				'desktop-mode-stage',
			);
			const box = host?.getBoundingClientRect();
			return { left: box?.left ?? 0, top: box?.top ?? 0 };
		};

		return new Promise< void >( ( resolve ) => {
			let finished = false;

			const finish = (): void => {
				if ( finished ) {
					return;
				}
				finished = true;
				ticker.remove( step );
				// Deliberately NOT destroying the mesh. The engine gives
				// every effect its own container and destroys it whole,
				// so freeing our own objects here only created a
				// double-destroy race with that teardown.
				resolve();
			};

			// Drag-end does not end the effect — it starts the settle.
			let settleMs = 0;

			const step = ( t: { deltaMS: number } ): void => {
				/*
				 * Two very different stop conditions.
				 *
				 * A destroyed sprite or mesh means the ENGINE tore this
				 * effect down — the window was superseded by a new drag
				 * while this one was still settling, and our display
				 * objects are already gone. Keep simulating and we write
				 * into freed objects and take the renderer down with us.
				 * Stop immediately, no settle.
				 *
				 * `signal.aborted` is the gentler one: the drag ended, and
				 * the sheet should swing itself to rest (below).
				 */
				if (
					( sprite as { destroyed?: boolean } ).destroyed === true ||
					( mesh as unknown as { destroyed?: boolean } ).destroyed === true
				) {
					finish();
					return;
				}

				const dt = Math.min( MAX_STEP_S, t.deltaMS / 1000 );

				// The signal aborts at drag-end. Rather than cutting the
				// animation dead — which is what made it stop with a jolt
				// — keep simulating against a stationary pin line so the
				// sheet swings itself to rest, then hand the window back.
				const settling = ctx.signal.aborted;
				if ( settling ) {
					settleMs += t.deltaMS;
				}

				// Re-pin the top row to where the window actually is now.
				// This is what makes the cloth follow the pointer: the
				// hidden element is still being dragged, so its box is the
				// live truth. During the settle it has stopped moving, so
				// the same read simply holds the sheet in place.
				const box = element.getBoundingClientRect();
				const origin = canvasOrigin();
				const left = box.left - origin.left;
				const top = box.top - origin.top;

				// The engine stopped tracking the shadow the moment the
				// sprite went invisible, so it is ours: keep it under the
				// pin line, where the window itself actually is. The sheet
				// swinging away from its own shadow is what a hanging
				// cloth does.
				if ( shadow ) {
					shadow.x = left;
					shadow.y = top;
				}
				for ( let col = 0; col < cols; col++ ) {
					const p = particles[ col ];
					p.x = left + ( box.width * col ) / ( cols - 1 );
					p.y = top;
					p.px = p.x;
					p.py = p.y;
				}

				// Verlet integration.
				const gravity = params.gravity * dt * dt;
				for ( const p of particles ) {
					if ( p.pinned ) {
						continue;
					}
					const vx = ( p.x - p.px ) * params.damping;
					const vy = ( p.y - p.py ) * params.damping;
					p.px = p.x;
					p.py = p.y;
					p.x += vx;
					p.y += vy + gravity;
				}

				// Constraint relaxation.
				for ( let pass = 0; pass < RELAX_PASSES; pass++ ) {
					for ( const c of constraints ) {
						const a = particles[ c.a ];
						const b = particles[ c.b ];
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const dist = Math.hypot( dx, dy ) || 0.0001;
						const diff = ( ( dist - c.rest ) / dist ) * params.stiffness;
						const ox = dx * 0.5 * diff;
						const oy = dy * 0.5 * diff;
						if ( ! a.pinned ) {
							a.x += ox;
							a.y += oy;
						}
						if ( ! b.pinned ) {
							b.x -= ox;
							b.y -= oy;
						}
					}
				}

				/*
				 * Settling: ease every particle back onto the window's
				 * true rectangle.
				 *
				 * Damping alone was not enough. Gravity never stops
				 * pulling, so the sheet came to rest SAGGING — and when
				 * the effect ended and the real window reappeared crisp
				 * and rectangular, that swap read as the window suddenly
				 * "resetting". Blending back to the exact grid means the
				 * mesh matches the window by the time it is swapped, so
				 * the hand-off is invisible.
				 *
				 * The physics keep running underneath the blend, so the
				 * swing is still visible while it straightens out.
				 */
				let settled = false;
				if ( settling ) {
					const k = Math.min( 1, settleMs / MAX_SETTLE_MS );
					// easeInOutCubic — barely touches the first frames, so
					// the swing reads before the sheet firms up.
					const blend =
						k < 0.5
							? 4 * k * k * k
							: 1 - Math.pow( -2 * k + 2, 3 ) / 2;

					for ( let row = 0; row < rows; row++ ) {
						for ( let col = 0; col < cols; col++ ) {
							const p = particles[ row * cols + col ];
							if ( p.pinned ) {
								continue;
							}
							const targetX =
								left + ( box.width * col ) / ( cols - 1 );
							const targetY =
								top + ( box.height * row ) / ( rows - 1 );
							p.x += ( targetX - p.x ) * blend;
							p.y += ( targetY - p.y ) * blend;
						}
					}

					settled = k >= 1;
				}

				// Push the solved grid into the mesh's vertex buffer.
				const positions = mesh.geometry.positions;
				for ( let i = 0; i < particles.length; i++ ) {
					positions[ i * 2 ] = particles[ i ].x;
					positions[ i * 2 + 1 ] = particles[ i ].y;
				}
				mesh.geometry.getBuffer( 'aPosition' ).update();

				// Finish AFTER the write, never before: the engine keeps
				// this mesh on screen for a frame or two while the real
				// window comes back, so the last shape it holds has to be
				// the fully-blended one — the exact window rectangle.
				if ( settled ) {
					finish();
				}
			};

			ticker.add( step );
		} );
	},
};
