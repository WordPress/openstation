# Register a screen effect

**Status:** Experimental · **Since:** 0.9.8

A screen effect is a fragment shader Desktop Mode runs over the *entire*
desktop when the user has the canvas stage switched on (OS Settings →
Experimental). This example ships a "Sepia" effect with one slider,
registers it so it appears the moment the plugin is activated, and
removes it live on deactivation.

Background and the full contract: [`../screen-effects.md`](../screen-effects.md).

---

## `my-sepia.php`

```php
<?php
/**
 * Plugin Name: My Sepia Screen Effect
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    // Depend on `desktop-mode` so `wp.desktop` exists when this runs.
    wp_register_script(
        'my-sepia',
        plugins_url( 'my-sepia.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-sepia' );
} );

// Tells the shell this handle contributes screen effects, so activating
// the plugin surfaces it in OS Settings without a page reload.
if ( function_exists( 'desktop_mode_register_screen_effect_script' ) ) {
    desktop_mode_register_screen_effect_script( 'my-sepia' );
}
```

---

## `my-sepia.js`

```js
( function () {
    if ( ! window.wp?.desktop?.stage ) {
        return;
    }

    // Pixi's stock filter vertex shader. Copy it verbatim — it maps the
    // filter quad into the input texture's coordinate space.
    const VERTEX = `in vec2 aPosition;
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

    // Colours arrive premultiplied, so un-premultiply before touching
    // rgb and re-premultiply afterwards.
    const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAmount;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a > 0.0) { color.rgb /= color.a; }

    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    vec3 sepia = vec3(grey * 1.07, grey * 0.74, grey * 0.43);
    color.rgb = mix(color.rgb, sepia, uAmount);

    color.rgb *= color.a;
    finalColor = color;
}
`;

    wp.desktop.stage.registerScreenEffect( {
        id: 'my-sepia/sepia',
        label: 'Sepia',
        description: 'Drain the desktop to an old photograph.',
        // Runs late, after pixelation and scanlines but before the CRT
        // tube's curvature at 30.
        order: 25,
        // Matches the PHP script handle — this is what makes the effect
        // disappear live when the plugin is deactivated.
        owner: 'my-sepia',
        params: [
            {
                key: 'amount',
                label: 'Amount',
                min: 0,
                max: 1,
                step: 0.01,
                default: 0.7,
            },
        ],

        createFilter( ctx ) {
            const { Filter, GlProgram, UniformGroup } = ctx.pixi;
            return new Filter( {
                glProgram: GlProgram.from( {
                    vertex: VERTEX,
                    fragment: FRAGMENT,
                    name: 'my-sepia',
                } ),
                resources: {
                    sepiaUniforms: new UniformGroup( {
                        uAmount: { value: ctx.params.amount, type: 'f32' },
                    } ),
                },
            } );
        },

        // Called on every slider drag. Implement it and a parameter
        // change never rebuilds the shader program.
        update( filter, ctx ) {
            filter.resources.sepiaUniforms.uniforms.uAmount = ctx.params.amount;
        },
    } );
} )();
```

---

## Trying it

1. Activate the plugin. In Chrome 148+ with
   `chrome://flags/#canvas-draw-element` enabled, open **OS Settings →
   Experimental**.
2. Tick **Render the desktop in a canvas**. (With windows open you will
   be asked to reload — the wrap re-parents every iframe.)
3. **Sepia** appears under *Screen effects*. Tick it; the desktop turns
   sepia immediately. Drag **Amount** and it updates live.
4. Deactivate the plugin — the effect disappears from the list without a
   reload, because `owner` matches the registered script handle.

---

## Notes

- **Feature-detect** with `wp.desktop.stage.isSupported()` if you want
  to do anything conditional. Registration itself is always safe: the
  registry is live even when the stage is off.
- **`ctx.params` is pre-validated.** Every key you declared is present,
  clamped to `min`/`max`, with `default` substituted for anything
  missing. Do not re-validate it.
- **Animate with `tick( filter, elapsed, ctx )`** rather than your own
  `requestAnimationFrame` — the stage calls it inside Pixi's ticker,
  and skips it entirely for effects that do not declare it.
- **Throwing in `createFilter` drops only your effect**; the rest of the
  user's chain still renders, and the error is reported on the
  `desktop-mode.shell.error` action with `scope: 'screen-effect'`.

---

## See also

- [`../screen-effects.md`](../screen-effects.md) — the full contract
- [`custom-unfocus-effect.md`](custom-unfocus-effect.md) — the other effect system: per-window CSS treatments, no canvas involved
