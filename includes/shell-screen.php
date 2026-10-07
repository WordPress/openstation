<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_SHELL_PAGE_SLUG = 'openstation';

const OPENSTATION_SHELL_SCREEN_ID = 'admin_page_openstation';

const OPENSTATION_SHELL_TARGET_ARG = 'target';

const OPENSTATION_SHELL_INTENT_ARG = 'intent';

const OPENSTATION_SHELL_OVERVIEW_ARG = 'openstation_overview';

function openstation_shell_lands_in_overview() {

	return openstation_is_shell_screen_request() && ! empty( $_GET[ OPENSTATION_SHELL_OVERVIEW_ARG ] );
}

function openstation_shell_arrival_direction() {
	if ( ! openstation_is_shell_screen_request() ) {
		return '';
	}

	$from = isset( $_GET[ OPENSTATION_NETWORK_HOP_FROM_ARG ] ) && is_scalar( $_GET[ OPENSTATION_NETWORK_HOP_FROM_ARG ] ) ? sanitize_key( wp_unslash( $_GET[ OPENSTATION_NETWORK_HOP_FROM_ARG ] ) ) : '';
	return in_array( $from, array( 'next', 'prev' ), true ) ? $from : '';
}

function openstation_shell_url( $target = '', $intent = false, $network = null ) {
	$target = is_string( $target ) ? openstation_shell_normalize_admin_url( $target ) : '';
	$path   = '' !== $target ? wp_parse_url( $target, PHP_URL_PATH ) : '';

	if ( null === $network ) {

		$network = is_string( $path ) && '' !== $path
			? false !== strpos( $path, '/wp-admin/network/' )
			: is_network_admin();
	}

	$screen = 'admin.php?page=' . OPENSTATION_SHELL_PAGE_SLUG;
	$url    = $network ? network_admin_url( $screen ) : admin_url( $screen );

	if ( '' !== $target ) {
		$query = wp_parse_url( $target, PHP_URL_QUERY );
		if ( is_string( $path ) && '' !== $path ) {
			$relative = $path . ( is_string( $query ) && '' !== $query ? '?' . $query : '' );
			$url      = add_query_arg( OPENSTATION_SHELL_TARGET_ARG, rawurlencode( $relative ), $url );
			if ( $intent ) {
				$url = add_query_arg( OPENSTATION_SHELL_INTENT_ARG, '1', $url );
			}
		}
	}

	return $url;
}

function openstation_shell_normalize_admin_url( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return '';
	}
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	if ( ! is_string( $query ) || '' === $query ) {
		return $url;
	}
	parse_str( $query, $args );
	$base = substr( $url, 0, (int) strpos( $url, '?' ) );
	$hash = wp_parse_url( $url, PHP_URL_FRAGMENT );

	return $base
		. ( ! empty( $args ) ? '?' . http_build_query( $args ) : '' )
		. ( is_string( $hash ) && '' !== $hash ? '#' . $hash : '' );
}

function openstation_url_is_shell_screen( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}
	$path  = wp_parse_url( $url, PHP_URL_PATH );
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	if ( ! is_string( $path ) || ! is_string( $query ) ) {
		return false;
	}
	if ( 'admin.php' !== basename( $path ) ) {
		return false;
	}
	parse_str( $query, $args );
	return isset( $args['page'] ) && OPENSTATION_SHELL_PAGE_SLUG === $args['page'];
}

function openstation_is_shell_screen_request() {
	if ( ! is_admin() ) {
		return false;
	}
	if ( function_exists( 'get_current_screen' ) ) {
		$screen = get_current_screen();
		if ( $screen instanceof WP_Screen ) {

			return in_array(
				$screen->id,
				array( OPENSTATION_SHELL_SCREEN_ID, OPENSTATION_SHELL_SCREEN_ID . '-network' ),
				true
			);
		}
	}
	global $pagenow, $plugin_page;
	return 'admin.php' === $pagenow
		&& isset( $plugin_page )
		&& OPENSTATION_SHELL_PAGE_SLUG === $plugin_page;
}

function openstation_is_shell_request() {
	if ( ! is_admin() ) {
		return false;
	}
	if ( ! openstation_is_enabled() ) {
		return false;
	}
	if ( openstation_is_chromeless_request() || openstation_is_classic_request() ) {
		return false;
	}
	if ( openstation_is_shell_screen_request() ) {
		return true;
	}
	return function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request();
}

function openstation_register_shell_screen() {
	$hook = add_submenu_page(
		'',
		__( 'OpenStation', 'desktop-mode' ),
		__( 'OpenStation', 'desktop-mode' ),
		'read',
		OPENSTATION_SHELL_PAGE_SLUG,
		'openstation_render_shell_screen'
	);

	if ( $hook ) {
		add_action( "load-{$hook}", 'openstation_shell_screen_set_title' );
	}
}
add_action( 'admin_menu', 'openstation_register_shell_screen' );

add_action( 'network_admin_menu', 'openstation_register_shell_screen' );

function openstation_shell_screen_set_title() {
	$GLOBALS['title'] = __( 'OpenStation', 'desktop-mode' );
}

function openstation_render_shell_screen() {
	if ( openstation_is_shell_request() ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'OpenStation', 'desktop-mode' ); ?></h1>
		<p>
			<?php esc_html_e( 'OpenStation is not active for your account on this request.', 'desktop-mode' ); ?>
			<a href="<?php echo esc_url( openstation_portal_url() ); ?>"><?php esc_html_e( 'Open the desktop', 'desktop-mode' ); ?></a>
		</p>
	</div>
	<?php
}

function openstation_shell_boot_target() {
	if ( openstation_is_shell_screen_request() ) {
		$target = '';
		$intent = false;

		if ( ! empty( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) && is_scalar( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) ) {

			$target = openstation_sanitize_portal_target( esc_url_raw( wp_unslash( $_GET[ OPENSTATION_SHELL_TARGET_ARG ] ) ) );
			if ( '' !== $target ) {

				$intent = ! empty( $_GET[ OPENSTATION_SHELL_INTENT_ARG ] );
			}
		}
		if ( '' === $target ) {

			$target = is_network_admin()
				? network_admin_url( 'index.php' )
				: openstation_portal_entry_url( get_current_user_id() );
		}
		$target = openstation_shell_normalize_admin_url( $target );

		$path = wp_parse_url( $target, PHP_URL_PATH );
		if ( is_string( $path ) && '/' === substr( $path, -1 ) ) {
			$query  = wp_parse_url( $target, PHP_URL_QUERY );
			$parts  = explode( '?', $target, 2 );
			$target = rtrim( $parts[0], '/' ) . '/index.php'
				. ( is_string( $query ) && '' !== $query ? '?' . $query : '' );
		}

		return array(
			'url'              => $target,
			'fromPortal'       => true,
			'fromPortalIntent' => $intent,
		);
	}

	global $pagenow;

	$query = $_GET;
	unset( $query[ OPENSTATION_PORTAL_FLAG ], $query[ OPENSTATION_PORTAL_INTENT_FLAG ] );

	return array(
		'url'              => admin_url( (string) $pagenow ) . ( ! empty( $query ) ? '?' . http_build_query( $query ) : '' ),

		'fromPortal'       => ! empty( $_GET[ OPENSTATION_PORTAL_FLAG ] ),

		'fromPortalIntent' => ! empty( $_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] ),
	);
}

function openstation_shell_boot_target_meta( $url, $dock_items ) {
	$none = array(
		'title' => '',
		'icon'  => '',
	);
	if ( ! is_string( $url ) || '' === $url || ! is_array( $dock_items ) ) {
		return $none;
	}
	$key = openstation_shell_url_match_key( $url );
	if ( '' === $key ) {
		return $none;
	}
	foreach ( $dock_items as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}
		$icon = isset( $item['icon'] ) && is_string( $item['icon'] ) ? $item['icon'] : '';
		if ( isset( $item['url'] ) && openstation_shell_url_match_key( $item['url'] ) === $key ) {
			return array(
				'title' => isset( $item['title'] ) ? (string) $item['title'] : '',
				'icon'  => $icon,
			);
		}
		if ( empty( $item['submenu'] ) || ! is_array( $item['submenu'] ) ) {
			continue;
		}
		foreach ( $item['submenu'] as $sub ) {
			if ( is_array( $sub ) && isset( $sub['url'] ) && openstation_shell_url_match_key( $sub['url'] ) === $key ) {
				return array(
					'title' => isset( $sub['title'] ) ? (string) $sub['title'] : '',
					'icon'  => $icon,
				);
			}
		}
	}
	return $none;
}

function openstation_shell_url_match_key( $url ) {
	if ( ! is_string( $url ) ) {
		return '';
	}
	$path = wp_parse_url( $url, PHP_URL_PATH );
	if ( ! is_string( $path ) || '' === $path ) {
		return '';
	}
	$query = wp_parse_url( $url, PHP_URL_QUERY );
	$args  = array();
	if ( is_string( $query ) && '' !== $query ) {
		parse_str( $query, $args );
		unset( $args['openstation_chromeless'], $args[ OPENSTATION_PORTAL_FLAG ], $args[ OPENSTATION_PORTAL_INTENT_FLAG ] );
		ksort( $args );
	}
	return rtrim( $path, '/' ) . '?' . http_build_query( $args );
}

function openstation_shell_dequeue_assets() {
	if ( ! openstation_is_shell_request() || ! openstation_is_shell_screen_request() ) {
		return;
	}

	foreach ( array( 'script', 'style' ) as $kind ) {

		$handles = apply_filters( 'openstation_shell_dequeue_handles', array(), $kind );
		$handles = array_values( array_unique( array_filter( (array) $handles, 'is_string' ) ) );
		if ( empty( $handles ) ) {
			continue;
		}

		$registry = 'script' === $kind ? wp_scripts() : wp_styles();
		if ( ! $registry ) {
			continue;
		}

		$drops = array_values( array_intersect( $handles, (array) $registry->queue ) );
		if ( empty( $drops ) ) {
			continue;
		}
		$safe    = openstation_protect_survivor_dependencies( $registry, $registry->queue, $drops );
		$refused = array_diff( $drops, $safe );
		foreach ( $refused as $handle ) {
			_doing_it_wrong(
				__FUNCTION__,
				sprintf(

					esc_html__( 'The %2$s handle "%1$s" cannot leave the shell screen: something still enqueued depends on it.', 'desktop-mode' ),
					esc_html( $handle ),
					esc_html( $kind )
				),
				''
			);
		}
		foreach ( $safe as $handle ) {
			if ( 'script' === $kind ) {
				wp_dequeue_script( $handle );
			} else {
				wp_dequeue_style( $handle );
			}
		}
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_shell_dequeue_assets', PHP_INT_MAX );
