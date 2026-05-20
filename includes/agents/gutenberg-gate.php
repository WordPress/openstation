<?php
/**
 * Desktop Mode — Agents: Gutenberg + Guidelines-experiment soft-gate.
 *
 * The `wp_guideline` CPT lives in the Gutenberg plugin behind the
 * `gutenberg-guidelines` experiment flag. With Gutenberg inactive or
 * the experiment off, the post type genuinely does not exist — no rows,
 * no REST routes, nothing to write against.
 *
 * Rather than hard-failing (which would hide Agents entirely from sites
 * that haven't opted in yet) we soft-gate: the Agents section paints an
 * empty state with a one-click "Enable Guidelines experiment" button
 * that flips the option in-place. If Gutenberg itself is missing, the
 * empty state links to plugin-install instead.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the storage substrate Agents needs is available right now.
 *
 * Checks the runtime state — does the CPT exist, does the taxonomy
 * exist — rather than feature-detecting the Gutenberg version. That way
 * any substrate provider (Gutenberg, agents-api, a future Core port)
 * passes the same check.
 *
 * @since 0.23.0
 *
 * @return bool
 */
function desktop_mode_agents_storage_available() {
	$available = post_type_exists( 'wp_guideline' )
		&& taxonomy_exists( 'wp_guideline_type' );

	/**
	 * Filter whether the Agents storage substrate is available.
	 *
	 * Sites that ship their own `wp_guideline` polyfill via a
	 * non-standard path can return true here even if the default
	 * substrate detection misses them.
	 *
	 * @since 0.23.0
	 *
	 * @param bool $available Default detection result.
	 */
	return (bool) apply_filters( 'desktop_mode_agents_storage_available', $available );
}

/**
 * Whether the Gutenberg plugin is active right now.
 *
 * Used to decide whether the soft-gate empty state shows "Enable
 * Guidelines experiment" (Gutenberg active, just flip the option) or
 * "Install Gutenberg" (Gutenberg missing, link to plugin-install).
 *
 * @since 0.23.0
 *
 * @return bool
 */
function desktop_mode_agents_gutenberg_active() {
	if ( ! function_exists( 'is_plugin_active' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	return is_plugin_active( 'gutenberg/gutenberg.php' );
}

/**
 * AJAX endpoint that flips the `gutenberg-guidelines` experiment flag
 * to `1` in the Gutenberg-owned `gutenberg-experiments` option.
 *
 * Capability-gated to `manage_options` so non-admins can't toggle
 * experimental Gutenberg features behind an admin's back.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_ajax_enable_guidelines_experiment() {
	check_ajax_referer( 'desktop-mode-enable-guidelines', 'nonce' );

	if ( ! current_user_can( 'manage_options' ) ) {
		wp_send_json_error( 'desktop_mode_agents_forbidden', 403 );
	}

	if ( ! desktop_mode_agents_gutenberg_active() ) {
		wp_send_json_error( 'desktop_mode_agents_gutenberg_missing', 412 );
	}

	$opts = get_option( 'gutenberg-experiments', array() );
	if ( ! is_array( $opts ) ) {
		$opts = array();
	}
	$opts['gutenberg-guidelines'] = 1;
	update_option( 'gutenberg-experiments', $opts );

	wp_send_json_success(
		array(
			'reload' => true,
		)
	);
}
add_action( 'wp_ajax_desktop_mode_enable_guidelines_experiment', 'desktop_mode_ajax_enable_guidelines_experiment' );

/**
 * Build the config blob shipped to the bundle for the Agents section.
 *
 * Encapsulated here so `includes/my-wordpress/window.php` doesn't have
 * to know the substrate details — it just consumes one function.
 *
 * @since 0.23.0
 *
 * @return array
 */
function desktop_mode_agents_window_config() {
	$available = desktop_mode_agents_storage_available();

	$skill_term_id = 0;
	if ( $available ) {
		$term = get_term_by( 'slug', 'skill', 'wp_guideline_type' );
		if ( $term instanceof WP_Term ) {
			$skill_term_id = (int) $term->term_id;
		}
	}

	$send_to_targets = $available && function_exists( 'desktop_mode_agents_collect_send_to_targets' )
		? desktop_mode_agents_collect_send_to_targets()
		: array();

	return array(
		'enabled'               => $available,
		'gutenbergActive'       => desktop_mode_agents_gutenberg_active(),
		'skillTermId'           => $skill_term_id,
		'restNamespace'         => 'desktop-mode/v1',
		'enableExperimentNonce' => wp_create_nonce( 'desktop-mode-enable-guidelines' ),
		'gutenbergInstallUrl'   => esc_url_raw( admin_url( 'plugin-install.php?s=gutenberg&tab=search' ) ),
		// Send-to targets ship in the initial payload so the
		// context-menu filter wires up on bundle boot, without
		// waiting for the user to visit the Agents section. The
		// renderer pushes updates to this cache live whenever an
		// agent's triggers change.
		'sendToTargets'         => $send_to_targets,
	);
}
