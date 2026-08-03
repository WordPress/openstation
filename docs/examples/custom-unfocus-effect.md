# Register a custom unfocused-window effect

An **unfocus effect** is a visual treatment applied to every window
that isn't the focused one — the family of effects surfaced in
**OS Settings → Effects → "Unfocused windows"**. The plugin ships three
built-ins — `darken` (dims), `frost` (frosted-glass blur), and
`grayscale` (drains colour) — each registered through the exact same
public hook a plugin would use. This page shows a plugin adding its own.

**Status:** Experimental.

## How it works

The framework owns *when* the chosen effect runs — it watches focus
changes, the user's selection, and excludes minimized windows — and
toggles your effect on every unfocused window's root element
(`.os-window`). Your def owns *what* the effect is: either a
CSS class to toggle (the cheap path) or `apply`/`clear` callbacks for
anything a static class can't express.

The user picks among registered effects (plus a "None" option) in
OS Settings; the choice persists per-user as the `unfocusEffect`
setting.

## The declarative path — a CSS class

Ship a stylesheet rule and register an effect that names its class:

```javascript
wp.os.ready( () => {
    wp.os.registerUnfocusEffect( {
        id:          'acme/blur',
        label:       'Blur',
        description: 'Softly blur windows you are not working in.',
        className:   'acme-window--blur',
        owner:       'acme-effects', // live-unregister on deactivate
    } );
} );
```

```css
/* The framework adds this class to unfocused windows while
 * `acme/blur` is the selected effect, and removes it on focus. */
.acme-window--blur {
    filter: blur( 2px );
}
```

To get a smooth fade as focus moves, the framework already includes
`filter` in the shared window transition — so a `filter`-based effect
animates both ways for free (and collapses to instant under
`prefers-reduced-motion`). For other properties, add your own
`transition` to the class.

## The imperative path — apply / clear

When a static class isn't enough (you need to compute per-window
state, attach a canvas, etc.), provide callbacks instead:

```javascript
wp.os.registerUnfocusEffect( {
    id:    'acme/grayscale-fade',
    label: 'Grayscale',
    apply: ( el ) => {
        el.style.filter = 'grayscale(1)';
    },
    clear: ( el ) => {
        el.style.filter = '';
    },
    owner: 'acme-effects',
} );
```

`apply` receives the window root when it becomes unfocused under your
effect; `clear` must undo whatever `apply` did and is called when the
window regains focus or the user switches effects. You can provide
both a `className` and callbacks — the framework removes the class for
you and also calls `clear`.

## Make it appear live on activation

So a plugin activated mid-session shows up in the selector without a
page reload, opt the script in from PHP:

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'acme-effects',
        plugins_url( 'js/effects.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'acme-effects' );
} );
openstation_register_unfocus_effect_script( 'acme-effects' );
```

The handle you pass here should match the `owner` on your
`registerUnfocusEffect` calls — that's what lets the framework
live-unregister your effect when the plugin is deactivated.

## Notes

- **Reserved id.** `'none'` is the selector's "no effect" sentinel and
  cannot be used as an effect id.
- **Namespacing.** Ids accept `vendor/sub-id` (`[a-z0-9_/-]+`). The
  persisted setting preserves the slash, so a namespaced id round-trips
  cleanly.
- **Reading the selection.** `wp.os.getOsSettings().unfocusEffect`
  is the active effect id (or `'none'`).
- **Filter.** The raw `os.unfocus-effects` JS filter receives
  the registry array on every read — reorder, remove, or conditionally
  swap effects, mirroring `os.wallpapers`.

See also: [`registerUnfocusEffect`](../javascript-reference.md#registerunfocuseffect-def---experimental) in the JavaScript reference and [`openstation_register_unfocus_effect_script`](../hooks-reference.md#openstation_register_unfocus_effect_script-handle---experimental-php-function) in the hooks reference.
