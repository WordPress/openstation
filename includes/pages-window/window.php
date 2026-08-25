<?php
/**
 * OpenStation — Native Pages Window: registration + template.
 *
 * Mirrors the structure of the Posts window (`includes/posts-window/window.php`),
 * adapted for the `page` post type:
 *   - No taxonomy tabs (pages have no Categories/Tags surface in core).
 *   - Hierarchical: surfaces a Parent column and `orderby=menu_order` default.
 *   - Same lock badge via the `openstation_lock` REST field.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Echoes the native Pages window's template body.
 *
 * Same toolbar/table/pager structure as the Posts window, minus the
 * `<os-tabs>` taxonomy tabs. The `data-os-posts-*` hooks
 * are the contract the JS bundle relies on — keep them intact (or
 * rename via the filter) when customizing the layout.
 */
function openstation_pages_window_render_template() {
	ob_start();
	?>
	<div class="desktop-mode-posts" data-os-posts-root>
		<div class="os-posts__panel">
			<header class="os-posts__toolbar" data-os-posts-toolbar>
				<div class="os-posts__toolbar-left">
					<os-segmented data-os-posts-status value=""></os-segmented>
					<os-text-field
						data-os-posts-search
						placeholder="<?php esc_attr_e( 'Search pages…', 'desktop-mode' ); ?>"
					></os-text-field>
				</div>
				<div class="os-posts__toolbar-right" data-os-posts-bulk hidden>
					<span class="os-posts__count" data-os-posts-count></span>
					<span class="os-posts__bulk-actions" data-os-posts-bulk-actions></span>
				</div>
				<div class="os-posts__toolbar-trailing">
					<span class="os-posts__toolbar-extras" data-os-posts-toolbar-extras></span>
					<os-button variant="ghost" data-os-posts-refresh title="<?php esc_attr_e( 'Refresh', 'desktop-mode' ); ?>">
						<span class="dashicons dashicons-update" aria-hidden="true"></span>
					</os-button>
					<os-button variant="primary" data-os-posts-new>
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						<?php esc_html_e( 'Add New', 'desktop-mode' ); ?>
					</os-button>
				</div>
			</header>
			<div class="os-posts__body" data-os-posts-body>
				<os-table
					data-os-posts-table
					selectable="multi"
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
					loading
				>
					<div slot="empty" class="os-posts__empty">
						<span class="dashicons dashicons-admin-page" aria-hidden="true"></span>
						<p><?php esc_html_e( 'No pages found.', 'desktop-mode' ); ?></p>
						<p class="os-posts__empty-hint">
							<?php esc_html_e( 'Try a different search or change the status filter.', 'desktop-mode' ); ?>
						</p>
					</div>
				</os-table>
			</div>
			<footer class="os-posts__pager" data-os-posts-pager>
				<div class="os-posts__pager-meta">
					<span data-os-posts-page-indicator>—</span>
				</div>
				<div class="os-posts__pager-nav">
					<os-button variant="ghost" data-os-posts-prev disabled>
						<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>
						<?php esc_html_e( 'Previous', 'desktop-mode' ); ?>
					</os-button>
					<os-button variant="ghost" data-os-posts-next disabled>
						<?php esc_html_e( 'Next', 'desktop-mode' ); ?>
						<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>
					</os-button>
					<label class="os-posts__pager-perpage">
						<?php esc_html_e( 'Per page', 'desktop-mode' ); ?>
						<select data-os-posts-per-page>
							<option value="10">10</option>
							<option value="20" selected>20</option>
							<option value="50">50</option>
							<option value="100">100</option>
						</select>
					</label>
				</div>
			</footer>
		</div>
	</div>
	<?php
	$html = (string) ob_get_clean();

	/**
	 * Filter the native Pages window's template HTML.
	 *
	 * Keep the `data-os-posts-*` hooks intact so the JS
	 * render callback can find its mount points.
	 *
	 * @param string $html Default template HTML.
	 */
	$filtered = (string) apply_filters( 'openstation_pages_window_template_html', $html );

	if ( function_exists( 'openstation_kses_native_window_template' ) ) {
		echo openstation_kses_native_window_template( $filtered ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- helper kses-escapes.
	} else {
		echo wp_kses( $filtered, wp_kses_allowed_html( 'post' ) );
	}
}

/**
 * Register the native Pages window on `init` (priority 20).
 */
function openstation_pages_window_register_window() {
	if ( ! openstation_pages_window_user_can_register() ) {
		return;
	}

	$window_args = array(
		'title'      => __( 'Pages', 'desktop-mode' ),
		'icon'       => 'dashicons-admin-page',
		'template'   => 'openstation_pages_window_render_template',
		// Both Posts and Pages share a single bundle — `index.ts`
		// registers `desktop-mode-posts` AND `desktop-mode-pages` from
		// the same module. Loading `os-posts-window` for the
		// Pages window reuses the already-cached script + style.
		'script'     => 'os-posts-window',
		'styles'     => array( 'os-posts-window' ),
		'width'      => 1100,
		'height'     => 720,
		'min_width'  => 720,
		'min_height' => 480,
		'placement'  => 'none',
		'config'     => array(
			// `mode` is the JS-side discriminator the shared bundle reads
			// to gate Pages-only behavior (parent column, no taxonomy
			// tabs). The Posts config omits this key, so the bundle
			// defaults to `'posts'` for backwards compat.
			'mode'            => 'pages',
			'restRoot'        => esc_url_raw( rest_url() ),
			'restNonce'       => wp_create_nonce( 'wp_rest' ),
			// Use the `/wp/v2/pages` collection rather than `/wp/v2/posts`
			// so core's hierarchical column shapers (parent, menu_order)
			// are surfaced without an explicit `post_type` query arg.
			'postsUrl'        => esc_url_raw( rest_url( 'wp/v2/pages' ) ),
			'editPostUrlBase' => esc_url_raw( admin_url( 'post.php' ) ),
			'newPostUrl'      => esc_url_raw( add_query_arg( 'post_type', 'page', admin_url( 'post-new.php' ) ) ),
			'usersUrl'        => esc_url_raw( rest_url( 'wp/v2/users' ) ),
			'currentUserId'   => (int) get_current_user_id(),
			'defaultPerPage'  => 20,
			'queryArgs'       => openstation_pages_window_default_query_args(),
			// Reading-page assignments — surfaced so the title cell can
			// paint "Front page" / "Posts page" badges on matching rows
			// (one of the most-asked Pages-list usability gaps in the
			// WordPress trac + community forums). `0` when unset.
			'frontPageId'     => (int) get_option( 'page_on_front', 0 ),
			'postsPageId'     => (int) get_option( 'page_for_posts', 0 ),
			// Page-template label map: `{ slug: human label }` for the
			// templates the active theme registers. Falls back to the
			// raw slug when a theme registers a template the table
			// hasn't seen — better to show "page-fullwidth.php" than to
			// hide which template is in use.
			'pageTemplates'   => openstation_pages_window_template_labels(),
		),
	);

	/**
	 * Filter the args used to register the native Pages window.
	 *
	 * @param array $window_args Args passed to `openstation_register_window()`.
	 */
	$window_args = (array) apply_filters( 'openstation_pages_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-pages', $window_args );
	if ( is_wp_error( $registered ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[openstation] Native Pages window registration failed: ' . $registered->get_error_message() );
	}
}
add_action( 'init', 'openstation_pages_window_register_window', 20 );

/**
 * Default REST query args for the Pages window.
 *
 * @return array
 */
function openstation_pages_window_default_query_args() {
	$args = array(
		// Pages are usually shallow + ordered by menu_order; embed the
		// author + featured media for the table cells.
		'_embed'  => 'author,wp:featuredmedia',
		// `slug`, `template`, `link` and the custom `openstation_comment_count`
		// field are pulled in for the new Slug / Template / Comments
		// columns and the public-URL "View" quick-action. Missing them
		// from the whitelist costs nothing on the wire (REST will skip
		// them) but does silently break the column — keep them here.
		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,parent,menu_order,slug,link,template,comment_status,excerpt,openstation_lock,openstation_comment_count,_links,_embedded',
		'orderby' => 'menu_order',
		'order'   => 'asc',
	);

	/**
	 * Filter the default outbound REST query args for the Pages window.
	 *
	 * @param array $args Default args.
	 */
	return (array) apply_filters( 'openstation_pages_window_query_args', $args );
}

/**
 * Build the `{ slug: label }` map for the active theme's registered
 * page templates. Used by the Pages window's Template column to
 * paint friendly labels instead of raw filenames.
 *
 * The "default" template (assigned when `page.template` is `''`) is
 * keyed under the empty string for parity with what core returns in
 * `/wp/v2/pages` responses.
 *
 * @return array<string,string>
 */
function openstation_pages_window_template_labels() {
	$labels = array(
		'' => __( 'Default template', 'desktop-mode' ),
	);
	if ( function_exists( 'wp_get_theme' ) ) {
		$theme = wp_get_theme();
		if ( $theme && method_exists( $theme, 'get_page_templates' ) ) {
			$registered = (array) $theme->get_page_templates( null, 'page' );
			foreach ( $registered as $slug => $label ) {
				$labels[ (string) $slug ] = (string) $label;
			}
		}
	}

	/**
	 * Filter the page-template label map handed to the Pages window.
	 *
	 * @param array<string,string> $labels Slug → human label.
	 */
	return (array) apply_filters( 'openstation_pages_window_template_labels', $labels );
}

/**
 * Register the `openstation_comment_count` REST field on `page`.
 *
 * The default `/wp/v2/pages` response doesn't include a comment
 * count — surfacing one alongside the row keeps parity with the
 * classic Pages list (where the count is a column) without forcing
 * the table to embed `_embed=replies`, which is heavy and N+1.
 *
 * Registered on `page` only for now; other CPTs can opt in by
 * cloning this `register_rest_field` call. Posts already track
 * comments via the classic admin and can be wired the same way
 * if/when the Posts window grows the column.
 */
function openstation_pages_window_register_comment_count_field() {
	register_rest_field(
		'page',
		'openstation_comment_count',
		array(
			'get_callback' => static function ( $row ) {
				$id = isset( $row['id'] ) ? (int) $row['id'] : 0;
				if ( $id <= 0 ) {
					return 0;
				}
				return (int) get_comments_number( $id );
			},
			'schema'       => array(
				'description' => __( 'Total non-trashed comments on this page.', 'desktop-mode' ),
				'type'        => 'integer',
				'context'     => array( 'view', 'embed' ),
				'readonly'    => true,
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_pages_window_register_comment_count_field' );

