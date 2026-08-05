# Restyle and drive Mio

**Status: Experimental.** Full reference: [`mio.md`](../mio.md).

Mio is the soft-body companion that floats over the wallpaper. Users switch it on by right-clicking the desk. A plugin can restyle it, re-tune its physics, react to it being picked up, and turn it on or off programmatically.

---

## 1. Restyle it from PHP

The server-side filter runs once per shell render and is the right home for site-wide identity: brand colours, a bigger or smaller companion, heavier or lighter physics.

Return a partial array — anything you leave out keeps the reference design. Every value is re-clamped in the browser, so an out-of-range number produces a plain-looking Mio rather than a broken shell.

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'openstation_mio_config', function ( $config ) {
	// Brand colours: a teal-to-green ring instead of magenta-to-violet.
	$config['appearance']['hueStart'] = 170;
	$config['appearance']['hueSpan']  = 50;
	$config['appearance']['glow']     = 1.4;

	// A companion that commits to windows from further away.
	$config['physics']['magnetStrength'] = 3400;
	$config['physics']['magnetRange']    = 340;

	// Firmer jelly: less wobble on impact, calmer while idle.
	$config['physics']['damping']    = 8;
	$config['physics']['idleWobble'] = 0.04;

	return $config;
} );
```

Colours accept integers (`0x05050a`) or CSS hex strings (`'#05050a'`). The full key/range table is in [`mio.md`](../mio.md#configuration-reference).

---

## 2. Restyle it from JavaScript

`setConfig()` merges over whatever is currently in force and applies live — useful for anything that depends on browser state rather than site state.

```js
wp.os.ready( () => {
	// Big and calm on a wall-mounted kiosk; the default elsewhere.
	if ( window.innerWidth > 2200 ) {
		wp.os.mio.setConfig( {
			appearance: { radius: 90, glow: 1.6 },
			physics: { magnetStrength: 1400, floatAmplitude: 20 },
		} );
	}
} );
```

### `setConfig` versus `setStyle`

The two look similar and mean different things:

| | Persists? | Takes |
|---|---|---|
| `setConfig( { appearance, physics } )` | **No** | Anything in the config, including the spring constants. |
| `setStyle( flatBag )` | **Yes**, to the user's account | Appearance keys and the look-physics keys, in one flat bag. |

`setStyle()` is what "Make it yours" writes on every control movement, so calling it *is* changing the user's saved companion — on every device they log into. Reach for it only when you are acting on the user's behalf; reach for `setConfig()` when your plugin wants Mio to look a certain way for a moment.

```js
// Give the user a Mio to match their brand, and stop it wandering.
wp.os.mio.setStyle( {
	hueStart: 170,
	hueSpan: 60,
	shapePreset: 'star',
	shapeShuffle: 0,
	idleWobble: 0.12,
} );
```

Keys outside the two whitelists are dropped rather than applied, so passing a whole `MioPhysics` will not let you set stiffnesses this way — that is `setConfig()`'s job, and it is deliberately the one that doesn't persist.

If you need the last word *before* Mio ever mounts — including on the very first frame — use the filter instead. It runs on top of the PHP config and is re-sanitized afterwards.

```js
wp.hooks.addFilter(
	'os.mio.config',
	'my-plugin/mio',
	( config ) => ( {
		...config,
		appearance: { ...config.appearance, eyeScale: 0.34 },
	} )
);
```

---

## 3. React to it

```js
wp.hooks.addAction(
	'os.mio.dropped',
	'my-plugin/mio',
	( { position } ) => {
		// The user parked it somewhere. Positions are viewport
		// coordinates and are already persisted by the shell.
		myPluginRecordPreferredCorner( position );
	}
);

wp.hooks.addAction(
	'os.mio.enabled',
	'my-plugin/mio',
	() => wp.os.showToast( { message: 'Say hi 👋' } )
);
```

Available actions: `enabled`, `disabled`, `mounted`, `unmounted`, `grabbed`, `dropped`, `displaced` (a window opened on top of it and it hopped clear).

---

## 4. Turn it on for the user

`enable()` persists the preference exactly as Mio's dock tile does, and lazy-loads the Mio bundle. Only do this in response to something the user asked for — silently switching on an animated companion is not a good welcome.

```js
wp.os.registerCommand( {
	slug: 'mio',
	label: 'Toggle Mio',
	icon: 'dashicons-buddicons-replies',
	run: () => wp.os.mio.toggle(),
} );
```

---

## 5. Reach the dock tile

The toggle is an ordinary system tile with `id: 'os-mio-toggle'`, so the dock's decoration hooks reach it like any other:

```js
wp.hooks.addFilter(
	'os.dock.tile-class',
	'my-plugin/mio',
	( classes, ctx ) =>
		ctx.item?.id === 'os-mio-toggle'
			? [ ...classes, 'my-plugin-mio-tile' ]
			: classes
);
```

Users who don't want a desk companion hide the tile from OpenStation Settings → **Apps & Icons**; it is the one system tile that opts into that list (`SystemDockItem.placeable`). There is nothing to filter out server-side — a shell whose user never switches Mio on downloads none of the simulation.

---

## What not to do

- **Don't reach into the layer's DOM.** `#os-mio` and its `<canvas>` are owned by the shell and rebuilt on every toggle. Everything supported is on `wp.os.mio`.
- **Don't make the layer interactive.** It spans the whole shell; anything you make clickable there swallows clicks meant for the window underneath.
- **Don't assume it's mounted.** It is off by default and lazy-loaded. `getPosition()` returns `null` when off, and `setPosition()` is a no-op.
- **Don't use `setStyle()` for a temporary adjustment.** It saves to the user's account, so a look you set "just for this page" follows them to every browser they log into. `setConfig()` is the one that doesn't persist.
