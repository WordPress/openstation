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
		<wpd-tabs value="posts" class="desktop-mode-posts__tabs">
			<wpd-tab value="posts"><?php esc_html_e( 'All posts', 'desktop-mode' ); ?></wpd-tab>
			<wpd-tab value="categories"><?php esc_html_e( 'Categories', 'desktop-mode' ); ?></wpd-tab>
			<wpd-tab value="tags"><?php esc_html_e( 'Tags', 'desktop-mode' ); ?></wpd-tab>
		</wpd-tabs>

		<wpd-tabpanel for="posts" class="desktop-mode-posts__panel">
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
						bordered
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
		</wpd-tabpanel>

		<wpd-tabpanel for="categories" class="desktop-mode-posts__panel">
			<div data-desktop-mode-posts-cats-host class="desktop-mode-posts__terms-host"></div>
		</wpd-tabpanel>

		<wpd-tabpanel for="tags" class="desktop-mode-posts__panel">
			<div data-desktop-mode-posts-tags-host class="desktop-mode-posts__terms-host"></div>
		</wpd-tabpanel>
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

	if ( function_exists( 'desktop_mode_kses_native_window_template' ) ) {
		echo desktop_mode_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
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
			// First-open intro dialog wiring — see `includes/seen-intros.php`.
			// `introSeen` is the boot-time snapshot; the bundle marks the
			// intro seen via `introUrl` after the user dismisses the dialog.
			'introSeen'        => desktop_mode_has_seen_intro( get_current_user_id(), 'posts' ),
			'introUrl'         => esc_url_raw( rest_url( 'desktop-mode/v1/intros/seen' ) ),
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
		// `desktop_mode_lock` is the REST field registered by My WordPress'
		// `lock.php` on every public post type — it tells us whether
		// another user is currently editing the row. Surfacing it on the
		// native Posts table means the title cell can paint a small lock
		// icon without an extra fetch.
		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,categories,tags,comment_status,excerpt,desktop_mode_lock,_links,_embedded',
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

/**
 * Surface a "non-trashed posts" count alongside core's `count` field
 * on category + post_tag REST responses.
 *
 * Core's `term_taxonomy.count` is updated by
 * `_update_post_term_count()`, which only includes posts in the
 * `publish` status by default. The Categories + Tags tabs in the
 * native Posts window want to surface DRAFT and PENDING posts too,
 * so the user can see "this category has 3 unpublished drafts" — a
 * detail core's count silently hides.
 *
 * The field is `desktop_mode_count` and lives on the term object in
 * REST view context. The per-term query is one cheap COUNT(*) on a
 * pre-indexed join, so 50 terms = 50 light queries — acceptable for
 * an admin UI.
 *
 * @since 0.8.0
 */
function desktop_mode_posts_window_register_count_field() {
	foreach ( array( 'category', 'post_tag' ) as $taxonomy ) {
		register_rest_field(
			$taxonomy,
			'desktop_mode_count',
			array(
				'get_callback' => 'desktop_mode_posts_window_term_count_any',
				'schema'       => array(
					'description' => __( 'Number of non-trashed posts (any status) in this term.', 'desktop-mode' ),
					'type'        => 'integer',
					'context'     => array( 'view', 'embed' ),
					'readonly'    => true,
				),
			)
		);
		// Mark the taxonomy's "default" term — the fallback that
		// receives uncategorised posts. Localised installs rename
		// the slug + name so a JS-side "uncategorized" string match
		// fails (Spanish: "Sin categoría"); the option is the only
		// reliable id.
		register_rest_field(
			$taxonomy,
			'desktop_mode_is_default',
			array(
				'get_callback' => 'desktop_mode_posts_window_term_is_default',
				'schema'       => array(
					'description' => __( 'Whether this term is the taxonomy\'s default (fallback) term.', 'desktop-mode' ),
					'type'        => 'boolean',
					'context'     => array( 'view', 'embed' ),
					'readonly'    => true,
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'desktop_mode_posts_window_register_count_field' );

/**
 * Bulk count endpoint — returns `{ term_id: count }` for every
 * requested term in one query. The `desktop_mode_count` REST field
 * (per-term) is the canonical source, but on installs where the
 * field isn't reaching the response (caching, REST middleware,
 * stale `_fields` whitelist) the JS calls this endpoint as a
 * defensive fallback so node labels never silently show 0.
 *
 * GET `/desktop-mode/v1/term-counts?taxonomy=category&ids=1,4,7`
 *
 * @since 0.8.0
 */
function desktop_mode_posts_window_register_term_counts_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/term-counts',
		array(
			'methods'             => 'GET',
			'callback'            => 'desktop_mode_posts_window_term_counts_callback',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'args'                => array(
				'taxonomy' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_key',
				),
				'ids'      => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_posts_window_register_term_counts_route' );

function desktop_mode_posts_window_term_counts_callback( $request ) {
	global $wpdb;
	$taxonomy = sanitize_key( (string) $request->get_param( 'taxonomy' ) );
	$tax_obj  = get_taxonomy( $taxonomy );
	if ( ! $tax_obj ) {
		return new WP_Error(
			'desktop_mode_invalid_taxonomy',
			__( 'Unknown taxonomy.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	$raw   = (string) $request->get_param( 'ids' );
	$parts = array_map( 'intval', explode( ',', $raw ) );
	$ids   = array_values( array_filter( $parts, function ( $id ) { return $id > 0; } ) );
	if ( count( $ids ) === 0 ) {
		return array();
	}
	// Cap to avoid runaway IN-clauses if a malicious caller inflates
	// the param. 500 is far above any plausible category/tag count.
	$ids = array_slice( $ids, 0, 500 );

	// Mirror WP core's `_update_post_term_count` filtering — limit to
	// the taxonomy's `object_type` (e.g. `post` for category) and
	// exclude statuses core treats as non-counting:
	//   - 'trash' + 'auto-draft' → user-not-published-and-never-will-be
	//   - 'inherit' → attachment-only status; excluded so attachments
	//                 aren't double-counted via parent inheritance
	// Everything else (publish, draft, pending, future, private) is
	// included so the user sees a "real" post count, not WP's
	// publish-only term_taxonomy.count.
	$object_types = array_map(
		'sanitize_key',
		(array) $tax_obj->object_type
	);
	$object_types = array_filter( $object_types, 'post_type_exists' );
	if ( empty( $object_types ) ) {
		$object_types = array( 'post' );
	}
	$id_placeholders   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tt.term_id, COUNT(p.ID) AS cnt
			 FROM {$wpdb->term_taxonomy} tt
			 LEFT JOIN {$wpdb->term_relationships} tr
			   ON tr.term_taxonomy_id = tt.term_taxonomy_id
			 LEFT JOIN {$wpdb->posts} p
			   ON p.ID = tr.object_id
			   AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
			   AND p.post_type IN ( $type_placeholders )
			 WHERE tt.taxonomy = %s
			 AND tt.term_id IN ( $id_placeholders )
			 GROUP BY tt.term_id",
			array_merge( $object_types, array( $taxonomy ), $ids )
		),
		ARRAY_A
	);
	$out  = array();
	foreach ( (array) $rows as $row ) {
		$out[ (string) (int) $row['term_id'] ] = (int) $row['cnt'];
	}
	foreach ( $ids as $id ) {
		if ( ! isset( $out[ (string) $id ] ) ) {
			$out[ (string) $id ] = 0;
		}
	}
	return $out;
}

/**
 * REST get_callback for `desktop_mode_is_default`. Reads the
 * taxonomy's default-term option (e.g. `default_category`) and
 * compares against the current term's id.
 *
 * @param array $term Term array as serialized by core's REST term controller.
 * @return bool
 */
function desktop_mode_posts_window_term_is_default( $term ) {
	$taxonomy = isset( $term['taxonomy'] ) ? (string) $term['taxonomy'] : '';
	$term_id  = isset( $term['id'] ) ? (int) $term['id'] : 0;
	if ( '' === $taxonomy || $term_id <= 0 ) {
		return false;
	}
	$option_key = 'default_' . $taxonomy; // 'default_category', 'default_post_tag', …
	$default_id = (int) get_option( $option_key, 0 );
	return $default_id > 0 && $default_id === $term_id;
}

/**
 * REST get_callback for `desktop_mode_count`. Counts every post in
 * the term except trashed + auto-draft (mirrors what users
 * conceptually mean by "posts in this category").
 *
 * @param array $term Term array as serialized by core's REST term controller.
 * @return int
 */
function desktop_mode_posts_window_term_count_any( $term ) {
	global $wpdb;
	$taxonomy = isset( $term['taxonomy'] ) ? (string) $term['taxonomy'] : '';
	$term_id  = isset( $term['id'] ) ? (int) $term['id'] : 0;
	$tt_id    = isset( $term['term_taxonomy_id'] ) ? (int) $term['term_taxonomy_id'] : 0;
	if ( $tt_id <= 0 && $term_id > 0 && '' !== $taxonomy ) {
		$tt_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT term_taxonomy_id FROM {$wpdb->term_taxonomy} WHERE term_id = %d AND taxonomy = %s LIMIT 1",
				$term_id,
				$taxonomy
			)
		);
	}
	if ( $tt_id <= 0 ) {
		return 0;
	}
	// Match WP core's `_update_post_term_count` filtering — limit to
	// the taxonomy's registered object_type and exclude statuses
	// core treats as non-counting (trash / auto-draft / inherit).
	$tax_obj = $taxonomy ? get_taxonomy( $taxonomy ) : null;
	$object_types = $tax_obj
		? array_filter( (array) $tax_obj->object_type, 'post_type_exists' )
		: array( 'post' );
	if ( empty( $object_types ) ) {
		$object_types = array( 'post' );
	}
	$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );
	return (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->term_relationships} tr
			 JOIN {$wpdb->posts} p ON p.ID = tr.object_id
			 WHERE tr.term_taxonomy_id = %d
			 AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
			 AND p.post_type IN ( $type_placeholders )",
			array_merge( array( $tt_id ), $object_types )
		)
	);
}
