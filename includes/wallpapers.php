<?php
/**
 * Desktop Mode — Built-in wallpaper presets.
 *
 * The five gradient / solid presets that ship with the plugin, each
 * registered through the same public API third-party plugins use
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
 * @since   0.11.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the five built-in wallpaper presets.
 *
 * @since 0.11.0
 */
function desktop_mode_register_builtin_wallpapers() {
	$presets = array(
		array(
			'id'    => 'dark',
			'label' => __( 'Graphite', 'desktop-mode' ),
			'value' => 'linear-gradient(135deg, #1d2327 0%, #2c3338 50%, #1d2327 100%)',
		),
		array(
			'id'    => 'aurora',
			'label' => __( 'Aurora', 'desktop-mode' ),
			'value' => 'linear-gradient(135deg, #1a2980 0%, #26d0ce 100%)',
		),
		array(
			'id'    => 'sunset',
			'label' => __( 'Sunset', 'desktop-mode' ),
			'value' => 'linear-gradient(135deg, #ff512f 0%, #dd2476 100%)',
		),
		array(
			'id'    => 'forest',
			'label' => __( 'Forest', 'desktop-mode' ),
			'value' => 'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
		),
		array(
			'id'    => 'mono',
			'label' => __( 'Mono', 'desktop-mode' ),
			'value' => '#1d2327',
		),
	);

	foreach ( $presets as $preset ) {
		desktop_mode_register_wallpaper( $preset['id'], array(
			'label'   => $preset['label'],
			'preview' => $preset['value'],
			'value'   => $preset['value'],
			'type'    => 'css',
		) );
	}

	// Animated WordPress Logo — built-in PixiJS canvas wallpaper.
	// Moved out of `desktop.min.js` in 0.8.4. Same registration
	// surface third-party canvas wallpapers use: `script` is an
	// enqueued handle (registered in `includes/assets.php`); the
	// shell's wallpaper sync injects its URL when the wallpaper
	// def is needed (selected, or shown in the OS Settings picker).
	desktop_mode_register_wallpaper( 'wp-animated-logo', array(
		'label'   => __( 'Animated WordPress Logo', 'desktop-mode' ),
		'preview' => 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)',
		'type'    => 'canvas',
		'script'  => 'desktop-mode-animated-logo-wallpaper',
	) );
}
add_action( 'init', 'desktop_mode_register_builtin_wallpapers', 5 );
