<?php
/**
 * OpenStation — Content Graph: window + desktop icon registration.
 *
 * Filterable surface (mirrors the my-wordpress module shape):
 *
 *   - `open_station_content_graph_window_args`
 *   - `open_station_content_graph_icon_args`
 *   - `open_station_content_graph_user_can_use`
 *   - `open_station_content_graph_post_types`
 *   - `open_station_content_graph_template_html`
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The Corkboard SVG, shared by the window icon and the desktop icon.
 *
 * Dashicons has no corkboard, and the near misses all fail for the
 * same reason the old "Content Graph" name did: `networking` draws an
 * org chart, `layout` draws a wireframe — diagrams of the data, not a
 * thing on a desk. The pushpin is unavailable too, since
 * `dashicons-admin-post` already owns it for Posts.
 *
 * So: a cork board with two notes pinned to it, joined by a length of
 * thread. The thread is not decoration — it's the window's actual
 * subject, the links between pieces of content, drawn the way anyone
 * who has ever seen a detective's board already reads it. Without it
 * the icon says "pinboard"; with it, "connections".
 *
 * Drawn in `currentColor`, which makes it a silhouette: `renderIcon()`
 * paints it as a CSS mask rather than a background-image, so it takes
 * whatever colour the surface is already using for text. That keeps it
 * legible on the dark dock, on a light title bar, and on hover, with
 * nothing to configure. Fixed colours could not do that — a background
 * image has no colour to inherit.
 *
 * Hand-placed at 64×64 like the Games icons, the established shape for
 * custom icons here. Held to five elements because it renders as small
 * as 20px in the dock: board, two notes, thread, two pin heads. The
 * thread arcs up through the empty top half rather than running
 * between the notes, where a 5px gap would swallow it.
 *
 * @return string Raw `<svg>` markup.
 */
function open_station_content_graph_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
		// The board itself — outlined, so it frames rather than fills.
		. '<rect x="5" y="9" width="54" height="46" rx="4.5" fill="none" stroke="currentColor" stroke-width="4"/>'
		// Thread first: the pin heads below are drawn over its ends, so
		// the joins stay round instead of showing a stroke cap.
		. '<path d="M20.5 28Q32 16.5 43.5 28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'
		// Notes, each tilted a few degrees — pinned by hand, not laid out.
		. '<g transform="rotate(-7 20.5 39)">'
		. '<rect x="12" y="30" width="17" height="18" rx="1.5" fill="currentColor"/></g>'
		. '<g transform="rotate(7 43.5 39)">'
		. '<rect x="35" y="30" width="17" height="18" rx="1.5" fill="currentColor"/></g>'
		// Pin heads, sitting proud of each note's top edge. They are the
		// cue that separates a pinboard from a picture frame.
		. '<circle cx="20.5" cy="28" r="3" fill="currentColor"/>'
		. '<circle cx="43.5" cy="28" r="3" fill="currentColor"/>'
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
function open_station_content_graph_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	/**
	 * Filter whether the current user can see the Content Graph
	 * desktop icon and window.
	 *
	 * @param bool $can Default: edit_posts capability.
	 */
	return (bool) apply_filters( 'open_station_content_graph_user_can_use', $can );
}

/**
 * Build the descriptor list of post types eligible for the graph.
 * Defaults to every public post type (so CPTs participate by
 * default), matching the user-facing filter bar that ships ON for all
 * of them.
 *
 * @return array[] Each entry: `array( 'slug', 'label', 'icon', 'taxonomies' )`.
 */
function open_station_content_graph_post_types() {
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
	$filtered = apply_filters( 'open_station_content_graph_post_types', $result );
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
function open_station_content_graph_render_template() {
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
	$filtered = (string) apply_filters( 'open_station_content_graph_template_html', $html );

	$allowed_html = function_exists( 'open_station_native_window_allowed_html' )
		? open_station_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native window + the desktop icon on `init` priority 20,
 * matching the my-wordpress + recycle-bin modules.
 */
function open_station_content_graph_register_window() {
	if ( ! open_station_content_graph_user_can_use() ) {
		return;
	}

	$icon_uri = 'data:image/svg+xml;base64,' . base64_encode( open_station_content_graph_icon_svg() );

	$window_args = array(
		'title'      => __( 'Corkboard', 'desktop-mode' ),
		'icon'       => $icon_uri,
		'template'   => 'open_station_content_graph_render_template',
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
			// Labels the "Open in <site>" action on the detail panel,
			// which hands off to the site folder window.
			'siteName'       => open_station_site_title(),
			'postTypes'      => open_station_content_graph_post_types(),
		),
	);

	/**
	 * Filter the args used to register the Content Graph native window.
	 *
	 * @param array $window_args Args passed to `open_station_register_window()`.
	 */
	$window_args = (array) apply_filters( 'open_station_content_graph_window_args', $window_args );

	$registered = open_station_register_window( 'desktop-mode-content-graph', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Content Graph window registration failed: ' . $registered->get_error_message() );
		return;
	}

	$icon_args = array(
		'title'    => __( 'Corkboard', 'desktop-mode' ),
		'icon_svg' => open_station_content_graph_icon_svg(),
		'window'   => 'desktop-mode-content-graph',
		'pinned'   => false,
		'position' => 20,
	);

	/**
	 * Filter the args used to register the Content Graph desktop icon.
	 *
	 * @param array $icon_args Args passed to `open_station_register_icon()`.
	 */
	$icon_args = (array) apply_filters( 'open_station_content_graph_icon_args', $icon_args );

	open_station_register_icon( 'desktop-mode-content-graph', $icon_args );
}
add_action( 'init', 'open_station_content_graph_register_window', 20 );

/**
 * Enqueue the bundle's CSS in admin context. The script is lazy-
 * loaded by the native-window sync.
 */
function open_station_content_graph_enqueue_styles() {
	if ( ! open_station_content_graph_user_can_use() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-content-graph' );
}
add_action( 'admin_enqueue_scripts', 'open_station_content_graph_enqueue_styles', 30 );
