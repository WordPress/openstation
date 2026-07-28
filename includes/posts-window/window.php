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
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Posts window's template body.
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
 * Gated on `desktop_mode_posts_window_user_can_register()` — cap-only,
 * so when the user lacks `edit_posts` the window is simply not
 * registered. The opt-in toggle is enforced at runtime by the JS-side
 * URL remap, so flipping it mid-session never requires a reload.
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
 * Shared site-wide cache version for any term-derived endpoint
 * payload (bulk counts, tag cooccurrence, …). Stored in a non-
 * autoloaded option and bumped by
 * `desktop_mode_posts_window_terms_cache_invalidate()` whenever a
 * post/term change could move the derived data. The version is
 * baked into every transient cache key, so a single
 * `update_option()` retires the entire family of cached payloads
 * in one stroke — no enumerating keys, no race window where an
 * old entry might still be served. Stale entries fall out of the
 * DB naturally via the transient TTL.
 */
function desktop_mode_posts_window_terms_cache_version() {
	$v = (int) get_option( 'desktop_mode_terms_cache_version', 0 );
	if ( $v <= 0 ) {
		$v = 1;
		// autoload = false so this doesn't ride on every page load.
		update_option( 'desktop_mode_terms_cache_version', $v, false );
	}
	return $v;
}

/**
 * Invalidate every cached terms-derived payload by incrementing
 * the shared version. The next call to any cached endpoint will
 * miss its transient lookup, recompute, and store under the new
 * key.
 *
 * Hooked to a handful of "post→term graph changed" actions below.
 * The signature is intentionally argument-tolerant — each hook
 * passes different positional args (object_id, term_id, taxonomy,
 * …) and PHP just ignores extras for a no-param target.
 */
function desktop_mode_posts_window_terms_cache_invalidate() {
	$v = desktop_mode_posts_window_terms_cache_version();
	update_option(
		'desktop_mode_terms_cache_version',
		$v + 1,
		false
	);
}
// Direct post→term graph changes. `set_object_terms` fires whenever
// `wp_set_object_terms()` runs — covers post saves that change
// terms, term-delete cleanup, REST PATCH on a post's tags array,
// classic-editor flows, the lot. It's the ground truth.
add_action( 'set_object_terms', 'desktop_mode_posts_window_terms_cache_invalidate' );
// Term identity changes — a renamed term doesn't shift pair counts
// but a deleted term does (its relationships go away). Invalidating
// on every term mutation costs one option write per edit, which is
// fine for the typical category/tag edit cadence.
add_action( 'created_term', 'desktop_mode_posts_window_terms_cache_invalidate' );
add_action( 'edited_term', 'desktop_mode_posts_window_terms_cache_invalidate' );
add_action( 'delete_term', 'desktop_mode_posts_window_terms_cache_invalidate' );
// Status flips that change what the SQL counts. Both endpoints
// exclude 'trash', 'auto-draft', and 'inherit'; trashing or
// restoring a post adds and removes counts/pairs from the graph.
add_action( 'wp_trash_post', 'desktop_mode_posts_window_terms_cache_invalidate' );
add_action( 'untrashed_post', 'desktop_mode_posts_window_terms_cache_invalidate' );
// Pre-delete fires while term_relationships still exist; the row
// will be gone by the time the next query runs. Belt-and-braces
// alongside set_object_terms (which fires during delete cleanup
// on most modern WP versions).
add_action( 'before_delete_post', 'desktop_mode_posts_window_terms_cache_invalidate' );

/**
 * Bulk count endpoint — returns `{ term_id: count }` for every
 * requested term in one query. The `desktop_mode_count` REST field
 * (per-term) is the canonical source, but on installs where the
 * field isn't reaching the response (caching, REST middleware,
 * stale `_fields` whitelist) the JS calls this endpoint as a
 * defensive fallback so node labels never silently show 0.
 *
 * Cached: a single transient holds `{ term_id: count }` for EVERY
 * term in the taxonomy. Each call projects the caller's requested
 * IDs out of that map, so all clients hit the same cache entry
 * regardless of which subset they ask for.
 *
 * GET `/desktop-mode/v1/term-counts?taxonomy=category&ids=1,4,7`
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

	// Cache strategy: one transient holds the FULL taxonomy's
	// { term_id => count } map. All clients project their requested
	// ID subset out of the same cached map, so a window that asks
	// for IDs [1, 4, 7] and one that asks for [4, 11, 22] share the
	// same cache hit. Key shape: `dmtcnt_v<version>_<taxonomy>`.
	$cache_version = desktop_mode_posts_window_terms_cache_version();
	$cache_key     = sprintf( 'dmtcnt_v%d_%s', $cache_version, $taxonomy );
	$counts        = get_transient( $cache_key );
	if ( ! is_array( $counts ) ) {
		// Mirror WP core's `_update_post_term_count` filtering —
		// limit to the taxonomy's `object_type` (e.g. `post` for
		// category) and exclude statuses core treats as non-counting:
		//   - 'trash' + 'auto-draft' → user-not-published-and-never-will-be
		//   - 'inherit' → attachment-only status; excluded so attachments
		//                 aren't double-counted via parent inheritance
		// Everything else (publish, draft, pending, future, private)
		// is included so the user sees a "real" post count, not
		// WP's publish-only term_taxonomy.count.
		$object_types = array_map(
			'sanitize_key',
			(array) $tax_obj->object_type
		);
		$object_types = array_filter( $object_types, 'post_type_exists' );
		if ( empty( $object_types ) ) {
			$object_types = array( 'post' );
		}
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
				 GROUP BY tt.term_id",
				array_merge( $object_types, array( $taxonomy ) )
			),
			ARRAY_A
		);
		$counts = array();
		foreach ( (array) $rows as $row ) {
			$counts[ (string) (int) $row['term_id'] ] = (int) $row['cnt'];
		}
		set_transient( $cache_key, $counts, DAY_IN_SECONDS );
	}

	// Project the caller's requested IDs out of the (cached or
	// fresh) full map. Missing IDs return 0 to match the legacy
	// shape — a caller looking up a term that no longer exists or
	// has no associated posts still gets a zero, not a missing key.
	$out = array();
	foreach ( $ids as $id ) {
		$key         = (string) $id;
		$out[ $key ] = isset( $counts[ $key ] ) ? (int) $counts[ $key ] : 0;
	}
	return $out;
}

/**
 * REST: tag co-occurrence aggregator. Returns, for each tag, its
 * top-N most frequently co-occurring sibling tags + the shared
 * post count. Used by the Tags window to precluster the pixi
 * cloud — tags that appear together on the same post get pulled
 * toward each other after the spiral pack.
 *
 * GET `/desktop-mode/v1/tag-cooccurrence?taxonomy=post_tag&limit=8`
 *
 * Response:
 *   { "pairs": { "<tagId>": [ { "id": <neighborId>, "shared": N }, … ] } }
 *
 * Status filtering mirrors `_update_post_term_count` (exclude
 * trash, auto-draft, inherit). Post type is bounded to the
 * taxonomy's declared `object_type` so e.g. page-attached terms
 * don't bleed into the post-tag graph.
 */
function desktop_mode_posts_window_register_tag_cooccurrence_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/tag-cooccurrence',
		array(
			'methods'             => 'GET',
			'callback'            => 'desktop_mode_posts_window_tag_cooccurrence_callback',
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
			'args'                => array(
				'taxonomy' => array(
					'required'          => false,
					'type'              => 'string',
					'default'           => 'post_tag',
					'sanitize_callback' => 'sanitize_key',
				),
				'limit'    => array(
					'required' => false,
					'type'     => 'integer',
					'default'  => 8,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_posts_window_register_tag_cooccurrence_route' );

function desktop_mode_posts_window_tag_cooccurrence_callback( $request ) {
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

	$limit = (int) $request->get_param( 'limit' );
	if ( $limit <= 0 ) {
		$limit = 8;
	}
	// Cap so a malicious caller can't fan out the response. 24 is
	// far more neighbors than any layout pass actually consumes.
	$limit = min( 24, $limit );

	// Cache lookup. The key bakes in the current version so a single
	// option bump makes every old entry unreachable without us
	// having to enumerate keys. Taxonomy + limit are part of the key
	// because they change the response shape.
	$cache_version = desktop_mode_posts_window_terms_cache_version();
	$cache_key     = sprintf(
		'dmwco_v%d_%s_l%d',
		$cache_version,
		$taxonomy,
		$limit
	);
	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) && isset( $cached['pairs'] ) ) {
		return rest_ensure_response( $cached );
	}

	$object_types = array_map(
		'sanitize_key',
		(array) $tax_obj->object_type
	);
	$object_types = array_filter( $object_types, 'post_type_exists' );
	if ( empty( $object_types ) ) {
		$object_types = array( 'post' );
	}
	$type_placeholders = implode( ',', array_fill( 0, count( $object_types ), '%s' ) );

	// One scan: every (post, term) row in the taxonomy on a
	// non-trashed, non-attachment-inherited post of the right type.
	// Sorted by post so we can walk in O(n) and emit pairs per post.
	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT tr.object_id, tt.term_id
			 FROM {$wpdb->term_relationships} tr
			 INNER JOIN {$wpdb->term_taxonomy} tt
			   ON tr.term_taxonomy_id = tt.term_taxonomy_id
			 INNER JOIN {$wpdb->posts} p
			   ON p.ID = tr.object_id
			   AND p.post_status NOT IN ( 'trash', 'auto-draft', 'inherit' )
			   AND p.post_type IN ( $type_placeholders )
			 WHERE tt.taxonomy = %s
			 ORDER BY tr.object_id",
			array_merge( $object_types, array( $taxonomy ) )
		),
		ARRAY_A
	);

	// Group term ids per post, then emit pair counts. Sort each
	// post's term list so we can walk i<j and double-write into the
	// symmetric pair map (a→b and b→a both get incremented).
	$pairs       = array(); // term_id => array( neighbor_id => shared_count )
	$current_id  = 0;
	$current_set = array();
	$flush = function () use ( &$current_set, &$pairs ) {
		$ids = array_values( array_unique( $current_set ) );
		$n   = count( $ids );
		if ( $n < 2 ) {
			return;
		}
		sort( $ids, SORT_NUMERIC );
		for ( $i = 0; $i < $n; $i++ ) {
			$a = $ids[ $i ];
			for ( $j = $i + 1; $j < $n; $j++ ) {
				$b = $ids[ $j ];
				if ( ! isset( $pairs[ $a ][ $b ] ) ) {
					$pairs[ $a ][ $b ] = 0;
				}
				if ( ! isset( $pairs[ $b ][ $a ] ) ) {
					$pairs[ $b ][ $a ] = 0;
				}
				$pairs[ $a ][ $b ]++;
				$pairs[ $b ][ $a ]++;
			}
		}
	};
	foreach ( (array) $rows as $row ) {
		$post_id = (int) $row['object_id'];
		$term_id = (int) $row['term_id'];
		if ( $post_id !== $current_id ) {
			$flush();
			$current_id  = $post_id;
			$current_set = array();
		}
		$current_set[] = $term_id;
	}
	$flush();

	// Trim each tag's neighbor list to top-N by shared count, then
	// reshape into the response payload. Keep string keys so JSON
	// preserves them as numeric-looking object properties.
	$result = array();
	foreach ( $pairs as $tag_id => $neighbors ) {
		arsort( $neighbors, SORT_NUMERIC );
		$top  = array_slice( $neighbors, 0, $limit, true );
		$list = array();
		foreach ( $top as $neighbor_id => $shared ) {
			$list[] = array(
				'id'     => (int) $neighbor_id,
				'shared' => (int) $shared,
			);
		}
		$result[ (string) (int) $tag_id ] = $list;
	}

	$payload = array( 'pairs' => $result );
	// Store under the version-stamped key. TTL is a day; an
	// invalidation hook bump retires the key sooner. The DAY ceiling
	// is the floor on cache staleness if every invalidation hook
	// somehow missed firing.
	set_transient( $cache_key, $payload, DAY_IN_SECONDS );

	return rest_ensure_response( $payload );
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
