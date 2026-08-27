# Place something where the user can reach it — `wp.os.workArea`

The desktop area is not all reachable: the bottom dock pill floats over its lower band, and a window or panel that sizes itself against the whole area ends up with its last row of actions under the dock. The **work area** is the rectangle no shell chrome floats over, and the shell computes it once from the live dock geometry so nothing has to guess.

Three ways to read it, for three kinds of consumer.

## 1. Open a window that fills the reachable space

`wp.os.windowManager.open()` takes a full `WindowConfig`, geometry included; `wp.os.openWindow( id )` only opens a registered window and ignores geometry, so pin the rect through the manager:

```js
document.addEventListener( 'os-init', () => {
    const { rect } = wp.os.workArea.get(); // desktop-area-local: { x, y, width, height }
    wp.os.windowManager.open( {
        id: 'my-plugin-report',
        title: 'Report',
        url: 'admin.php?page=my-plugin-report',
        x: rect.x + 24,
        y: rect.y + 24,
        width: Math.min( 1100, rect.width - 48 ),
        height: rect.height - 48,
    } );
} );
```

`rect` is in the same coordinate space a window's `x` / `y` resolve in, so no conversion. The shell's own default placements (open, restore, cascade, tile) already do this; you only need it for geometry you pin yourself. Maximize and snap deliberately fill the whole area, dock band included — an explicit ask for everything — so don't expect a maximized window to stop at `rect`. For windows you register rather than open by hand, the [`os.window.geometry`](../javascript-reference.md#oswindowgeometry-filter--stable) filter receives the same rectangle as `ctx.workArea`:

```js
wp.hooks.addFilter( 'os.window.geometry', 'my-plugin/bottom-right', ( geometry, ctx ) => {
    if ( ctx.baseId !== 'my-plugin-report' || ctx.hasSavedGeometry ) {
        return geometry;
    }
    const { x, y, width, height } = ctx.workArea;
    return {
        ...geometry,
        x: x + width - geometry.width - 20,
        y: y + height - geometry.height - 20, // above the dock, not under it
    };
} );
```

## 2. Frame content inside your own box

A surface that centres or fits something inside its own element (a canvas, a map, a graph) does not care where the desktop is, only which part of *its* box is covered. `insetsOf( el )` answers that in the element's own pixels:

```js
function fitGraph( host, bounds ) {
    const inset = wp.os.workArea.insetsOf( host ); // { top, right, bottom, left } px of `host` outside the work area
    const viewW = host.clientWidth - inset.left - inset.right;
    const viewH = host.clientHeight - inset.top - inset.bottom;
    const scale = Math.min( viewW / bounds.width, viewH / bounds.height );
    camera.set( {
        scale,
        x: inset.left + viewW / 2 - bounds.cx * scale,
        y: inset.top + viewH / 2 - bounds.cy * scale,
    } );
}
```

Zero everywhere while the host is fully inside the work area; only a maximized window (or one dragged low) reports a `bottom`.

## 3. Reserve the same band from CSS

The insets are on `#os-shell` as custom properties, so a stylesheet can stop short of the dock without any JS:

```css
.my-plugin-overlay {
    position: absolute;
    inset-block-start: calc( var( --os-work-area-inset-top, 0px ) + 16px );
    inset-block-end: calc( var( --os-work-area-inset-bottom, 80px ) + 16px );
    inset-inline-start: calc( var( --os-work-area-inset-left, 0px ) + 16px );
    inset-inline-end: calc( var( --os-work-area-inset-right, 0px ) + 16px );
}
```

`--os-work-area-width` / `--os-work-area-height` carry the rect's size for `calc()`. The fallbacks are what applies before the shell has measured once; `80px` matches the bottom pill at its default size, which is the placement almost every user has.

## Reacting to changes

The dock can move edges, change size, and collapse for the overview; the browser resizes. Subscribe once and repaint:

```js
const off = wp.os.workArea.subscribe( ( { rect } ) => {
    panel.style.maxHeight = `${ rect.height - 48 }px`;
} );
// or, without a handle to keep:
document.addEventListener( 'os-work-area-changed', ( e ) => repaint( e.detail ) );
```

Both fire once per actual change and never on a same-numbers re-measure.

## What claims an inset, and what doesn't

Only chrome that floats **over** the desktop area claims a band: today, the bottom dock pill, and whatever a custom [dock-rail renderer](./dock-rail-renderer.md) floats over it (every `.os-dock` in the shell body is measured). A dock set to the **Dynamic** behavior (Preferences → Appearance → Desktop layout → Dock behavior) folds into a thin indicator line at its edge and claims nothing; the work area is then the whole desktop. A left or right dock is a flex sibling of the area, so the area is already narrower and the inset is 0. The admin bar sits above the shell in every mode, so the `viewport` rectangle is already below it. The notch floats and deliberately claims nothing.

There is no API for a plugin to claim a band of its own, and that is on purpose: a work area is only useful while few things carve it. If your plugin ships chrome that genuinely needs one, open an issue and say why.

Body-level popovers (context menus, tooltips, the dock's flyouts) position against the viewport and may open over the dock; they are transient chrome, not content, and the work area is not for them.
