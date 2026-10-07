<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_builtin_wallpapers() {

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

			'tone'        => 'light',
			'description' => __( 'The holographic mesh: lavender, pink, cyan and mint pooling into each other like light through a prism.', 'desktop-mode' ),
		),
		array(
			'id'          => 'pulsemesh',
			'label'       => __( 'Pulsemesh', 'desktop-mode' ),
			'file'        => 'pulsemesh.svg',
			'tone'        => 'light',
			'description' => __( 'The pulsar mesh: magenta and violet burning through a white core, the brightest surface the brand has.', 'desktop-mode' ),
		),
	);

	foreach ( $brand as $wallpaper ) {
		$css = 'url( ' . OPENSTATION_URL . 'assets/wallpapers/' . $wallpaper['file'] . ' ) center center / cover no-repeat fixed';
		openstation_register_wallpaper(
			$wallpaper['id'],
			array(
				'label'       => $wallpaper['label'],
				'type'        => 'css',

				'preview'     => 'url( ' . OPENSTATION_URL . 'assets/wallpapers/' . $wallpaper['file'] . ' ) center center / cover no-repeat',
				'value'       => $css,
				'tone'        => isset( $wallpaper['tone'] ) ? $wallpaper['tone'] : '',
				'description' => $wallpaper['description'],
			)
		);
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
		openstation_register_wallpaper(
			$preset['id'],
			array(
				'label'       => $preset['label'],
				'preview'     => $preset['value'],
				'value'       => $preset['value'],
				'type'        => 'css',
				'description' => $preset['description'],
			)
		);
	}

	openstation_register_wallpaper(
		'wp-animated-logo',
		array(
			'label'       => __( 'Animated WordPress Logo', 'desktop-mode' ),
			'preview'     => 'radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0b0f25 100%)',
			'type'        => 'canvas',
			'script'      => 'os-animated-logo-wallpaper',
			'description' => __( 'Thousands of luminous particles holding the shape of the WordPress W. Sweep your cursor through and they scatter like sand, then drift home again.', 'desktop-mode' ),
		)
	);

	openstation_register_wallpaper(
		'wp-snow',
		array(
			'label'       => __( 'Snow', 'desktop-mode' ),
			'preview'     => 'linear-gradient(180deg, #0c1a36 0%, #1d355e 55%, #425d8a 100%)',
			'type'        => 'canvas',
			'script'      => 'os-snow-wallpaper',
			'description' => __( 'Snow falling over a midnight sky. Flakes settle on the top edge of every window, pile into little drifts, then quietly melt away. Open the wallpaper settings to tune the wind, the snowfall, the flake size, and the colour of the night.', 'desktop-mode' ),
		)
	);
}
add_action( 'init', 'openstation_register_builtin_wallpapers', 5 );
