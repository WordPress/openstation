/**
 * Alphabet Soup — effects: letter-burst particles, floating score
 * text, wave banners, and the wave-clear confetti rain.
 *
 * Pure dopamine, zero gameplay: everything here is decorative and
 * time-based via `update( dt )`. Randomness is allowed (it is
 * visual only) — the PUZZLE stays seeded; the sparkle does not
 * have to be.
 */

import type {
	PixiContainer,
	PixiGraphics,
	PixiNamespace,
	PixiText,
} from '../pixi-types';
import { TILE_FONT } from './board';

const GRAVITY = 560;
const BURST_LIFETIME = 0.7;
const SCORE_LIFETIME = 0.9;
const BANNER_LIFETIME = 1.4;
const CONFETTI_LIFETIME = 1.6;

interface BurstParticle {
	node: PixiGraphics;
	vx: number;
	vy: number;
}

interface Burst {
	kind: 'burst';
	parts: BurstParticle[];
	age: number;
}

interface FloatScore {
	kind: 'score';
	node: PixiText;
	age: number;
}

interface Banner {
	kind: 'banner';
	node: PixiText;
	age: number;
}

interface ConfettiPiece {
	node: PixiGraphics;
	vx: number;
	vy: number;
	spin: number;
}

interface Confetti {
	kind: 'confetti';
	parts: ConfettiPiece[];
	age: number;
}

type Effect = Burst | FloatScore | Banner | Confetti;

export interface SoupFx {
	/** Particle burst at a point, tinted to the found word's color. */
	burstAt: ( x: number, y: number, color: number ) => void;
	/** A "+120" that rises and fades. */
	floatScore: ( x: number, y: number, text: string, color: number ) => void;
	/** Center-stage banner ("Wave 2!") that swells and fades. */
	banner: ( text: string, centerX: number, centerY: number ) => void;
	/** Confetti rain across the top (wave clear). */
	confetti: ( width: number, colors: readonly number[] ) => void;
	/** Advance every live effect. */
	update: ( dt: number ) => void;
	/** Drop everything (teardown / new wave). */
	clear: () => void;
}

export function createSoupFx(
	pixi: PixiNamespace,
	stage: PixiContainer,
	rng: () => number = Math.random,
): SoupFx {
	const effects: Effect[] = [];

	const remove = ( effect: Effect ): void => {
		const idx = effects.indexOf( effect );
		if ( idx >= 0 ) {
			effects.splice( idx, 1 );
		}
		if ( 'burst' === effect.kind || 'confetti' === effect.kind ) {
			for ( const part of effect.parts ) {
				stage.removeChild( part.node );
				part.node.destroy();
			}
			return;
		}
		stage.removeChild( effect.node );
		effect.node.destroy();
	};

	return {
		burstAt( x, y, color ) {
			const parts: BurstParticle[] = [];
			const count = 10;
			for ( let i = 0; i < count; i++ ) {
				const node = new pixi.Graphics();
				node.circle( 0, 0, 2 + rng() * 2.5 ).fill( { color, alpha: 0.95 } );
				node.x = x;
				node.y = y;
				node.zIndex = 30;
				stage.addChild( node );
				const angle = ( i / count ) * Math.PI * 2 + rng() * 0.6;
				const speed = 90 + rng() * 160;
				parts.push( {
					node,
					vx: Math.cos( angle ) * speed,
					vy: Math.sin( angle ) * speed - 60,
				} );
			}
			effects.push( { kind: 'burst', parts, age: 0 } );
		},

		floatScore( x, y, text, color ) {
			const node = new pixi.Text( {
				text,
				style: {
					fill: color,
					fontSize: 22,
					fontFamily: TILE_FONT,
					fontWeight: '700',
				},
				resolution: 2,
			} );
			node.anchor.set( 0.5 );
			node.x = x;
			node.y = y;
			node.zIndex = 35;
			stage.addChild( node );
			effects.push( { kind: 'score', node, age: 0 } );
		},

		banner( text, centerX, centerY ) {
			const node = new pixi.Text( {
				text,
				style: {
					fill: 0xffffff,
					fontSize: 40,
					fontFamily: TILE_FONT,
					fontWeight: '700',
				},
				resolution: 2,
			} );
			node.anchor.set( 0.5 );
			node.x = centerX;
			node.y = centerY;
			node.zIndex = 40;
			node.alpha = 0;
			stage.addChild( node );
			effects.push( { kind: 'banner', node, age: 0 } );
		},

		confetti( width, colors ) {
			const parts: ConfettiPiece[] = [];
			const count = 36;
			for ( let i = 0; i < count; i++ ) {
				const node = new pixi.Graphics();
				const color = colors[ Math.floor( rng() * colors.length ) ];
				node.roundRect( -3, -5, 6, 10, 2 ).fill( { color, alpha: 0.95 } );
				node.x = rng() * width;
				node.y = -14 - rng() * 40;
				node.rotation = rng() * Math.PI;
				node.zIndex = 30;
				stage.addChild( node );
				parts.push( {
					node,
					vx: ( rng() - 0.5 ) * 90,
					vy: 120 + rng() * 160,
					spin: ( rng() - 0.5 ) * 8,
				} );
			}
			effects.push( { kind: 'confetti', parts, age: 0 } );
		},

		update( dt ) {
			for ( const effect of effects.slice() ) {
				effect.age += dt;
				if ( 'burst' === effect.kind ) {
					for ( const part of effect.parts ) {
						part.vy += GRAVITY * dt;
						part.node.x += part.vx * dt;
						part.node.y += part.vy * dt;
						part.node.alpha = Math.max(
							0,
							1 - effect.age / BURST_LIFETIME,
						);
					}
					if ( effect.age >= BURST_LIFETIME ) {
						remove( effect );
					}
					continue;
				}
				if ( 'score' === effect.kind ) {
					const progress = effect.age / SCORE_LIFETIME;
					effect.node.y -= 46 * dt;
					effect.node.alpha = Math.max( 0, 1 - progress * progress );
					if ( effect.age >= SCORE_LIFETIME ) {
						remove( effect );
					}
					continue;
				}
				if ( 'banner' === effect.kind ) {
					const progress = Math.min( 1, effect.age / BANNER_LIFETIME );
					// Swell in fast, hold, fade out.
					const inT = Math.min( 1, progress / 0.18 );
					const eased = 1 - ( 1 - inT ) * ( 1 - inT );
					effect.node.scale.set( 0.6 + 0.4 * eased );
					effect.node.alpha =
						progress < 0.75
							? eased
							: Math.max( 0, 1 - ( progress - 0.75 ) / 0.25 );
					if ( effect.age >= BANNER_LIFETIME ) {
						remove( effect );
					}
					continue;
				}
				// Confetti.
				for ( const part of effect.parts ) {
					part.node.x += part.vx * dt;
					part.node.y += part.vy * dt;
					part.node.rotation += part.spin * dt;
					part.node.alpha = Math.max(
						0,
						1 - effect.age / CONFETTI_LIFETIME,
					);
				}
				if ( effect.age >= CONFETTI_LIFETIME ) {
					remove( effect );
				}
			}
		},

		clear() {
			for ( const effect of effects.slice() ) {
				remove( effect );
			}
		},
	};
}
