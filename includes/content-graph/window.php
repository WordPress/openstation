<?php
/**
 * Desktop Mode — Content Graph: window + desktop icon registration.
 *
 * Filterable surface (mirrors the my-wordpress module shape):
 *
 *   - `desktop_mode_content_graph_window_args`
 *   - `desktop_mode_content_graph_icon_args`
 *   - `desktop_mode_content_graph_user_can_use`
 *   - `desktop_mode_content_graph_post_types`
 *   - `desktop_mode_content_graph_template_html`
 *
 * @package WPDesktopMode
 * @since   0.8.2
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the current user should see Content Graph.
 *
 * Mirrors the my-wordpress gate, anyone who can edit posts can view
 * the link map of the content they author and maintain.
 *
 * @since 0.8.2
 *
 * @return bool
 */
function desktop_mode_content_graph_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the Content Graph
	 * desktop icon and window.
	 *
	 * @since 0.8.2
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'desktop_mode_content_graph_user_can_use', $can );
}

/**
 * Build the descriptor list of post types eligible for the graph.
 * Defaults to every public post type (so CPTs participate by
 * default), matching the user-facing filter bar that ships ON for all
 * of them.
 *
 * @since 0.8.2
 *
 * @return array[] Each entry: `array( 'slug', 'label', 'icon', 'taxonomies' )`.
 */
function desktop_mode_content_graph_post_types() {
	$types  = get_post_types( array( 'public' => true ), 'objects' );
	$result = array();
	foreach ( $types as $type ) {
		// `attachment` is public but participates in the graph as media
		// (rendered in the side panel) rather than as a node — skip it
		// on the node-type axis to avoid every image becoming a node.
		if ( 'attachment' === $type->name ) {
			continue;
		}
		$result[] = array(
			'slug'       => (string) $type->name,
			'label'      => (string) $type->labels->name,
			'icon'       => (string) ( ! empty( $type->menu_icon ) ? $type->menu_icon : 'dashicons-admin-post' ),
			'taxonomies' => array(
				'category' => is_object_in_taxonomy( $type->name, 'category' ),
				'post_tag' => is_object_in_taxonomy( $type->name, 'post_tag' ),
			),
		);
	}

	/**
	 * Filter the list of post types shown in the Content Graph filter
	 * bar. Each entry must declare `slug`, `label`, `icon`, and `taxonomies`. Removing
	 * an entry hides it from the filter bar AND excludes it from the
	 * graph entirely.
	 *
	 * @since 0.8.2
	 *
	 * @param array[] $result Default: every public post type except attachment.
	 */
	$filtered = apply_filters( 'desktop_mode_content_graph_post_types', $result );
	return is_array( $filtered ) ? array_values( $filtered ) : $result;
}

/**
 * Render the Content Graph window's static template body. The bundle
 * mounts its UI into `[data-desktop-mode-content-graph-root]`.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-content-graph" data-desktop-mode-content-graph-root>
		<header class="desktop-mode-content-graph__toolbar" data-desktop-mode-content-graph-toolbar></header>
		<div class="desktop-mode-content-graph__body">
			<div class="desktop-mode-content-graph__stage" data-desktop-mode-content-graph-stage>
				<div class="desktop-mode-content-graph__loading" data-desktop-mode-content-graph-loading>
					<wpd-spinner></wpd-spinner>
				</div>
			</div>
			<aside class="desktop-mode-content-graph__panel" data-desktop-mode-content-graph-panel hidden></aside>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Content Graph window's template HTML.
	 *
	 * @since 0.8.2
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_content_graph_template_html', $html );

	$allowed_html = function_exists( 'desktop_mode_native_window_allowed_html' )
		? desktop_mode_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the desktop icon on `init` priority 20,
 * matching the my-wordpress + recycle-bin modules.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_register_window() {
	if ( ! desktop_mode_content_graph_user_can_use() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Content Graph', 'desktop-mode' ),
		'icon'       => 'dashicons-networking',
		'template'   => 'desktop_mode_content_graph_render_template',
		'script'     => 'desktop-mode-content-graph',
		'style'      => 'desktop-mode-content-graph',
		'width'      => 1080,
		'height'     => 720,
		'min_width'  => 720,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			'restRoot'       => esc_url_raw( rest_url() ),
			'restNonce'      => wp_create_nonce( 'wp_rest' ),
			'apiBase'        => esc_url_raw( rest_url( 'desktop-mode/v1/content-graph' ) ),
			'editPostUrl'    => esc_url_raw( admin_url( 'post.php' ) ),
			'editTermUrl'    => esc_url_raw( admin_url( 'term.php' ) ),
			'editUserUrl'    => esc_url_raw( admin_url( 'user-edit.php' ) ),
			'editCommentUrl' => esc_url_raw( admin_url( 'comment.php' ) ),
			'mediaUrl'       => esc_url_raw( admin_url( 'upload.php' ) ),
			'postTypes'      => desktop_mode_content_graph_post_types(),
		),
	);

	/**
	 * Filter the args used to register the Content Graph native window.
	 *
	 * @since 0.8.2
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_content_graph_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-content-graph', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Content Graph window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Content Graph', 'desktop-mode' ),
		'icon'     => 'dashicons-networking',
		'window'   => 'desktop-mode-content-graph',
		'pinned'   => false,
		'position' => 20,
	);

	/**
	 * Filter the args used to register the Content Graph desktop icon.
	 *
	 * @since 0.8.2
	 *
	 * @param array $icon_args Args passed to `desktop_mode_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'desktop_mode_content_graph_icon_args', $icon_args );

	desktop_mode_register_icon( 'desktop-mode-content-graph', $icon_args );
}
add_action( 'init', 'desktop_mode_content_graph_register_window', 20 );

/**
 * Enqueue the bundle's CSS in admin context. The script is lazy-
 * loaded by the native-window sync.
 *
 * @since 0.8.2
 */
function desktop_mode_content_graph_enqueue_styles() {
	if ( ! desktop_mode_content_graph_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-content-graph' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_content_graph_enqueue_styles', 30 );
