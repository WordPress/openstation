# Restyle and drive the mascot

**Status: Experimental.** Full reference: [`mascot.md`](../mascot.md).

The mascot is the soft-body companion that floats over the wallpaper. Users switch it on by right-clicking the desk. A plugin can restyle it, re-tune its physics, react to it being picked up, and turn it on or off programmatically.

---

## 1. Restyle it from PHP

The server-side filter runs once per shell render and is the right home for site-wide identity: brand colours, a bigger or smaller companion, heavier or lighter physics.

Return a partial array — anything you leave out keeps the reference design. Every value is re-clamped in the browser, so an out-of-range number produces a plain-looking mascot rather than a broken shell.

```php
<?php
/**
 * Plugin Name: My Desktop Extension
 */
defined( 'ABSPATH' ) || exit;

add_filter( 'desktop_mode_mascot_config', function ( $config ) {
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

Colours accept integers (`0x05050a`) or CSS hex strings (`'#05050a'`). The full key/range table is in [`mascot.md`](../mascot.md#configuration-reference).

---

## 2. Restyle it from JavaScript

`setConfig()` merges over whatever is currently in force and applies live — useful for anything that depends on browser state rather than site state.

```js
wp.desktop.ready( () => {
	// Big and calm on a wall-mounted kiosk; the default elsewhere.
	if ( window.innerWidth > 2200 ) {
		wp.desktop.mascot.setConfig( {
			appearance: { radius: 90, glow: 1.6 },
			physics: { magnetStrength: 1400, floatAmplitude: 20 },
		} );
	}
} );
```

If you need the last word *before* the mascot ever mounts — including on the very first frame — use the filter instead. It runs on top of the PHP config and is re-sanitized afterwards.

```js
wp.hooks.addFilter(
	'desktop-mode.mascot.config',
	'my-plugin/mascot',
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
	'desktop-mode.mascot.dropped',
	'my-plugin/mascot',
	( { position } ) => {
		// The user parked it somewhere. Positions are viewport
		// coordinates and are already persisted by the shell.
		myPluginRecordPreferredCorner( position );
	}
);

wp.hooks.addAction(
	'desktop-mode.mascot.enabled',
	'my-plugin/mascot',
	() => wp.desktop.showToast( { message: 'Say hi 👋' } )
);
```

Available actions: `enabled`, `disabled`, `mounted`, `unmounted`, `grabbed`, `dropped`, `displaced` (a window opened on top of it and it hopped clear).

---

## 4. Turn it on for the user

`enable()` persists the preference exactly as the wallpaper menu entry does, and lazy-loads the mascot bundle. Only do this in response to something the user asked for — silently switching on an animated companion is not a good welcome.

```js
wp.desktop.registerCommand( {
	slug: 'mascot',
	label: 'Toggle the desk mascot',
	icon: 'dashicons-buddicons-replies',
	run: () => wp.desktop.mascot.toggle(),
} );
```

---

## 5. Move the wallpaper menu entry (or take it away)

The toggle is an ordinary wallpaper context-menu item with `id: 'mascot'`, so the existing filter reaches it:

```js
wp.hooks.addFilter(
	'desktop-mode.wallpaper-context-menu',
	'my-plugin/mascot',
	( items ) =>
		items.map( ( item ) =>
			item.id === 'mascot'
				? { ...item, label: `${ item.label } (beta)`, sort: 5 }
				: item
		)
);
```

Filter it out entirely if your site drives the mascot itself and shouldn't offer the user a switch.

---

## What not to do

- **Don't reach into the layer's DOM.** `#desktop-mode-mascot` and its `<canvas>` are owned by the shell and rebuilt on every toggle. Everything supported is on `wp.desktop.mascot`.
- **Don't make the layer interactive.** It spans the whole shell; anything you make clickable there swallows clicks meant for the window underneath.
- **Don't assume it's mounted.** It is off by default and lazy-loaded. `getPosition()` returns `null` when off, and `setPosition()` is a no-op.
