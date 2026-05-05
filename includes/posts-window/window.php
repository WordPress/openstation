<?php
/**
 * Desktop Mode — Native Posts Window: registration + template.
 *
 * Native window registered with `placement: 'none'` — the entry point
 * is the existing Posts dock tile (built from WordPress's `$menu`),
 * which the JS-side dock intercept rewrites to open this window when
 * `nativePostsEnabled` is on.
 *
 * The shell wraps the template echoed by `desktop_mode_posts_window_render_template()`
 * in `<template id="desktop-mode-native-window-desktop-mode-posts">` and
 * clones it into the window body BEFORE the JS render callback fires.
 * The `data-desktop-mode-posts-*` hooks below are the contract the JS
 * relies on — keep them intact (or rename via the filter) when
 * customizing the layout.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Posts window's template body.
 *
 * @since 0.8.0
 */
function desktop_mode_posts_window_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-posts" data-desktop-mode-posts-root>
		<header class="desktop-mode-posts__toolbar" data-desktop-mode-posts-toolbar>
			<div class="desktop-mode-posts__toolbar-left">
				<?php // Status segments are populated by the JS bundle from the
				// (filterable) `desktop_mode.postsWindow.statusSegments` list,
				// so a plugin can add CPT-specific statuses without forking
				// this template. The empty-string `value` mirrors the "All"
				// sentinel so the parent control paints it as selected on
				// first frame. ?>
				<wpd-segmented data-desktop-mode-posts-status value=""></wpd-segmented>
				<wpd-text-field
					data-desktop-mode-posts-search
					placeholder="<?php esc_attr_e( 'Search posts…', 'desktop-mode' ); ?>"
				></wpd-text-field>
			</div>
			<div class="desktop-mode-posts__toolbar-right" data-desktop-mode-posts-bulk hidden>
				<span class="desktop-mode-posts__count" data-desktop-mode-posts-count></span>
				<?php // Bulk-action buttons rendered from the JS-side
				// `desktop_mode.postsWindow.bulkActions` registry — defaults
				// ship "Move to trash"; plugins extend with Duplicate,
				// Export, Bulk Publish, etc. ?>
				<span class="desktop-mode-posts__bulk-actions" data-desktop-mode-posts-bulk-actions></span>
			</div>
			<div class="desktop-mode-posts__toolbar-trailing">
				<?php // Plugin-injected trailing buttons — rendered before the
				// built-in Refresh + Add New so plugin actions sit close to
				// the segmented control, with the framework's own buttons at
				// the far edge where users expect them. ?>
				<span class="desktop-mode-posts__toolbar-extras" data-desktop-mode-posts-toolbar-extras></span>
				<wpd-button variant="ghost" data-desktop-mode-posts-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</wpd-button>
				<wpd-button variant="primary" data-desktop-mode-posts-new>
					<span class="dashicons dashicons-plus" aria-hidden="true"></span>
					<?php esc_html_e( 'Add New', 'desktop-mode' ); ?>
				</wpd-button>
			</div>
		</header>
		<div class="desktop-mode-posts__body" data-desktop-mode-posts-body>
			<wpd-table
				data-desktop-mode-posts-table
				selectable="multi"
				sticky-header
				sticky-columns="1"
				hover
				striped
				loading
			>
				<div slot="empty" class="desktop-mode-posts__empty">
					<span class="dashicons dashicons-admin-post" aria-hidden="true"></span>
					<p><?php esc_html_e( 'No posts found.', 'desktop-mode' ); ?></p>
					<p class="desktop-mode-posts__empty-hint">
						<?php esc_html_e( 'Try a different search or change the status filter.', 'desktop-mode' ); ?>
					</p>
				</div>
			</wpd-table>
		</div>
		<footer class="desktop-mode-posts__pager" data-desktop-mode-posts-pager>
			<div class="desktop-mode-posts__pager-meta">
				<span data-desktop-mode-posts-page-indicator>—</span>
			</div>
			<div class="desktop-mode-posts__pager-nav">
				<wpd-button variant="ghost" data-desktop-mode-posts-prev disabled>
					<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
					<?php esc_html_e( 'Previous', 'desktop-mode' ); ?>
				</wpd-button>
				<wpd-button variant="ghost" data-desktop-mode-posts-next disabled>
					<?php esc_html_e( 'Next', 'desktop-mode' ); ?>
					<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
				</wpd-button>
				<label class="desktop-mode-posts__pager-perpage">
					<?php esc_html_e( 'Per page', 'desktop-mode' ); ?>
					<select data-desktop-mode-posts-per-page>
						<option value="10">10</option>
						<option value="20" selected>20</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
				</label>
			</div>
		</footer>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Posts window's template HTML.
	 *
	 * Keep the `data-desktop-mode-posts-*` hooks intact so the JS
	 * render callback can find its mount points, or rename them and
	 * update the matching constants in `src/posts-window/index.ts`.
	 *
	 * @since 0.8.0
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'desktop_mode_posts_window_template_html', $html );

	$allowed_html = function_exists( 'desktop_mode_native_window_allowed_html' )
		? desktop_mode_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

/**
 * Register the native Posts window on `init` (priority 20, after
 * `components.php` has bootstrapped the registry).
 *
 * Gated on `desktop_mode_posts_window_user_can_use()` — when the user
 * has not opted in (or lacks `edit_posts`), the window is simply not
 * registered and the dock-click swap silently falls back to the
 * iframe path.
 *
 * @since 0.8.0
 */
function desktop_mode_posts_window_register_window() {
	// Cap-only gate so that flipping the opt-in mid-session doesn't
	// require an F5. The opt-in is a runtime check on the JS-side
	// remap (`enabled: ( s ) => s.nativePostsEnabled === true` in
	// `src/desktop.ts`). Registering for every cap-eligible user is
	// cheap — the script + template + REST nonce all live in the
	// payload only, the actual fetch only happens when the user
	// opens the window.
	if ( ! desktop_mode_posts_window_user_can_register() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Posts', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-post',
		'template'   => 'desktop_mode_posts_window_render_template',
		'script'     => 'desktop-mode-posts-window',
		'style'      => 'desktop-mode-posts-window',
		'width'      => 1100,
		'height'     => 720,
		'min_width'  => 720,
		'min_height' => 480,
		// `'none'` — no dock or wallpaper tile from this registration.
		// The Posts dock tile lives in WordPress's `$menu` and the
		// JS-side dock intercept routes its click to `openById` here
		// when the opt-in is on. A separate tile would be a duplicate
		// entry point.
		'placement'  => 'none',
		'config'     => array(
			'restRoot'         => esc_url_raw( rest_url() ),
			'restNonce'        => wp_create_nonce( 'wp_rest' ),
			'postsUrl'         => esc_url_raw( rest_url( 'wp/v2/posts' ) ),
			'editPostUrlBase'  => esc_url_raw( admin_url( 'post.php' ) ),
			'newPostUrl'       => esc_url_raw( admin_url( 'post-new.php' ) ),
			'usersUrl'         => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'currentUserId'    => (int) get_current_user_id(),
			'defaultPerPage'   => 20,
			'queryArgs'        => desktop_mode_posts_window_default_query_args(),
		),
	);

	/**
	 * Filter the args used to register the native Posts window.
	 *
	 * @since 0.8.0
	 *
	 * @param array $window_args Args passed to `desktop_mode_register_window()`.
	 */
	$window_args = (array) apply_filters( 'desktop_mode_posts_window_args', $window_args );

	$registered = desktop_mode_register_window( 'desktop-mode-posts', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[desktop-mode] Native Posts window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'desktop_mode_posts_window_register_window', 20 );

/**
 * Default REST query args the JS bundle uses on every list fetch.
 *
 * Filterable so a plugin can flip the post type to a custom CPT (or
 * a list of CPTs) without forking the bundle. The JS bundle merges
 * these on top of the page/per-page/search/status/sort args it
 * generates per request.
 *
 * @since 0.8.0
 *
 * @return array
 */
function desktop_mode_posts_window_default_query_args() {
	$args = array(
		// `_embed` pulls author + taxonomy + featured-media side-loads
		// into `_embedded`, so the table can render avatars, term
		// chips, and thumbnails without N extra round-trips per row.
		'_embed' => 'author,wp:term,wp:featuredmedia',
		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,_links,_embedded',
	);

	/**
	 * Filter the default outbound REST query args for the Posts window.
	 *
	 * Drop in a `'post_type' => 'product'` to point the window at a
	 * CPT, or extend `_fields` to ship more columns. The bundle merges
	 * these on top of pagination/search/status/sort args.
	 *
	 * @since 0.8.0
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'desktop_mode_posts_window_query_args', $args );
}

/**
 * Switch the post-tag tax_query operator from the WP REST default `IN`
 * (any-of, OR) to `AND` (every-of, intersection) when the Posts window
 * client opts in via the `desktop_mode_tags_match=all` URL flag.
 *
 * The flag is sent only when more than one tag is selected — single-
 * tag queries are unaffected because AND with one term is identical
 * to IN. The filter is scoped to GET `/wp/v2/posts`-style queries so
 * other endpoints' tax_query semantics aren't touched.
 *
 * @since 0.8.0
 *
 * @param array           $args    `WP_Query` args after the REST controller
 *                                 prepared them.
 * @param WP_REST_Request $request Active REST request.
 * @return array Possibly-mutated args.
 */
function desktop_mode_posts_window_tags_and_filter( $args, $request ) {
	if ( ! ( $request instanceof WP_REST_Request ) ) {
		return $args;
	}
	$flag = $request->get_param( 'desktop_mode_tags_match' );
	if ( 'all' !== $flag ) {
		return $args;
	}
	if ( empty( $args['tax_query'] ) || ! is_array( $args['tax_query'] ) ) {
		return $args;
	}
	foreach ( $args['tax_query'] as $key => $clause ) {
		if ( ! is_array( $clause ) ) {
			continue;
		}
		if ( isset( $clause['taxonomy'] ) && 'post_tag' === $clause['taxonomy'] ) {
			$args['tax_query'][ $key ]['operator'] = 'AND';
		}
	}
	return $args;
}
add_filter( 'rest_post_query', 'desktop_mode_posts_window_tags_and_filter', 10, 2 );
