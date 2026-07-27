/**
 * Desktop Mode — Shared shader scaffolding for the built-in screen effects.
 *
 * Every built-in effect is a Pixi v8 `Filter` with a GLSL fragment
 * shader. Pixi's own filters (`AlphaFilter`, `DisplacementFilter`, …)
 * establish the conventions we follow verbatim:
 *
 * - the vertex shader is Pixi's stock filter vertex shader, reproduced
 *   below so the bundle does not reach into `pixi.js` internals;
 * - custom uniforms go in a `UniformGroup` passed as a named entry in
 *   `resources`, and are declared as plain `uniform` in the fragment;
 * - `uInputSize` (`xy` = input texture size in px, `zw` = 1/size),
 *   `uInputClamp` (`xy`/`zw` = the safe UV rectangle inside a pooled,
 *   possibly oversized input texture) and `uOutputFrame` (`zw` = the
 *   filtered area's size in px) are supplied by Pixi and may be
 *   declared in the fragment shader as needed;
 * - colours arrive **premultiplied**, so any shader that scales `rgb`
 *   must un-premultiply first and re-premultiply after, exactly as
 *   Pixi's `noise.frag` does.
 *
 * We ship GLSL only — no WGSL twin — because the stage pins the
 * renderer to WebGL (`preference: 'webgl'`). That is not a shortcut:
 * the HTML-in-Canvas upload path Pixi uses for `HTMLSource` under
 * WebGL is `gl.texElementImage2D`, which is the primitive this whole
 * feature is built on.
 *
 * @since 0.9.8
 */

/**
 * Pixi's stock filter vertex shader, character-for-character from
 * `pixi.js/lib/filters/defaults/defaultFilter.vert`. Copied rather than
 * imported because Pixi is a runtime global here, not a bundled module.
 */
export const FILTER_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/**
 * Read a uniform group's value bag off a filter, or `undefined` when
 * the group is missing. Keeps the `update` / `tick` implementations
 * free of repeated optional chaining through Pixi's resource map, and
 * makes them null-safe against a filter that failed to build.
 *
 * @param filter Pixi filter carrying the group.
 * @param group  Resource key the `UniformGroup` was registered under.
 */
export function uniformsOf(
	filter: unknown,
	group: string,
): Record< string, number > | undefined {
	const resources = ( filter as { resources?: Record< string, unknown > } )
		?.resources;
	const bag = resources?.[ group ] as
		| { uniforms?: Record< string, number > }
		| undefined;
	return bag?.uniforms;
}
