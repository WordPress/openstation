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
 * @package OpenStationBeta
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare the tab server-side.
 *
 * @since 0.1.0
 */
function openstation_beta_register_settings_tab() {
	if ( ! function_exists( 'openstation_register_settings_tab' ) ) {
		return;
	}
	// The tab and its script answer to the same capability. Declaring
	// the tab for a user who will never get the script leaves the
	// shell's payload builder looking for a handle nobody registered.
	if ( ! current_user_can( 'update_plugins' ) ) {
		return;
	}
	openstation_register_settings_tab(
		array(
			'id'         => 'beta',
			'label'      => __( 'Beta', 'openstation-beta' ),
			'capability' => 'manage_options',
			'order'      => 35,
			'script'     => 'openstation-beta-settings',
		)
	);
}
add_action( 'init', 'openstation_beta_register_settings_tab' );

/**
 * Enqueue the UI script when the desktop shell renders for a user who
 * can manage builds.
 *
 * @since 0.1.0
 */
function openstation_beta_shell_assets() {
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( ! current_user_can( 'update_plugins' ) ) {
		return;
	}

	wp_register_script(
		'openstation-beta-settings',
		OPENSTATION_BETA_URL . 'assets/beta.js',
		array( 'openstation' ),
		OPENSTATION_BETA_VERSION,
		true
	);
	wp_localize_script( 'openstation-beta-settings', 'openStationBetaConfig', openstation_beta_script_config( 'shell' ) );

	// Inside a chromeless iframe the tab has no shell to render into,
	// so the script is never ENQUEUED here — but it stays REGISTERED,
	// because this is also where OpenStation harvests the settings-tab
	// payload it posts up to the parent after a plugin is activated.
	// An unregistered handle resolves to an empty URL there: the tab is
	// dropped from that payload (so activating anything from inside a
	// window took the Beta tab away until the next reload) and
	// `openstation_register_settings_tab_script()` reports the missing
	// registration through `_doing_it_wrong()`.
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}

	wp_enqueue_script( 'openstation-beta-settings' );
}
// Priority 5, not the default 10: OpenStation harvests the settings-tab
// payload from `openstation_enqueue_assets()` at priority 10, and a
// handle registered after the harvest is a handle the harvest could not
// resolve — an empty `scriptUrl` in the payload and a `_doing_it_wrong()`
// notice naming this file's handle. Same contract the lazy native-window
// config follows (`Tests_OpenStation_LazyWindowConfigPriority`).
add_action( 'admin_enqueue_scripts', 'openstation_beta_shell_assets', 5 );
