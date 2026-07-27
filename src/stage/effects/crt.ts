/**
 * Desktop Mode — CRT tube screen effect.
 *
 * The full picture-tube treatment: barrel-distorted glass, an aperture
 * grille phosphor mask, RGB convergence error at the edges, a vignette
 * into the corners, and a slow mains-hum flicker. Runs last (order 30)
 * so it curves whatever the earlier effects produced.
 *
 * **Hit-testing caveat.** Curvature moves *pixels*, not the DOM. The
 * shell underneath is still laid out flat, so under heavy curvature a
 * click near the edge of the screen lands where the element really is,
 * a few pixels from where it visually appears. That is inherent to
 * post-processing a live DOM subtree — the browser hit-tests the
 * element, not our shader — which is why curvature is a slider that
 * defaults low rather than a fixed dramatic value.
 *
 * @since 0.9.8
 */

import { __ } from '../../i18n';
import type { ScreenEffectContext, ScreenEffectDef } from '../types';
import { FILTER_VERTEX, uniformsOf } from './shared';

const GROUP = 'crtUniforms';

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform vec4 uInputClamp;

// Size of the filtered area in device pixels, supplied by the stage.
//
// This used to read Pixi's uOutputFrame.zw, which is declared in the
// stock filter VERTEX shader. Reading it from the fragment stage gave
// zeroes, so every UV landed outside 0..1, the bezel early-out below
// caught every pixel, and the whole screen rendered black. Passing the
// value explicitly keeps this shader independent of which uniforms
// happen to be live in which stage.
uniform vec2 uFrameSize;

uniform float uCurvature;
uniform float uMask;
uniform float uAberration;
uniform float uVignette;
uniform float uFlicker;
uniform float uTime;

void main(void)
{
    // Fail open, never black.
    //
    // Every coordinate below is derived from uFrameSize, and the bezel
    // test then rejects anything outside 0..1 — so a bad frame size
    // blanks the ENTIRE desktop rather than degrading. That is exactly
    // what happened when this shader read uOutputFrame in the fragment
    // stage and got zeroes. If the value ever looks degenerate again,
    // pass the picture through untouched instead.
    if (uFrameSize.x < 2.0 || uFrameSize.y < 2.0) {
        finalColor = texture(uTexture, vTextureCoord);
        return;
    }

    vec2 frameSize = uFrameSize;

    // Normalised 0..1 across the filtered area, independent of any
    // padding in the pooled input texture.
    vec2 uv = vTextureCoord * uInputSize.xy / frameSize;

    // Barrel distortion about the centre of the tube.
    vec2 centred = uv - 0.5;
    float r2 = dot(centred, centred);
    vec2 warped = uv + centred * r2 * uCurvature;

    // Past the glass edge there is no picture — that is the bezel.
    if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
        finalColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec2 base = warped * frameSize * uInputSize.zw;

    // Convergence error grows towards the edges, as on a real tube.
    vec2 offset = vec2(uAberration * r2 * 4.0 * uInputSize.z, 0.0);

    vec4 centre = texture(uTexture, clamp(base, uInputClamp.xy, uInputClamp.zw));
    float red = texture(uTexture, clamp(base + offset, uInputClamp.xy, uInputClamp.zw)).r;
    float blue = texture(uTexture, clamp(base - offset, uInputClamp.xy, uInputClamp.zw)).b;

    float alpha = centre.a;
    vec3 rgb = vec3(red, centre.g, blue);
    if (alpha > 0.0) { rgb /= alpha; }

    // Aperture grille: each device pixel column belongs to one phosphor
    // stripe and the other two channels are attenuated there.
    vec3 mask = vec3(1.0 - uMask);
    float stripe = mod(floor(warped.x * frameSize.x), 3.0);
    if (stripe < 1.0) { mask.r = 1.0; }
    else if (stripe < 2.0) { mask.g = 1.0; }
    else { mask.b = 1.0; }
    rgb *= mask;

    // Vignette, measured from the tube centre.
    rgb *= clamp(1.0 - uVignette * r2 * 4.0, 0.0, 1.0);

    // Brightness ripple. uTime is a PHASE in turns (0..1) advanced by
    // the CPU at the user's chosen rate, not a raw clock — so the speed
    // is a parameter rather than baked into this constant.
    rgb *= 1.0 - uFlicker * 0.5 * (0.5 + 0.5 * sin(uTime * 6.2831853));

    rgb *= alpha;
    finalColor = vec4(rgb, alpha);
}
`;

/** Filtered area in device pixels — what the shader samples in. */
function frameSize( ctx: ScreenEffectContext ): [ number, number ] {
	const resolution = ctx.resolution || 1;
	return [
		Math.max( 1, ctx.screen.width * resolution ),
		Math.max( 1, ctx.screen.height * resolution ),
	];
}

export const crtEffect: ScreenEffectDef = {
	id: 'crt',
	label: __( 'CRT tube' ),
	description: __(
		'Curve the desktop onto a picture tube, with a phosphor mask, colour fringing and a vignette.',
	),
	order: 30,
	params: [
		{
			key: 'curvature',
			label: __( 'Curvature' ),
			min: 0,
			max: 0.6,
			step: 0.01,
			default: 0.12,
		},
		{
			key: 'mask',
			label: __( 'Phosphor mask' ),
			min: 0,
			max: 1,
			step: 0.01,
			default: 0.25,
		},
		{
			key: 'aberration',
			label: __( 'Colour fringing' ),
			min: 0,
			max: 8,
			step: 0.1,
			default: 1.2,
			suffix: 'px',
		},
		{
			key: 'vignette',
			label: __( 'Vignette' ),
			min: 0,
			max: 1,
			step: 0.01,
			default: 0.25,
		},
		{
			key: 'flicker',
			label: __( 'Flicker' ),
			min: 0,
			max: 1,
			step: 0.01,
			// Kept on, gently. The hazard in the first version was the
			// fixed 10 Hz RATE, not the effect existing — a 2.5%
			// brightness sine at ~1 Hz reads as a warm tube rather than a
			// flash, and it is the character people want from a CRT.
			default: 0.05,
		},
		{
			key: 'flickerSpeed',
			label: __( 'Flicker speed' ),
			min: 0.1,
			// Capped at 3 Hz on purpose. WCAG 2.3.1 asks for no more than
			// three flashes in any one second; a faster full-screen
			// brightness oscillation is a photosensitivity risk, not a
			// style choice. The first version of this shader ran at a
			// fixed 10 Hz, which is squarely in the range to avoid.
			max: 3,
			step: 0.1,
			default: 1,
			suffix: 'Hz',
		},
	],

	createFilter( ctx: ScreenEffectContext ) {
		const { Filter, GlProgram, UniformGroup } = ctx.pixi;
		return new Filter( {
			glProgram: GlProgram.from( {
				vertex: FILTER_VERTEX,
				fragment: FRAGMENT,
				name: 'desktop-mode-crt',
			} ),
			resources: {
				[ GROUP ]: new UniformGroup( {
					// vec2 in DEVICE pixels: the stage renders at
					// `resolution`, so the filter's input texture is at
					// device scale while `ctx.screen` is in CSS pixels.
					uFrameSize: { value: frameSize( ctx ), type: 'vec2<f32>' },
					uCurvature: { value: ctx.params.curvature, type: 'f32' },
					uMask: { value: ctx.params.mask, type: 'f32' },
					uAberration: { value: ctx.params.aberration, type: 'f32' },
					uVignette: { value: ctx.params.vignette, type: 'f32' },
					uFlicker: { value: ctx.params.flicker, type: 'f32' },
					uTime: { value: 0, type: 'f32' },
				} ),
			},
		} );
	},

	update( filter, ctx ) {
		const uniforms = uniformsOf( filter, GROUP );
		if ( ! uniforms ) {
			return;
		}
		// Refreshed here as well as at build time: `_resize()` re-runs
		// every effect's `update`, which is how this tracks the window.
		const size = frameSize( ctx );
		const target = uniforms.uFrameSize as unknown as
			| Float32Array
			| number[]
			| undefined;
		if ( target && typeof target !== 'number' ) {
			target[ 0 ] = size[ 0 ];
			target[ 1 ] = size[ 1 ];
		}
		uniforms.uCurvature = ctx.params.curvature;
		uniforms.uMask = ctx.params.mask;
		uniforms.uAberration = ctx.params.aberration;
		uniforms.uVignette = ctx.params.vignette;
		uniforms.uFlicker = ctx.params.flicker;
	},

	tick( filter, elapsed, ctx ) {
		// Reduced motion: hold the tube at full brightness rather than
		// pulsing it. The user asked for less motion; a slow pulse is
		// still motion.
		if ( ctx.params.flicker === 0 || ctx.reducedMotion ) {
			return;
		}
		const uniforms = uniformsOf( filter, GROUP );
		if ( ! uniforms ) {
			return;
		}
		// Phase in turns, wrapped to 0..1 so the float stays small over a
		// long session without the waveform jumping.
		uniforms.uTime = ( elapsed * ctx.params.flickerSpeed ) % 1;
	},
};
