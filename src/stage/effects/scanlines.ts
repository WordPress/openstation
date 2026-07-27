/**
 * Desktop Mode — Scanlines screen effect.
 *
 * Lays alternating dark bands over the whole desktop, the way a CRT's
 * electron beam left unlit gaps between raster lines. Sits at order 20
 * so it runs *after* pixelation but *before* the CRT tube — that way
 * the tube's curvature bends the scanlines along with everything else,
 * which is what a real curved screen does.
 *
 * The band profile is a cosine rather than a hard step: at small line
 * heights a hard step aliases badly against the device pixel grid, and
 * a non-integer line height would shimmer as the window resizes.
 *
 * @since 0.9.8
 */

import { __ } from '../../i18n';
import type { ScreenEffectContext, ScreenEffectDef } from '../types';
import { FILTER_VERTEX, uniformsOf } from './shared';

const GROUP = 'scanlineUniforms';

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;

uniform float uIntensity;
uniform float uLineHeight;
uniform float uRoll;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);

    float y = vTextureCoord.y * uInputSize.y + uRoll;
    float phase = fract(y / max(uLineHeight, 1.0));
    float band = 0.5 + 0.5 * cos(phase * 6.2831853);

    if (color.a > 0.0) { color.rgb /= color.a; }
    color.rgb *= 1.0 - uIntensity * band;
    color.rgb *= color.a;

    finalColor = color;
}
`;

export const scanlinesEffect: ScreenEffectDef = {
	id: 'scanlines',
	label: __( 'Scanlines' ),
	description: __(
		'Lay dark raster lines over the desktop, like the gaps between an old monitor’s scan lines.',
	),
	order: 20,
	params: [
		{
			key: 'intensity',
			label: __( 'Intensity' ),
			min: 0,
			max: 1,
			step: 0.01,
			default: 0.35,
		},
		{
			key: 'lineHeight',
			label: __( 'Line height' ),
			min: 1,
			max: 12,
			step: 1,
			default: 3,
			suffix: 'px',
		},
		{
			key: 'rollSpeed',
			label: __( 'Roll speed' ),
			min: 0,
			max: 120,
			step: 1,
			default: 0,
			suffix: 'px/s',
		},
	],

	createFilter( ctx: ScreenEffectContext ) {
		const { Filter, GlProgram, UniformGroup } = ctx.pixi;
		return new Filter( {
			glProgram: GlProgram.from( {
				vertex: FILTER_VERTEX,
				fragment: FRAGMENT,
				name: 'desktop-mode-scanlines',
			} ),
			resources: {
				[ GROUP ]: new UniformGroup( {
					uIntensity: { value: ctx.params.intensity, type: 'f32' },
					uLineHeight: { value: ctx.params.lineHeight, type: 'f32' },
					uRoll: { value: 0, type: 'f32' },
				} ),
			},
		} );
	},

	update( filter, ctx ) {
		const uniforms = uniformsOf( filter, GROUP );
		if ( ! uniforms ) {
			return;
		}
		uniforms.uIntensity = ctx.params.intensity;
		uniforms.uLineHeight = ctx.params.lineHeight;
	},

	tick( filter, elapsed, ctx ) {
		// A scrolling overlay across the whole desktop is exactly the
		// motion `prefers-reduced-motion` is about — hold it still.
		if ( ctx.params.rollSpeed === 0 || ctx.reducedMotion ) {
			return;
		}
		const uniforms = uniformsOf( filter, GROUP );
		if ( ! uniforms ) {
			return;
		}
		// Wrap on the line height so the value stays small no matter how
		// long the session has been open — a float that grows for hours
		// loses the precision the fract() depends on.
		const period = Math.max( ctx.params.lineHeight, 1 );
		uniforms.uRoll = ( elapsed * ctx.params.rollSpeed ) % period;
	},
};
