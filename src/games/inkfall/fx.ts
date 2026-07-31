/**
 * Inkfall — effects: the musical-note flight, the word tear
 * (per-character scatter), and the ink-blot miss marker.
 *
 * Friendly vocabulary by design (content rule: no war terms): a
 * completed word sends a NOTE up the page; on arrival the word
 * TEARS into characters that SCATTER and fade; a missed word leaves
 * an ink BLOT on the page bottom.
 *
 * Trajectory math lives in `fx-math.ts` (pure, tested); this module
 * owns the Pixi display objects and their per-frame updates.
 */

import {
	SCATTER_LIFETIME,
	integrateStep,
	scatterAlpha,
	scatterVelocities,
	type ScatterParticle,
} from './fx-math';
import {
	ACCENT_COLOR,
	INK_COLOR,
	WORD_FONT,
	WORD_FONT_SIZE,
	type WordSprite,
} from './scene';
import type { PixiContainer, PixiNamespace, PixiText } from '../pixi-types';

const NOTE_GLYPHS = [ '♪', '♫', '♩', '♬' ];
const NOTE_FLIGHT_SECONDS = 0.18;
const BLOT_LIFETIME = 1.1;

interface NoteFlight {
	kind: 'note';
	node: PixiText;
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	age: number;
	onArrive: () => void;
}

interface ScatterChar {
	node: PixiText;
	particle: ScatterParticle;
}

interface Scatter {
	kind: 'scatter';
	chars: ScatterChar[];
	age: number;
}

interface Blot {
	kind: 'blot';
	node: PixiContainer;
	age: number;
}

type Effect = NoteFlight | Scatter | Blot;

export interface FxLayer {
	/** Launch a note from the page bottom toward a point; fires `onArrive` on impact. */
	launchNote: (
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		onArrive: () => void,
	) => void;
	/** Tear a word sprite into scattering characters (removes the sprite). */
	tearWord: ( sprite: WordSprite ) => void;
	/** Splash an ink blot where a word reached the page bottom. */
	splashBlot: ( x: number, y: number ) => void;
	/** Advance every live effect by `dt` seconds. */
	update: ( dt: number ) => void;
	/** True while any effect is animating (game-over drain check). */
	busy: () => boolean;
	/** Drop every live effect (teardown). */
	clear: () => void;
}

export function createFxLayer(
	pixi: PixiNamespace,
	stage: PixiContainer,
	rng: () => number = Math.random,
): FxLayer {
	const effects: Effect[] = [];

	const remove = ( effect: Effect ): void => {
		const idx = effects.indexOf( effect );
		if ( idx >= 0 ) {
			effects.splice( idx, 1 );
		}
		if ( 'scatter' === effect.kind ) {
			for ( const char of effect.chars ) {
				stage.removeChild( char.node );
				char.node.destroy();
			}
			return;
		}
		stage.removeChild( effect.node );
		effect.node.destroy();
	};

	return {
		launchNote( fromX, fromY, toX, toY, onArrive ) {
			const glyph =
				NOTE_GLYPHS[ Math.floor( rng() * NOTE_GLYPHS.length ) ] ??
				NOTE_GLYPHS[ 0 ];
			const node = new pixi.Text( {
				text: glyph,
				style: {
					fill: ACCENT_COLOR,
					fontSize: 30,
					fontFamily: WORD_FONT,
				},
			} );
			node.anchor.set( 0.5 );
			node.x = fromX;
			node.y = fromY;
			node.zIndex = 30;
			stage.addChild( node );
			effects.push( {
				kind: 'note',
				node,
				fromX,
				fromY,
				toX,
				toY,
				age: 0,
				onArrive,
			} );
		},

		tearWord( sprite ) {
			// Cache per-character x offsets BEFORE removing the sprite:
			// measure prefix widths with a scratch Text.
			const scratch = new pixi.Text( {
				text: '',
				style: {
					fill: INK_COLOR,
					fontSize: WORD_FONT_SIZE,
					fontFamily: WORD_FONT,
				},
			} );
			const offsets: number[] = [];
			for ( let i = 0; i < sprite.text.length; i++ ) {
				scratch.text = sprite.text.slice( 0, i );
				offsets.push( scratch.width );
			}
			scratch.destroy();

			const particles = scatterVelocities( sprite.text.length, rng );
			const chars: ScatterChar[] = [];
			for ( let i = 0; i < sprite.text.length; i++ ) {
				const node = new pixi.Text( {
					text: sprite.text[ i ],
					style: {
						fill: ACCENT_COLOR,
						fontSize: WORD_FONT_SIZE,
						fontFamily: WORD_FONT,
					},
				} );
				node.anchor.set( 0.5 );
				node.x = sprite.container.x + offsets[ i ] + 7;
				node.y = sprite.container.y + WORD_FONT_SIZE / 2;
				node.zIndex = 20;
				stage.addChild( node );
				chars.push( { node, particle: particles[ i ] } );
			}
			stage.removeChild( sprite.container );
			sprite.container.destroy( { children: true } );
			effects.push( { kind: 'scatter', chars, age: 0 } );
		},

		splashBlot( x, y ) {
			const blot = new pixi.Graphics();
			blot.circle( 0, 0, 9 ).fill( { color: INK_COLOR, alpha: 0.8 } );
			blot.ellipse( -12, 3, 4, 2.5 ).fill( { color: INK_COLOR, alpha: 0.6 } );
			blot.ellipse( 11, -2, 3, 2 ).fill( { color: INK_COLOR, alpha: 0.6 } );
			blot.circle( 6, 7, 2.5 ).fill( { color: INK_COLOR, alpha: 0.5 } );
			blot.x = x;
			blot.y = y;
			blot.zIndex = 10;
			stage.addChild( blot );
			effects.push( { kind: 'blot', node: blot, age: 0 } );
		},

		update( dt ) {
			for ( const effect of effects.slice() ) {
				effect.age += dt;
				if ( 'note' === effect.kind ) {
					const progress = Math.min(
						1,
						effect.age / NOTE_FLIGHT_SECONDS,
					);
					// Slight arc: lateral ease-out, vertical ease-in.
					const eased = 1 - ( 1 - progress ) * ( 1 - progress );
					effect.node.x =
						effect.fromX + ( effect.toX - effect.fromX ) * eased;
					effect.node.y =
						effect.fromY +
						( effect.toY - effect.fromY ) * progress * progress;
					effect.node.rotation = progress * 0.6;
					if ( progress >= 1 ) {
						const arrive = effect.onArrive;
						remove( effect );
						arrive();
					}
					continue;
				}
				if ( 'scatter' === effect.kind ) {
					for ( const char of effect.chars ) {
						const step = integrateStep( char.particle, dt );
						char.node.x += step.dx;
						char.node.y += step.dy;
						char.node.rotation += step.dRotation;
						char.particle.vy = step.vyNext;
						char.node.alpha = scatterAlpha( effect.age );
					}
					if ( effect.age >= SCATTER_LIFETIME ) {
						remove( effect );
					}
					continue;
				}
				// Blot: sit, then fade out over the tail of its life.
				const fadeStart = BLOT_LIFETIME * 0.4;
				if ( effect.age <= fadeStart ) {
					effect.node.alpha = 1;
				} else {
					const fade =
						( effect.age - fadeStart ) /
						( BLOT_LIFETIME - fadeStart );
					effect.node.alpha = Math.max( 0, 1 - fade );
				}
				if ( effect.age >= BLOT_LIFETIME ) {
					remove( effect );
				}
			}
		},

		busy() {
			return effects.length > 0;
		},

		clear() {
			for ( const effect of effects.slice() ) {
				remove( effect );
			}
		},
	};
}
