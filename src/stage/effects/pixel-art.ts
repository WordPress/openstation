/**
 * Desktop Mode — Pixel-art screen effect.
 *
 * Snaps the desktop to a coarse pixel grid and, optionally, quantizes
 * each colour channel to a fixed number of levels — the whole admin
 * rendered as if it were a sprite from a 16-bit console.
 *
 * Runs first in the chain (order 10) so everything downstream operates
 * on the already-blocky image. Put it last instead and the scanlines
 * would themselves be pixelated into mush.
 *
 * Sampling takes the centre of each block (`floor(px / size) + 0.5`),
 * which lands on a texel centre and so reads a single texel even under
 * the render target's default linear filtering — no sampler-state
 * fiddling needed to get crisp blocks.
 *
 * @since 0.9.8
 */

import { __ } from '../../i18n';
import type { ScreenEffectContext, ScreenEffectDef } from '../types';
import { FILTER_VERTEX, uniformsOf } from './shared';

const GROUP = 'pixelArtUniforms';

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;

uniform float uPixelSize;
uniform float uColorLevels;

void main(void)
{
    float size = max(uPixelSize, 1.0);

    vec2 px = vTextureCoord * uInputSize.xy;
    vec2 block = (floor(px / size) + 0.5) * size;
    vec2 uv = clamp(block * uInputSize.zw, uInputClamp.xy, uInputClamp.zw);

    vec4 color = texture(uTexture, uv);

    if (uColorLevels >= 2.0) {
        if (color.a > 0.0) { color.rgb /= color.a; }
        color.rgb = floor(color.rgb * uColorLevels + 0.5) / uColorLevels;
        color.rgb *= color.a;
    }

    finalColor = color;
}
`;

export const pixelArtEffect: ScreenEffectDef = {
	id: 'pixel-art',
	label: __( 'Pixel art' ),
	description: __(
		'Snap the desktop to a chunky pixel grid, optionally with a reduced colour palette.',
	),
	order: 10,
	params: [
		{
			key: 'pixelSize',
			label: __( 'Pixel size' ),
			min: 1,
			max: 24,
			step: 1,
			default: 4,
			suffix: 'px',
		},
		{
			// 0 and 1 both mean "leave colours alone" — the shader only
			// quantizes at 2 levels and up. Exposed from 0 so the slider
			// has an explicit off position at its left edge.
			key: 'colorLevels',
			label: __( 'Colour levels' ),
			min: 0,
			max: 32,
			step: 1,
			default: 0,
		},
	],

	createFilter( ctx: ScreenEffectContext ) {
		const { Filter, GlProgram, UniformGroup } = ctx.pixi;
		return new Filter( {
			glProgram: GlProgram.from( {
				vertex: FILTER_VERTEX,
				fragment: FRAGMENT,
				name: 'desktop-mode-pixel-art',
			} ),
			resources: {
				[ GROUP ]: new UniformGroup( {
					uPixelSize: { value: ctx.params.pixelSize, type: 'f32' },
					uColorLevels: { value: ctx.params.colorLevels, type: 'f32' },
				} ),
			},
		} );
	},

	update( filter, ctx ) {
		const uniforms = uniformsOf( filter, GROUP );
		if ( ! uniforms ) {
			return;
		}
		uniforms.uPixelSize = ctx.params.pixelSize;
		uniforms.uColorLevels = ctx.params.colorLevels;
	},
};
