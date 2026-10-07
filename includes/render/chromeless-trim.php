<?php

defined( 'ABSPATH' ) || exit;

function openstation_chromeless_trimmed_scripts() {
	$handles = array(

		'admin-bar',

		'os-admin-bar',

		'wpcom-admin-bar',
		'wpcom-notes-common',
		'wpcom-notes-admin-bar',
		'a8c-faux-inline-help',
	);

	return (array) apply_filters( 'openstation_chromeless_trimmed_scripts', $handles );
}

function openstation_chromeless_trimmed_styles() {
	$handles = array(

		'admin-bar',
		'wpcom-notes-admin-bar',
	);

	return (array) apply_filters( 'openstation_chromeless_trimmed_styles', $handles );
}

function openstation_chromeless_trim_assets() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	foreach ( openstation_chromeless_trimmed_scripts() as $handle ) {
		wp_dequeue_script( $handle );
	}
	foreach ( openstation_chromeless_trimmed_styles() as $handle ) {
		wp_dequeue_style( $handle );
	}

	do_action( 'openstation_chromeless_trimmed_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_trim_assets', PHP_INT_MAX );

function openstation_chromeless_suppress_emoji() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}

	if ( ! apply_filters( 'openstation_chromeless_trim_emoji', true ) ) {
		return;
	}

	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );

	remove_action( 'admin_print_styles', 'print_emoji_styles' );
}
add_action( 'admin_init', 'openstation_chromeless_suppress_emoji' );

function openstation_command_palette_root_handles() {

	return (array) apply_filters(
		'openstation_command_palette_root_handles',
		array( 'wp-commands', 'wp-core-commands' )
	);
}

function openstation_is_core_package_handle( $dependencies, $handle ) {
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		return false;
	}

	if ( 0 === strpos( $handle, 'wp-' ) ) {
		return true;
	}

	$src = $dependencies->registered[ $handle ]->src;

	return ( is_string( $src ) && false !== strpos( $src, '/wp-includes/js/dist/' ) );
}

function openstation_handle_depends_on( $dependencies, $handle, $roots, &$memo ) {
	if ( array_key_exists( $handle, $memo ) ) {

		return ( true === $memo[ $handle ] );
	}
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		$memo[ $handle ] = false;
		return false;
	}

	$memo[ $handle ] = null;
	$result          = false;

	foreach ( $dependencies->registered[ $handle ]->deps as $dep ) {
		if ( in_array( $dep, $roots, true ) ) {
			$result = true;
			break;
		}

		if ( openstation_is_core_package_handle( $dependencies, $dep ) ) {
			continue;
		}
		if ( openstation_handle_depends_on( $dependencies, $dep, $roots, $memo ) ) {
			$result = true;
			break;
		}
	}

	$memo[ $handle ] = $result;
	return $result;
}

function openstation_handle_has_no_src( $dependencies, $handle ) {
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		return false;
	}
	$src = $dependencies->registered[ $handle ]->src;

	return ( ! is_string( $src ) || '' === $src );
}

function openstation_command_palette_trims_dependents() {

	return (bool) apply_filters( 'openstation_command_palette_trim_dependents', true );
}

function openstation_command_palette_family( $dependencies, $handles ) {
	$roots  = openstation_command_palette_root_handles();
	$family = $roots;

	if ( openstation_command_palette_trims_dependents() ) {
		$memo = array();
		foreach ( $handles as $handle ) {
			if ( in_array( $handle, $family, true )
				|| openstation_is_core_package_handle( $dependencies, $handle )
				|| openstation_handle_has_no_src( $dependencies, $handle ) ) {
				continue;
			}
			if ( openstation_handle_depends_on( $dependencies, $handle, $roots, $memo ) ) {
				$family[] = $handle;
			}
		}
	}

	return (array) apply_filters( 'openstation_command_palette_family', $family, $handles );
}

function openstation_command_palette_contributors( $dependencies, $handles ) {
	return array_values(
		array_diff(
			openstation_command_palette_family( $dependencies, $handles ),
			openstation_command_palette_root_handles()
		)
	);
}

function openstation_command_palette_handle_owner( $dependencies, $handle ) {
	if ( ! isset( $dependencies->registered[ $handle ] ) ) {
		return '';
	}
	$src = $dependencies->registered[ $handle ]->src;
	if ( ! is_string( $src ) || '' === $src ) {
		return '';
	}
	if ( preg_match( '#/wp-content/(?:plugins|mu-plugins|themes)/([^/]+)/#', $src, $matches ) ) {
		return $matches[1];
	}
	return '';
}

function openstation_command_palette_owns_screen( $dependencies, $handle ) {
	$owner = openstation_command_palette_handle_owner( $dependencies, $handle );

	$page = isset( $_GET['page'] )

		? sanitize_text_field( wp_unslash( $_GET['page'] ) )
		: '';
	$uri  = isset( $_SERVER['REQUEST_URI'] )
		? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) )
		: '';

	$owns = false;
	if ( '' !== $owner ) {
		if ( false !== strpos( $uri, '/wp-content/plugins/' . $owner . '/' )
			|| false !== strpos( $uri, '/wp-content/themes/' . $owner . '/' ) ) {
			$owns = true;
		} elseif ( '' !== $page && 0 === strpos( $page, $owner ) ) {
			$owns = true;
		}
	}

	return (bool) apply_filters( 'openstation_command_palette_contributor_owns_screen', $owns, $handle, $owner, $page );
}

function openstation_chromeless_command_palette_drops( $dependencies, $handles ) {
	foreach ( openstation_command_palette_contributors( $dependencies, $handles ) as $handle ) {
		if ( openstation_command_palette_owns_screen( $dependencies, $handle ) ) {
			return array();
		}
	}

	return openstation_protect_survivor_dependencies(
		$dependencies,
		$handles,
		openstation_command_palette_family( $dependencies, $handles )
	);
}

function openstation_protect_survivor_dependencies( $dependencies, $handles, $drops ) {
	if ( empty( $drops ) ) {
		return $drops;
	}
	$survivors = array_values( array_diff( (array) $handles, (array) $drops ) );
	if ( empty( $survivors ) ) {
		return $drops;
	}

	$needed = openstation_script_dependency_closure( $dependencies, $survivors );

	return array_values( array_diff( $drops, $needed ) );
}

function openstation_chromeless_should_trim_command_palette() {
	if ( ! openstation_is_chromeless_request() ) {
		return false;
	}

	$trim = ! openstation_chromeless_screen_uses_block_editor();

	return (bool) apply_filters( 'openstation_chromeless_trim_command_palette', $trim );
}

function openstation_chromeless_screen_uses_block_editor() {
	global $pagenow;

	if ( in_array( $pagenow, array( 'site-editor.php', 'widgets.php' ), true ) ) {
		return true;
	}
	if ( ! function_exists( 'get_current_screen' ) ) {
		return false;
	}
	$screen = get_current_screen();

	return ( $screen instanceof WP_Screen && $screen->is_block_editor() );
}

function openstation_chromeless_defer_command_palette() {
	if ( ! openstation_chromeless_should_trim_command_palette() ) {
		return;
	}
	remove_action( 'admin_enqueue_scripts', 'wp_enqueue_command_palette_assets' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_defer_command_palette', 0 );

function openstation_chromeless_trim_command_palette() {
	if ( ! openstation_chromeless_should_trim_command_palette() ) {
		return;
	}

	$scripts = wp_scripts();
	if ( ! $scripts ) {
		return;
	}

	$drops = openstation_chromeless_command_palette_drops( $scripts, $scripts->queue );
	foreach ( $drops as $handle ) {
		wp_dequeue_script( $handle );
	}
	if ( ! empty( $drops ) ) {
		foreach ( openstation_command_palette_root_handles() as $handle ) {
			wp_dequeue_style( $handle );
		}
	}

	do_action( 'openstation_chromeless_trimmed_command_palette' );
}
add_action( 'admin_enqueue_scripts', 'openstation_chromeless_trim_command_palette', PHP_INT_MAX );

function openstation_chromeless_filter_palette_print_list( $handles ) {
	if ( ! is_array( $handles ) || ! openstation_chromeless_should_trim_command_palette() ) {
		return $handles;
	}
	$scripts = wp_scripts();
	if ( ! $scripts ) {
		return $handles;
	}
	$drops = openstation_chromeless_command_palette_drops( $scripts, $handles );

	return array_values( array_diff( $handles, $drops ) );
}
add_filter( 'print_scripts_array', 'openstation_chromeless_filter_palette_print_list' );

function openstation_chromeless_filter_palette_style_print_list( $handles ) {
	if ( ! is_array( $handles ) || ! openstation_chromeless_should_trim_command_palette() ) {
		return $handles;
	}

	$scripts = wp_scripts();
	if ( $scripts
		&& empty( openstation_chromeless_command_palette_drops( $scripts, $scripts->queue ) ) ) {
		return $handles;
	}

	return array_values(
		array_diff(
			$handles,
			openstation_protect_survivor_dependencies(
				wp_styles(),
				$handles,
				openstation_command_palette_root_handles()
			)
		)
	);
}
add_filter( 'print_styles_array', 'openstation_chromeless_filter_palette_style_print_list' );

function openstation_chromeless_filter_print_list( $handles, $kind ) {
	if ( ! is_array( $handles ) || ! openstation_is_chromeless_request() ) {
		return $handles;
	}
	$trim = 'scripts' === $kind
		? openstation_chromeless_trimmed_scripts()
		: openstation_chromeless_trimmed_styles();

	return array_values( array_diff( $handles, $trim ) );
}

add_filter(
	'print_scripts_array',
	static function ( $handles ) {
		return openstation_chromeless_filter_print_list( $handles, 'scripts' );
	}
);
add_filter(
	'print_styles_array',
	static function ( $handles ) {
		return openstation_chromeless_filter_print_list( $handles, 'styles' );
	}
);

function openstation_shell_hoist_command_palette_contributors() {
	if ( ! openstation_is_shell_request() ) {
		return;
	}
	$scripts = wp_scripts();
	if ( ! $scripts || ! wp_script_is( 'openstation', 'enqueued' ) ) {
		return;
	}

	if ( ! function_exists( 'wp_enqueue_command_palette_assets' ) ) {
		return;
	}

	$contributors = openstation_command_palette_contributors( $scripts, $scripts->queue );
	if ( empty( $contributors ) ) {
		return;
	}

	$probe        = clone $scripts;
	$probe->to_do = array();
	$probe->done  = array();
	$probe->all_deps( $contributors );

	$chain = $probe->to_do;
	foreach ( $contributors as $handle ) {
		if ( ! in_array( $handle, $chain, true ) ) {
			$chain[] = $handle;
		}
	}

	$entries = array();
	foreach ( $chain as $handle ) {
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url']
			&& empty( $payload['before'] )
			&& empty( $payload['after'] )
			&& empty( $payload['l10n'] ) ) {
			continue;
		}
		$entries[] = array(
			'handle'       => (string) $handle,
			'url'          => $payload['url'],
			'before'       => $payload['before'],
			'after'        => $payload['after'],
			'l10n'         => $payload['l10n'],
			'translations' => $payload['translations'],
		);
	}

	foreach ( $contributors as $handle ) {
		wp_dequeue_script( $handle );
	}

	if ( empty( $entries ) ) {
		return;
	}

	wp_add_inline_script(
		'openstation',
		sprintf(
			'(function(c){if(!c||!c.commandPalette)return;var s=c.commandPalette.scripts;if(!s)return;Array.prototype.push.apply(s,%s);})(window.openStationConfig);',
			wp_json_encode( $entries )
		),
		'before'
	);

	do_action( 'openstation_command_palette_contributors_hoisted', $contributors );
}
add_action( 'admin_enqueue_scripts', 'openstation_shell_hoist_command_palette_contributors', PHP_INT_MAX );
