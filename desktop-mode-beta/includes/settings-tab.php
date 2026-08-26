<?php
/**
 * OS Settings → Beta tab.
 *
 * Registers the tab through OpenStation's public settings-tab API
 * (`openstation_register_settings_tab()` + a script handle), so the
 * tab appears live on plugin activation and disappears live on
 * deactivation, like any third-party tab. The same `beta.js` that
 * drives the Tools page detects the shell context and renders with
 * `<wpd-*>` components instead of classic admin markup.
 *
 * Every call is guarded — when OpenStation is missing (deactivated,
 * broken build) this file is inert and the Tools page remains the
 * working surface.
 *
 * @package DesktopModeBeta
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare the tab server-side.
 *
 * @since 0.1.0
 */
function desktop_mode_beta_register_settings_tab() {
	if ( ! function_exists( 'openstation_register_settings_tab' ) ) {
		return;
	}
	openstation_register_settings_tab(
		array(
			'id'         => 'beta',
			'label'      => __( 'Beta', 'desktop-mode-beta' ),
			'capability' => 'manage_options',
			'order'      => 35,
			'script'     => 'desktop-mode-beta-settings',
		)
	);
}
add_action( 'init', 'desktop_mode_beta_register_settings_tab' );

/**
 * Enqueue the UI script when the desktop shell renders for a user who
 * can manage builds.
 *
 * @since 0.1.0
 */
function desktop_mode_beta_shell_assets() {
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	if ( ! current_user_can( 'update_plugins' ) ) {
		return;
	}
	wp_register_script(
		'desktop-mode-beta-settings',
		DESKTOP_MODE_BETA_URL . 'assets/beta.js',
		array( 'openstation' ),
		DESKTOP_MODE_BETA_VERSION,
		true
	);
	wp_localize_script( 'desktop-mode-beta-settings', 'desktopModeBetaConfig', desktop_mode_beta_script_config( 'shell' ) );
	wp_enqueue_script( 'desktop-mode-beta-settings' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_beta_shell_assets' );
