<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_PORTAL_PATH = 'openstation';

const OPENSTATION_PORTAL_PATH_LEGACY = 'desktop-mode';

const OPENSTATION_PORTAL_FLAG = 'desktop_mode_portal';

const OPENSTATION_PORTAL_INTENT_FLAG = 'desktop_mode_portal_intent';

const OPENSTATION_CLASSIC_FLAG = 'desktop_mode_classic';

function openstation_portal_url() {
	return home_url( '/' . OPENSTATION_PORTAL_PATH . '/' );
}

function openstation_handle_portal_request( $wp ) {
	unset( $wp );

	if ( ! openstation_is_portal_request() ) {
		return;
	}

	if ( ! is_user_logged_in() ) {
		wp_safe_redirect( wp_login_url( openstation_portal_url() ) );
		exit;
	}

	if ( ! current_user_can( 'read' ) ) {
		wp_die(
			esc_html__( 'Sorry, you are not allowed to access the WordPress desktop.', 'desktop-mode' ),
			'',
			array( 'response' => 403 )
		);
	}

	$user_id = get_current_user_id();

	$auto_enable = apply_filters( 'openstation_portal_auto_enable', true, $user_id );

	if ( $auto_enable && openstation_portal_is_same_origin_navigation() && '1' !== get_user_meta( $user_id, 'desktop_mode_mode', true ) ) {
		update_user_meta( $user_id, 'desktop_mode_mode', '1' );

		openstation_record_user_enabled( $user_id );
	}

	$target     = '';
	$has_intent = false;
	if ( ! empty( $_GET['target'] ) ) {

		$target = openstation_sanitize_portal_target( esc_url_raw( wp_unslash( $_GET['target'] ) ) );
		if ( '' !== $target ) {
			$has_intent = true;
		}
	}

	wp_safe_redirect( openstation_shell_url( $target, $has_intent ) );
	exit;
}
add_action( 'parse_request', 'openstation_handle_portal_request' );

function openstation_portal_is_same_origin_navigation() {
	if ( ! empty( $_SERVER['HTTP_SEC_FETCH_SITE'] ) ) {
		$site = strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_SITE'] ) ) );
		return in_array( $site, array( 'same-origin', 'same-site', 'none' ), true );
	}

	if ( empty( $_SERVER['HTTP_REFERER'] ) ) {
		return true;
	}

	$referer_host = wp_parse_url( esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ), PHP_URL_HOST );
	$home_host    = wp_parse_url( home_url(), PHP_URL_HOST );

	if ( ! is_string( $referer_host ) || '' === $referer_host ) {
		return true;
	}

	return is_string( $home_host ) && strtolower( $referer_host ) === strtolower( $home_host );
}

function openstation_is_portal_request() {
	if ( empty( $_SERVER['REQUEST_URI'] ) ) {
		return false;
	}

	$uri  = esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) );
	$path = wp_parse_url( $uri, PHP_URL_PATH );
	if ( ! is_string( $path ) ) {
		return false;
	}

	$home_path = wp_parse_url( home_url( '/' ), PHP_URL_PATH );
	$home_path = is_string( $home_path ) ? rtrim( $home_path, '/' ) : '';

	$path = '/' . ltrim( rtrim( $path, '/' ), '/' );

	return in_array(
		$path,
		array(
			$home_path . '/' . OPENSTATION_PORTAL_PATH,
			$home_path . '/' . OPENSTATION_PORTAL_PATH_LEGACY,
		),
		true
	);
}

function openstation_redirect_plain_admin_to_portal() {
	if ( ! openstation_is_enabled() ) {
		return;
	}

	if ( openstation_is_shell_screen_request() ) {
		return;
	}
	if ( openstation_is_chromeless_request() ) {
		return;
	}

	if ( function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request() ) {
		return;
	}

	if ( is_multisite() && is_user_admin() ) {
		return;
	}
	if ( wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return;
	}
	if ( ! empty( $_SERVER['REQUEST_METHOD'] ) && 'GET' !== strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) ) {
		return;
	}

	if ( openstation_is_subresource_request() ) {
		return;
	}

	if ( ! empty( $_GET[ OPENSTATION_CLASSIC_FLAG ] ) ) {
		return;
	}

	global $pagenow;
	if ( in_array( $pagenow, array( 'admin-post.php', 'admin-ajax.php' ), true ) ) {
		return;
	}

	$target = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
	$target = is_string( $target ) ? $target : '';

	if ( ! empty( $_GET[ OPENSTATION_PORTAL_FLAG ] ) ) {
		$clean  = openstation_sanitize_portal_target( $target );
		$intent = '' !== $clean && ! empty( $_GET[ OPENSTATION_PORTAL_INTENT_FLAG ] );
		wp_safe_redirect( openstation_shell_url( $clean, $intent ) );
		exit;
	}

	$redirect = apply_filters( 'openstation_admin_redirect_to_portal', true, get_current_user_id() );
	if ( ! $redirect ) {
		return;
	}

	if ( '' !== $target && openstation_is_classic_referer() ) {
		wp_safe_redirect( add_query_arg( OPENSTATION_CLASSIC_FLAG, '1', $target ) );
		exit;
	}

	if ( openstation_portal_forward_is_redundant( $target ) ) {

		if ( apply_filters( 'openstation_skip_redundant_portal_forward', true, $target ) ) {
			wp_safe_redirect( openstation_shell_url( openstation_sanitize_portal_target( $target ), true ) );
			exit;
		}
	}

	$portal_url = openstation_portal_url();
	if ( '' !== $target ) {
		$portal_url = add_query_arg( 'target', rawurlencode( $target ), $portal_url );
	}

	wp_safe_redirect( $portal_url );
	exit;
}
add_action( 'admin_init', 'openstation_redirect_plain_admin_to_portal' );

function openstation_portal_forward_is_redundant( $request_uri ) {
	global $pagenow;

	if ( ! is_string( $request_uri ) || '' === $request_uri ) {
		return false;
	}

	$path = wp_parse_url( $request_uri, PHP_URL_PATH );
	if ( ! is_string( $path ) || '' === $path ) {
		return false;
	}

	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	$admin_path = is_string( $admin_path ) ? $admin_path : '/wp-admin/';
	if ( 0 !== strpos( $path, $admin_path ) ) {
		return false;
	}

	$file = ltrim( (string) substr( $path, strlen( $admin_path ) ), '/' );
	if ( '' === $file ) {
		$file = 'index.php';
	}

	if ( is_wp_error( openstation_resolve_admin_target( $file ) ) ) {
		return false;
	}

	if ( ! is_string( $pagenow ) || strtolower( $file ) !== strtolower( $pagenow ) ) {
		return false;
	}

	$rewritten = array(
		'openstation_chromeless',
		OPENSTATION_PORTAL_FLAG,
		OPENSTATION_PORTAL_INTENT_FLAG,
		'target',
	);
	foreach ( $rewritten as $key ) {
		if ( isset( $_GET[ $key ] ) ) {
			return false;
		}
	}

	return true;
}

function openstation_portal_entry_url( $user_id ) {
	$session = openstation_get_session( $user_id );

	$default_window = openstation_get_default_window( $user_id );
	$fallback       = $default_window['url'];

	if ( is_string( $fallback ) && 0 === strpos( $fallback, 'native:' ) ) {
		$fallback = admin_url();
	}

	if ( empty( $session['focused'] ) || empty( $session['windows'] ) ) {
		return $fallback;
	}

	foreach ( $session['windows'] as $win ) {
		if ( ! isset( $win['id'], $win['url'] ) ) {
			continue;
		}
		if ( $win['id'] !== $session['focused'] ) {
			continue;
		}
		if ( ! openstation_url_is_same_admin( $win['url'] ) ) {
			return $fallback;
		}

		if ( openstation_url_is_shell_screen( $win['url'] ) ) {
			return $fallback;
		}
		return remove_query_arg( array( 'openstation_chromeless', OPENSTATION_PORTAL_FLAG ), $win['url'] );
	}

	return $fallback;
}

function openstation_sanitize_portal_target( $raw ) {
	if ( ! is_string( $raw ) || '' === $raw ) {
		return '';
	}

	if ( preg_match( '#^([a-z][a-z0-9+.-]*:|//)#i', $raw ) ) {
		return '';
	}

	if ( '/' !== $raw[0] ) {
		return '';
	}

	$path  = wp_parse_url( $raw, PHP_URL_PATH );
	$query = wp_parse_url( $raw, PHP_URL_QUERY );
	if ( ! is_string( $path ) || '' === $path ) {
		return '';
	}

	$admin_path = wp_parse_url( admin_url(), PHP_URL_PATH );
	$admin_path = is_string( $admin_path ) ? $admin_path : '/wp-admin/';
	if ( 0 !== strpos( $path, $admin_path ) ) {
		return '';
	}

	$file = substr( $path, strlen( $admin_path ) );
	$file = ltrim( (string) $file, '/' );

	$network = 0 === strpos( $file, 'network/' );
	if ( $network ) {
		$file = substr( $file, strlen( 'network/' ) );
	}

	if ( '' === $file ) {
		$file = 'index.php';
	}

	$target = openstation_resolve_admin_target( $file, $network );
	if ( is_wp_error( $target ) ) {
		return '';
	}

	if ( is_string( $query ) && '' !== $query ) {
		parse_str( $query, $args );
		unset( $args['openstation_chromeless'], $args[ OPENSTATION_PORTAL_FLAG ], $args[ OPENSTATION_PORTAL_INTENT_FLAG ], $args['target'] );
		if ( ! empty( $args ) ) {
			$target = add_query_arg( $args, $target );
		}
	}

	if ( openstation_url_is_shell_screen( $target ) ) {
		return '';
	}

	if ( openstation_url_is_page_less_admin_php( $target ) ) {
		return '';
	}

	return $target;
}
