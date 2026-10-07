<?php

defined( 'ABSPATH' ) || exit;

function openstation_url_is_same_admin( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}

	$parts       = wp_parse_url( $url );
	$admin_parts = wp_parse_url( admin_url() );
	if ( ! is_array( $parts ) || ! is_array( $admin_parts ) ) {
		return false;
	}

	$url_host   = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
	$admin_host = isset( $admin_parts['host'] ) ? strtolower( $admin_parts['host'] ) : '';
	if ( '' === $url_host || $url_host !== $admin_host ) {
		return false;
	}

	$url_path   = isset( $parts['path'] ) ? $parts['path'] : '';
	$admin_path = isset( $admin_parts['path'] ) ? $admin_parts['path'] : '/wp-admin/';
	return 0 === strpos( $url_path, $admin_path );
}

function openstation_url_is_page_less_admin_php( $url ) {
	if ( ! is_string( $url ) || '' === $url ) {
		return false;
	}

	$path = wp_parse_url( $url, PHP_URL_PATH );
	if ( ! is_string( $path ) || 'admin.php' !== basename( $path ) ) {
		return false;
	}

	$query = wp_parse_url( $url, PHP_URL_QUERY );
	if ( ! is_string( $query ) || '' === $query ) {
		return true;
	}

	parse_str( $query, $args );
	return ! isset( $args['page'] ) || ! is_string( $args['page'] ) || '' === $args['page'];
}

function openstation_resolve_admin_target( $file, $network = false ) {
	$file = is_string( $file ) ? trim( $file ) : '';
	if ( '' === $file ) {
		return new WP_Error(
			'openstation_empty_target',
			__( 'Admin target cannot be empty.', 'desktop-mode' )
		);
	}

	if ( false !== strpos( $file, '..' ) || false !== strpos( $file, '/' ) || false !== strpos( $file, '\\' ) ) {
		return new WP_Error(
			'openstation_invalid_target',
			__( 'Admin target contains invalid path characters.', 'desktop-mode' )
		);
	}

	if ( ! preg_match( '/^[a-z0-9_-]+\.php$/i', $file ) ) {
		return new WP_Error(
			'openstation_invalid_target',
			__( 'Admin target must be a plain .php filename.', 'desktop-mode' )
		);
	}

	if ( $network ) {
		return in_array( strtolower( $file ), openstation_network_admin_target_allowlist(), true )
			? network_admin_url( $file )
			: new WP_Error(
				'openstation_unknown_target',
				__( 'Admin target does not exist.', 'desktop-mode' )
			);
	}

	if ( ! in_array( strtolower( $file ), openstation_admin_target_allowlist(), true ) ) {
		return new WP_Error(
			'openstation_unknown_target',
			__( 'Admin target does not exist.', 'desktop-mode' )
		);
	}

	return admin_url( $file );
}

function openstation_network_admin_target_allowlist() {
	return array(
		'index.php',
		'sites.php',
		'site-new.php',
		'site-info.php',
		'site-users.php',
		'site-themes.php',
		'site-settings.php',
		'users.php',
		'user-new.php',
		'themes.php',
		'theme-install.php',
		'plugins.php',
		'plugin-install.php',
		'plugin-editor.php',
		'settings.php',
		'setup.php',
		'upgrade.php',
		'update-core.php',
		'about.php',
		'credits.php',
		'freedoms.php',
		'privacy.php',
	);
}

function openstation_admin_target_allowlist() {
	$files = array(
		'about.php',
		'admin-ajax.php',
		'admin-footer.php',
		'admin-header.php',
		'admin-post.php',
		'admin.php',
		'async-upload.php',
		'authorize-application.php',
		'comment.php',
		'credits.php',
		'custom-background.php',
		'custom-header.php',
		'customize.php',
		'edit-comments.php',
		'edit-form-advanced.php',
		'edit-form-blocks.php',
		'edit-form-comment.php',
		'edit-link-form.php',
		'edit-tag-form.php',
		'edit-tags.php',
		'edit.php',
		'erase-personal-data.php',
		'export-personal-data.php',
		'export.php',
		'freedoms.php',
		'import.php',
		'index.php',
		'install.php',
		'link-add.php',
		'link-manager.php',
		'link.php',
		'load-scripts.php',
		'load-styles.php',
		'media-new.php',
		'media-upload.php',
		'media.php',
		'menu-header.php',
		'menu.php',
		'moderation.php',
		'ms-admin.php',
		'ms-delete-site.php',
		'ms-edit.php',
		'ms-options.php',
		'ms-sites.php',
		'ms-themes.php',
		'ms-upgrade-network.php',
		'ms-users.php',
		'my-sites.php',
		'nav-menus.php',
		'network.php',
		'options-discussion.php',
		'options-general.php',
		'options-head.php',
		'options-media.php',
		'options-permalink.php',
		'options-privacy.php',
		'options-reading.php',
		'options-writing.php',
		'options.php',
		'plugin-editor.php',
		'plugin-install.php',
		'plugins.php',
		'post-new.php',
		'post.php',
		'press-this.php',
		'privacy-policy-guide.php',
		'privacy.php',
		'profile.php',
		'revision.php',
		'setup-config.php',
		'site-editor.php',
		'site-health-info.php',
		'site-health.php',
		'sidebar.php',
		'term.php',
		'theme-editor.php',
		'theme-install.php',
		'themes.php',
		'tools.php',
		'update-core.php',
		'update.php',
		'upgrade.php',
		'upload.php',
		'user-edit.php',
		'user-new.php',
		'users.php',
		'widgets.php',
	);

	$files = (array) apply_filters( 'openstation_admin_target_allowlist', $files );

	return array_values( array_unique( array_map( 'strtolower', array_filter( $files, 'is_string' ) ) ) );
}

function openstation_is_chromeless_request() {
	if ( ! openstation_is_enabled() ) {

		return false;
	}

	if ( ! empty( $_GET['openstation_chromeless'] ) && '1' === sanitize_text_field( wp_unslash( $_GET['openstation_chromeless'] ) ) ) {
		return true;
	}

	$fetch_dest = isset( $_SERVER['HTTP_SEC_FETCH_DEST'] )
		? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_DEST'] ) )
		: '';
	$fetch_site = isset( $_SERVER['HTTP_SEC_FETCH_SITE'] )
		? sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_SITE'] ) )
		: '';
	if ( 'iframe' === $fetch_dest && 'same-origin' === $fetch_site ) {

		return (bool) apply_filters( 'openstation_chromeless_sec_fetch_fallback', true );
	}

	return false;
}

function openstation_is_classic_request() {

	if ( empty( $_GET[ OPENSTATION_CLASSIC_FLAG ] ) ) {
		return false;
	}

	return '1' === sanitize_text_field( wp_unslash( $_GET[ OPENSTATION_CLASSIC_FLAG ] ) );
}

function openstation_is_classic_referer() {
	if ( empty( $_SERVER['HTTP_REFERER'] ) ) {
		return false;
	}
	$referer = esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) );
	$query   = wp_parse_url( $referer, PHP_URL_QUERY );
	if ( ! openstation_url_is_same_admin( $referer ) || ! is_string( $query ) ) {
		return false;
	}
	parse_str( $query, $args );
	return isset( $args[ OPENSTATION_CLASSIC_FLAG ] ) && '1' === $args[ OPENSTATION_CLASSIC_FLAG ];
}

function openstation_is_subresource_request() {
	if ( empty( $_SERVER['HTTP_SEC_FETCH_MODE'] ) ) {
		return false;
	}
	$mode = strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_SEC_FETCH_MODE'] ) ) );
	return '' !== $mode && 'navigate' !== $mode;
}

function openstation_chromeless_hide_admin_bar( $show ) {
	if ( openstation_is_chromeless_request() ) {
		return false;
	}
	return $show;
}
add_filter( 'show_admin_bar', 'openstation_chromeless_hide_admin_bar' );

function openstation_chromeless_suppress_admin_bar() {
	if ( openstation_is_chromeless_request() ) {
		remove_action( 'in_admin_header', 'wp_admin_bar_render', 0 );
		remove_action( 'wp_body_open', 'wp_admin_bar_render', 0 );
	}
}
add_action( 'admin_init', 'openstation_chromeless_suppress_admin_bar' );

function openstation_chromeless_silence_admin_bar( $class_name ) {
	if ( ! openstation_is_chromeless_request() ) {
		return $class_name;
	}

	if ( ! apply_filters( 'openstation_chromeless_silence_admin_bar', true ) ) {
		return $class_name;
	}

	if ( ! class_exists( 'WP_Admin_Bar' ) ) {
		return $class_name;
	}
	require_once __DIR__ . '/class-openstation-silent-admin-bar.php';

	return 'OpenStation_Silent_Admin_Bar';
}
add_filter( 'wp_admin_bar_class', 'openstation_chromeless_silence_admin_bar' );

function openstation_chromeless_suppress_update_nags() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}
	remove_action( 'admin_notices', 'update_nag', 3 );
	remove_action( 'network_admin_notices', 'update_nag', 3 );
	remove_action( 'admin_notices', 'maintenance_nag', 10 );
	remove_action( 'network_admin_notices', 'maintenance_nag', 10 );
}
add_action( 'admin_init', 'openstation_chromeless_suppress_update_nags' );

function openstation_chromeless_suppress_core_notices() {
	if ( ! openstation_is_chromeless_request() ) {
		return;
	}
	remove_action( 'admin_notices', 'wp_recovery_mode_nag', 1 );
	remove_action( 'admin_notices', 'default_password_nag' );
	remove_action( 'admin_notices', 'deactivated_plugins_notice', 5 );
	remove_action( 'admin_notices', 'paused_plugins_notice', 5 );
	remove_action( 'admin_notices', 'paused_themes_notice', 5 );
}
add_action( 'admin_init', 'openstation_chromeless_suppress_core_notices' );

function openstation_chromeless_suppress_auth_check( $show ) {
	if ( openstation_is_chromeless_request() ) {
		return false;
	}
	return $show;
}
add_filter( 'wp_auth_check_load', 'openstation_chromeless_suppress_auth_check' );

function openstation_chromeless_preserve_redirect( $location ) {
	if ( empty( $location ) || ! openstation_is_chromeless_request() ) {
		return $location;
	}

	if ( ! openstation_is_admin_redirect_target( $location ) ) {
		return $location;
	}

	if ( false !== strpos( $location, 'openstation_chromeless=' ) ) {
		return $location;
	}

	return add_query_arg( 'openstation_chromeless', '1', $location );
}
add_filter( 'wp_redirect', 'openstation_chromeless_preserve_redirect', 999 );

function openstation_classic_preserve_redirect( $location ) {
	if ( empty( $location ) || ! openstation_is_classic_request() ) {
		return $location;
	}

	if ( ! openstation_is_admin_redirect_target( $location ) ) {
		return $location;
	}

	if ( false !== strpos( $location, OPENSTATION_CLASSIC_FLAG . '=' ) ) {
		return $location;
	}

	return add_query_arg( OPENSTATION_CLASSIC_FLAG, '1', $location );
}
add_filter( 'wp_redirect', 'openstation_classic_preserve_redirect', 999 );

function openstation_is_admin_redirect_target( $location ) {
	$location = (string) $location;
	if ( '' === $location ) {
		return false;
	}

	$parts = wp_parse_url( $location );
	if ( false === $parts ) {
		return false;
	}

	if ( ! empty( $parts['host'] ) ) {
		$site_host = wp_parse_url( site_url(), PHP_URL_HOST );
		if ( $site_host && 0 !== strcasecmp( (string) $parts['host'], (string) $site_host ) ) {
			return false;
		}
	}

	$path = isset( $parts['path'] ) ? (string) $parts['path'] : '';

	if ( '' !== $path ) {

		if ( false !== strpos( $path, '/wp-admin/' ) ) {
			return true;
		}

		if ( '/' === $path[0] ) {
			return false;
		}
	}

	return is_admin();
}
