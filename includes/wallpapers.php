<?php
/**
 * Desktop Mode — Built-in wallpaper presets.
 *
 * The built-in wallpapers that ship with the plugin — five gradient /
 * solid CSS presets plus the Animated WordPress Logo canvas wallpaper —
 * each registered through the same public API third-party plugins use
 * (`desktop_mode_register_wallpaper()`). Dogfooding the registration
 * surface for the built-ins is how we discover whether the API is
 * expressive enough for plugin authors — if we couldn't describe our
 * own presets through it, the API is broken.
 *
 * Hooked on `init` priority 5 so the presets land in the registry
 * before the shell config is built (shell render runs on
 * `admin_enqueue_scripts`, which fires after `init`), and before any
 * late third-party plugin that wants to react via the
 * `desktop_mode_wallpaper_registered` action.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the built-in wallpapers: five gradient / solid CSS presets
 * plus the Animated WordPress Logo canvas wallpaper.
 */
function desktop_mode_register_builtin_wallpapers() {
	/*
	 * The four brand surfaces, straight from the OpenStation brand
	 * guidelines. Registered as `css` wallpapers pointing at the
	 * vector artwork the plugin ships: an SVG scales to any desk at
	 * any DPI for a few kilobytes, which no raster wallpaper can do.
	 *
	 * `cover` on a 3:2 artboard, `center` so the composition's focal
	 * point survives a crop on either axis, `fixed` so the desk does
	 * not shift under a window drag.
	 *
	 * Galaxy is the default desk — see the `wallpaper` default in
	 * `desktop_mode_os_settings_defaults()`.
	 */
	$brand = array(
		array(
			'id'          => 'galaxy',
			'label'       => __( 'Galaxy', 'desktop-mode' ),
			'file'        => 'galaxy.svg',
			'description' => __( 'The station seen from outside: a Void sky with soft Nebula glows and a Starlight starfield drifting through it.', 'desktop-mode' ),
		),
		array(
			'id'          => 'space',
			'label'       => __( 'Space', 'desktop-mode' ),
			'file'        => 'space.svg',
			'description' => __( 'Deep space, quietly. One long gradient from near-black to a faint violet horizon — the calmest desk in the set, and the one that asks least of your eyes.', 'desktop-mode' ),
		),
		array(
			'id'          => 'holomesh',
			'label'       => __( 'Holomesh', 'desktop-mode' ),
			'file'        => 'holomesh.svg',
			'description' => __( 'The holographic mesh: lavender, pink, cyan and mint pooling into each other like light through a prism.', 'desktop-mode' ),
		),
		array(
			'id'          => 'pulsemesh',
			'label'       => __( 'Pulsemesh', 'desktop-mode' ),
			'file'        => 'pulsemesh.svg',
			'description' => __( 'The pulsar mesh: magenta and violet burning through a white core, the brightest surface the brand has.', 'desktop-mode' ),
		),
	);

	foreach ( $brand as $wallpaper ) {
		$css = 'url( ' . DESKTOP_MODE_URL . 'assets/wallpapers/' . $wallpaper['file'] . ' ) center center / cover no-repeat fixed';
		desktop_mode_register_wallpaper( $wallpaper['id'], array(
			'label'       => $wallpaper['label'],
			'type'        => 'css',
			// The swatch is the same artwork, sized to the chip rather
			// than the desk: `cover` on a 40px square would crop to a
			// meaningless corner of the composition.
			'preview'     => 'url( ' . DESKTOP_MODE_URL . 'assets/wallpapers/' . $wallpaper['file'] . ' ) center center / cover no-repeat',
			'value'       => $css,
			'description' => $wallpaper['description'],
		) );
	}

	$presets = array(
		array(
			'id'          => 'dark',
			'label'       => __( 'Graphite', 'desktop-mode' ),
			'value'       => 'linear-gradient(135deg, #1d2327 0%, #2c3338 50%, #1d2327 100%)',
			'description' => __( 'A quiet charcoal gradient that keeps every eye on your windows — the classic dark desk WordPress admins know by heart.', 'desktop-mode' ),
		),
		array(
			'id'          => 'aurora',
			'label'       => __( 'Aurora', 'desktop-mode' ),
			'value'       => 'linear-gradient(135deg, #1a2980 0%, #26d0ce 100%)',
			'description' => __( 'Deep indigo melting into arctic teal — northern lights over a midnight horizon.', 'desktop-mode' ),
		),
		array(
			'id'          => 'sunset',
			'label'       => __( 'Sunset', 'desktop-mode' ),
			'value'       => 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
			'description' => __( 'A warm blaze from ember orange to magenta — golden hour, frozen mid-fade.', 'desktop-mode' ),
		),
		array(
			'id'          => 'forest',
			'label'       => __( 'Forest', 'desktop-mode' ),
			'value'       => 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
			'description' => __( 'Cool pine greens for calm, unhurried work under the canopy.', 'desktop-mode' ),
		),
		array(
			'id'          => 'mono',
			'label'       => __( 'Mono', 'desktop-mode' ),
			'value'       => '#1d2327',
			'description' => __( 'One flat graphite tone. No gradient, no noise — nothing but your work.', 'desktop-mode' ),
		),
	);

	foreach ( $presets as $preset ) {
		desktop_mode_register_wallpaper( $preset['id'], array(
			'label'       => $preset['label'],
			'preview'     => $preset['value'],
			'value'       => $preset['value'],
			'type'        => 'css',
			'description' => $preset['description'],
		) );
	}

	// Animated WordPress Logo — built-in PixiJS canvas wallpaper.
	// Moved out of `desktop.min.js`. Same registration
	// surface third-party canvas wallpapers use: `script` is an
	// enqueued handle (registered in `includes/assets.php`); the
	// shell's wallpaper sync injects its URL when the wallpaper
	// def is needed (selected, or shown in the OS Settings picker).
	desktop_mode_register_wallpaper( 'wp-animated-logo', array(
		'label'       => __( 'Animated WordPress Logo', 'desktop-mode' ),
		'preview'     => 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)',
		'type'        => 'canvas',
		'script'      => 'desktop-mode-animated-logo-wallpaper',
		'description' => __( 'Thousands of luminous particles holding the shape of the WordPress W. Sweep your cursor through and they scatter like sand, then drift home again.', 'desktop-mode' ),
	) );

	// Snow — built-in PixiJS canvas wallpaper. The preview gradient
	// must match the default backdrop the JS side paints behind the
	// canvas (`backdropCss()` in `src/plugins/snow-wallpaper/settings.ts`)
	// — the swatch renders before the wallpaper script has ever
	// loaded, so a mismatch would show one sky in the picker and a
	// different one once selected. First built-in wallpaper with a
	// `renderConfig` settings dialog (wind, snowflake count, flake
	// size, background colour).
	desktop_mode_register_wallpaper( 'wp-snow', array(
		'label'       => __( 'Snow', 'desktop-mode' ),
		'preview'     => 'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)',
		'type'        => 'canvas',
		'script'      => 'desktop-mode-snow-wallpaper',
		'description' => __( 'Snow falling over a midnight sky. Flakes settle on the top edge of every window, pile into little drifts, then quietly melt away. Open the wallpaper settings to tune the wind, the snowfall, the flake size, and the colour of the night.', 'desktop-mode' ),
	) );
}
add_action( 'init', 'desktop_mode_register_builtin_wallpapers', 5 );
