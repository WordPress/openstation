/**
 * Mio's blurred layers keep their additive blending.
 *
 * **A Pixi filter cancels its container's blend mode.** `halo` and
 * `sheen` both set `blendMode = 'add'` on the Graphics, and that holds
 * exactly until a filter is attached. From then on Pixi renders the
 * layer to a texture and composites that texture with
 * `filter._state.blendMode` — `FilterSystem.applyFilter` draws with
 * `state: filter._state` and never looks at the container.
 * `Filter.defaultOptions.blendMode` is `'normal'`, so a `BlurFilter`
 * built without the option silently downgrades the layer.
 *
 * For a glow that is not a nuance. Additive over a dark desk is light
 * spilling onto the wallpaper; the same band under normal alpha is a
 * flat translucent slab with a legible boundary — a sticker, not a
 * light source. It also makes the filter region's own rectangular edge
 * visible, which is what a hard-cornered "glow" turns out to be.
 *
 * The invariant is asserted against the source text rather than a live
 * Mio: `applyGlow` and `applySheenBlur` are private to `mio.ts`, and
 * reaching them means booting Pixi, a canvas and a soft body — none of
 * which is what went wrong. What went wrong is a missing option at a
 * construction site, so the construction sites are what get counted.
 * A third filter added later is caught by the same sweep.
 */
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
	join( __dirname, '../../src/mio/mio.ts' ),
	'utf8',
);

/** Every `new …BlurFilter( { … } )` call in the module, options and all. */
function blurFilterCalls(): string[] {
	return Array.from(
		source.matchAll( /new\s+\w+\.BlurFilter\(\s*\{([\s\S]*?)\}\s*\)/g ),
		( m ) => m[ 1 ],
	);
}

describe( 'Mio glow blending', () => {
	test( 'both blurred layers are still constructed', () => {
		// A guard that silently matched nothing would pass forever.
		expect( blurFilterCalls() ).toHaveLength( 2 );
	} );

	test( 'every BlurFilter declares an additive blend mode', () => {
		for ( const options of blurFilterCalls() ) {
			expect( options ).toMatch( /blendMode:\s*GLOW_BLEND/ );
		}
		expect( source ).toMatch( /const GLOW_BLEND = 'add'/ );
	} );

	test( 'the layers still ask for additive blending themselves', () => {
		// The filters restate it, but the layers are what render when
		// the blur is off — `glowBlur` unticked, `iridescence` at 0, or
		// a trimmed Pixi build with no `BlurFilter` at all.
		for ( const layer of [ 'halo', 'bloom', 'sheen' ] ) {
			expect( source ).toMatch(
				new RegExp( `${ layer }\\.blendMode = 'add'` ),
			);
		}
	} );
} );
