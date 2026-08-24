<?php
/**
 * OpenStation — Content Graph: window + desktop icon registration.
 *
 * Filterable surface (mirrors the my-wordpress module shape):
 *
 *   - `openstation_content_graph_window_args`
 *   - `openstation_content_graph_icon_args`
 *   - `openstation_content_graph_user_can_use`
 *   - `openstation_content_graph_post_types`
 *   - `openstation_content_graph_template_html`
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The Corkboard SVG, shared by the window icon and the desktop icon.
 *
 * The thread is the window's actual subject: the links between pieces
 * of content. That reading is unchanged and is why this icon exists at
 * all. What changed is everything drawn around it.
 *
 * The previous version framed two pinned notes with the thread arcing
 * over them. On a 64-unit grid the arc closed the top of the
 * silhouette, and a closed top over two rectangles is a bag: at 40px
 * and below the icon read as a shopping bag rather than a board. The
 * frame was also spending most of the 20px budget on an outline that
 * carried no meaning, leaving the notes too small to be notes.
 *
 * So the board and the paper are gone and the graph is the whole mark:
 * one focused post with related ones fanned around it, which is what
 * the window itself draws now that nodes are discs rather than post-
 * type glyphs (see `src/content-graph/satellites.ts`). Sizes are
 * deliberately unequal, so the hierarchy reads without a caption.
 *
 * Pin-led marks are deliberately avoided: `assets/images/pushpin.svg`
 * belongs to pinned notes, and an icon led by a pin would point at
 * that feature instead of this one.
 *
 * Drawn in `currentColor`, which makes it a silhouette: `renderIcon()`
 * paints it as a CSS mask rather than a background-image, so it takes
 * whatever colour the surface is already using for text. That keeps it
 * legible on the dark dock, on a light title bar, and under a desktop
 * theme's icon tint, with nothing to configure.
 *
 * Hand-placed at 64×64 like the Games icon, the established shape for
 * custom icons here, and held to five elements because it renders as
 * small as 20px in the dock.
 *
 * @return string Raw `<svg>` markup.
 */
function openstation_content_graph_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		// Threads first: the discs below are drawn over their ends, so
		// the joins stay round instead of showing a stroke cap.
		. '<path d="M14 16 32 32 52 18M32 32 40 49" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
		// The focused post.
		. '<circle cx="32" cy="32" r="9" fill="currentColor"/>'
		// Its satellites, sized just under the hub so the eye lands on
		// the middle first.
		. '<circle cx="14" cy="16" r="5.5" fill="currentColor"/>'
		. '<circle cx="52" cy="18" r="5.5" fill="currentColor"/>'
		. '<circle cx="40" cy="49" r="5" fill="currentColor"/>'
		. '</svg>';
}

/**
 * Whether the current user should see Content Graph.
 *
 * Mirrors the my-wordpress gate, anyone who can edit posts can view
 * the link map of the content they author and maintain.
 *
 * @return bool
 */
function openstation_content_graph_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the Content Graph
	 * desktop icon and window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'openstation_content_graph_user_can_use', $can );
}

/**
 * Build the descriptor list of post types eligible for the graph.
 * Defaults to every public post type (so CPTs participate by
 * default), matching the user-facing filter bar that ships ON for all
 * of them.
 *
 * @return array[] Each entry: `array( 'slug', 'label', 'icon', 'taxonomies' )`.
 */
function openstation_content_graph_post_types() {
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
	 * bar. Each entry declares `slug`, `label`, `icon`, and optionally
	 * `taxonomies` (`array( 'category' => bool, 'post_tag' => bool )`);
	 * entries missing `taxonomies` get it derived from
	 * `is_object_in_taxonomy()` after filtering. Removing
	 * an entry hides it from the filter bar AND excludes it from the
	 * graph entirely.
	 *
	 * @param array[] $result Default: every public post type except attachment.
	 */
	$filtered = apply_filters( 'openstation_content_graph_post_types', $result );
	$filtered = is_array( $filtered ) ? array_values( $filtered ) : $result;

	foreach ( $filtered as $i => $entry ) {
		$slug                         = isset( $entry['slug'] ) ? (string) $entry['slug'] : '';
		$filtered[ $i ]['taxonomies'] = array(
			'category' => isset( $entry['taxonomies'] ) ? ! empty( $entry['taxonomies']['category'] ) : is_object_in_taxonomy( $slug, 'category' ),
			'post_tag' => isset( $entry['taxonomies'] ) ? ! empty( $entry['taxonomies']['post_tag'] ) : is_object_in_taxonomy( $slug, 'post_tag' ),
		);
	}

	return $filtered;
}

/**
 * Render the Content Graph window's static template body. The bundle
 * mounts its UI into `[data-os-content-graph-root]`.
 */
function openstation_content_graph_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-content-graph" data-os-content-graph-root>
		<header class="os-content-graph__toolbar" data-os-content-graph-toolbar></header>
		<div class="os-content-graph__body">
			<div class="os-content-graph__stage" data-os-content-graph-stage>
				<div class="os-content-graph__loading" data-os-content-graph-loading>
					<os-spinner></os-spinner>
				</div>
			</div>
			<aside class="os-content-graph__panel" data-os-content-graph-panel hidden></aside>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the Content Graph window's template HTML.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_content_graph_template_html', $html );

	$allowed_html = function_exists( 'openstation_native_window_allowed_html' )
		? openstation_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the desktop icon on `init` priority 20,
 * matching the my-wordpress + recycle-bin modules.
 */
function openstation_content_graph_register_window() {
	if ( ! openstation_content_graph_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( openstation_content_graph_icon_svg() );

	$window_args = array(
		'title'      => __( 'Corkboard', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'openstation_content_graph_render_template',
		'script'     => 'desktop-mode-content-graph',
		'styles'     => array( 'desktop-mode-content-graph' ),
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
			// Labels the "Open in <site>" action on the detail panel,
			// which hands off to the WP Explorer window.
			'siteName'       => openstation_site_title(),
			'postTypes'      => openstation_content_graph_post_types(),
		),
	);

	/**
	 * Filter the args used to register the Content Graph native window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_content_graph_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-content-graph', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Content Graph window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Corkboard', 'desktop-mode' ),
		'icon_svg' => openstation_content_graph_icon_svg(),
		'window'   => 'desktop-mode-content-graph',
		'pinned'   => false,
		'position' => 20,
	);

	/**
	 * Filter the args used to register the Content Graph desktop icon.
	 *
	 * @param array $icon_args Args passed to `openstation_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'openstation_content_graph_icon_args', $icon_args );

	openstation_register_icon( 'desktop-mode-content-graph', $icon_args );
}
add_action( 'init', 'openstation_content_graph_register_window', 20 );
