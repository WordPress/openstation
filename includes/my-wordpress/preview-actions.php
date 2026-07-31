<?php
/**
 * Desktop Mode — My WordPress: server-side preview-action descriptors.
 *
 * Plugins register action buttons that appear in the right-pane of
 * any My WordPress section (posts, pages, users, media, plugin-
 * defined kinds). Server-side declaration buys:
 *
 *   - Capability gating: an action a viewer can't run is never
 *     shipped to their bundle (no client-side hide-after-render
 *     race).
 *   - Optional script enqueue: the registering plugin can declare a
 *     `script` handle and we'll auto-enqueue it for users who can
 *     see the action.
 *   - One source of truth for both the right-pane action row and
 *     the per-tile context menu — same descriptor.
 *
 * Descriptor shape:
 *
 *   [
 *     'id'         => 'my-plugin/compress-image',  // required, unique
 *     'label'      => 'Compress this image',       // required
 *     'icon'       => 'dashicons-image-rotate',    // optional
 *     'capability' => 'upload_files',              // optional, default 'read'
 *     'mime'       => '^image/',                   // optional, PCRE
 *     'sections'   => array( 'media' ),            // optional, default all
 *     'script'     => 'my-plugin-actions',         // optional handle
 *   ]
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Collect plugin-registered descriptors, drop ones the current user
 * can't run, and return the array ready for the window config blob.
 *
 * @return array[]
 */
function desktop_mode_my_wordpress_collect_preview_actions() {
	/**
	 * Filter the list of preview-action descriptors that appear in
	 * the right-pane of any My WordPress section.
	 *
	 * **Status: Experimental** — the descriptor shape may gain
	 * fields. Existing fields (`id`, `label`, `icon`, `capability`,
	 * `mime`, `sections`, `script`) will continue to work.
	 *
	 * @param array[] $actions Default: empty array.
	 */
	$actions = (array) apply_filters( 'desktop_mode_my_wordpress_preview_actions', array() );

	$out = array();
	foreach ( $actions as $action ) {
		if ( ! is_array( $action ) || empty( $action['id'] ) || empty( $action['label'] ) ) {
			continue;
		}
		$cap = isset( $action['capability'] ) && '' !== $action['capability']
			? (string) $action['capability']
			: 'read';
		if ( ! current_user_can( $cap ) ) {
			continue;
		}
		$descriptor = array(
			'id'    => (string) $action['id'],
			'label' => (string) $action['label'],
		);
		if ( ! empty( $action['icon'] ) ) {
			$descriptor['icon'] = (string) $action['icon'];
		}
		if ( ! empty( $action['mime'] ) ) {
			$descriptor['mime'] = (string) $action['mime'];
		}
		if ( ! empty( $action['sections'] ) && is_array( $action['sections'] ) ) {
			$descriptor['sections'] = array_values( array_map( 'strval', $action['sections'] ) );
		}
		if ( ! empty( $action['script'] ) ) {
			$descriptor['script'] = (string) $action['script'];
		}
		$out[] = $descriptor;
	}
	return $out;
}

/**
 * Enqueue the JS handles declared by visible preview-action
 * descriptors. Called from the bundle's `admin_enqueue_scripts`
 * hook so the handlers are wired before the bundle paints.
 */
function desktop_mode_my_wordpress_enqueue_preview_action_scripts() {
	if ( ! function_exists( 'desktop_mode_my_wordpress_user_can_use' ) || ! desktop_mode_my_wordpress_user_can_use() ) {
		return;
	}
	$actions = desktop_mode_my_wordpress_collect_preview_actions();
	foreach ( $actions as $action ) {
		if ( ! empty( $action['script'] ) && wp_script_is( (string) $action['script'], 'registered' ) ) {
			wp_enqueue_script( (string) $action['script'] );
		}
	}
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_my_wordpress_enqueue_preview_action_scripts', 40 );
