<?php

$osc_pma_wp_root = '';
if ( ! empty( $_SERVER['DOCUMENT_ROOT'] ) ) {
	$osc_pma_doc = rtrim( (string) $_SERVER['DOCUMENT_ROOT'], '/\\' );
	if ( is_readable( $osc_pma_doc . '/wp-load.php' ) ) {
		$osc_pma_wp_root = $osc_pma_doc;
	}
	unset( $osc_pma_doc );
}
if ( '' === $osc_pma_wp_root ) {
	$osc_pma_walk = __DIR__;
	for ( $osc_pma_i = 0; $osc_pma_i < 12; $osc_pma_i++ ) {
		if ( is_readable( $osc_pma_walk . '/wp-load.php' ) ) {
			$osc_pma_wp_root = $osc_pma_walk;
			break;
		}
		$osc_pma_walk = dirname( $osc_pma_walk );
	}
	unset( $osc_pma_walk, $osc_pma_i );
}

if ( '' !== $osc_pma_wp_root && ! defined( 'ABSPATH' ) ) {
	if ( ! defined( 'SHORTINIT' ) ) {
		define( 'SHORTINIT', true );
	}

	set_error_handler( function () { return true; }, E_ALL );
	$osc_pma_prev_display = @ini_set( 'display_errors', '0' );
	$osc_pma_prev_report  = error_reporting( 0 );
	ob_start();
	require_once $osc_pma_wp_root . '/wp-load.php';
	ob_end_clean();
	error_reporting( $osc_pma_prev_report );
	@ini_set( 'display_errors', $osc_pma_prev_display );
	restore_error_handler();
	unset( $osc_pma_prev_display, $osc_pma_prev_report );

	if ( function_exists( 'remove_action' ) ) {
		remove_action( 'shutdown', 'wp_ob_end_flush_all', 1 );
	}
}
unset( $osc_pma_wp_root );

if ( ! function_exists( 'wp_get_environment_type' )
	|| 'local' !== wp_get_environment_type()
) {
	if ( ! headers_sent() ) {
		header( 'HTTP/1.0 404 Not Found' );
	}
	exit;
}

$osc_pma_session_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/osc-phpmyadmin-sessions';
if ( ! is_dir( $osc_pma_session_dir ) ) {
	@mkdir( $osc_pma_session_dir, 0700, true );
}
if ( is_dir( $osc_pma_session_dir ) && is_writable( $osc_pma_session_dir ) ) {
	@ini_set( 'session.save_path', $osc_pma_session_dir );
}
unset( $osc_pma_session_dir );

$cfg['environment'] = 'development';

$cfg['AllowThirdPartyFraming'] = 'sameorigin';

$cfg['blowfish_secret'] = defined( 'AUTH_KEY' )
	? substr( hash( 'sha256', AUTH_KEY ), 0, 32 )
	: str_repeat( '0', 32 );

$i = 1;
$cfg['Servers'][ $i ]['auth_type'] = 'config';
$cfg['Servers'][ $i ]['compress']  = false;

if ( defined( 'DB_USER' ) ) {

	$cfg['Servers'][ $i ]['host']            = defined( 'DB_HOST' ) ? DB_HOST : 'localhost';
	$cfg['Servers'][ $i ]['user']            = DB_USER;
	$cfg['Servers'][ $i ]['password']        = defined( 'DB_PASSWORD' ) ? DB_PASSWORD : '';
	$cfg['Servers'][ $i ]['only_db']         = defined( 'DB_NAME' ) ? DB_NAME : '';
	$cfg['Servers'][ $i ]['AllowNoPassword'] = false;
} else {

	$cfg['Servers'][ $i ]['host']            = '127.0.0.1';
	$cfg['Servers'][ $i ]['user']            = 'root';
	$cfg['Servers'][ $i ]['password']        = '';
	$cfg['Servers'][ $i ]['AllowNoPassword'] = true;
}

$cfg['ServerDefault']                 = 1;
$cfg['CheckConfigurationPermissions'] = false;
$cfg['ShowServerInfo']                = false;
$cfg['NavigationDisplayLogo']         = false;
$cfg['DefaultLang']                   = 'en';

$cfg['NavigationTreeEnableGrouping'] = false;
