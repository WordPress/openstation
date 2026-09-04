<?php
/**
 * Pages app — the Pages-specific server surface: the default REST
 * query args, the page-template label map and the
 * `openstation_comment_count` REST field on `page`.
 *
 * Plain PHP part of `apps/pages/pages.os.php`. The list machinery
 * itself (query builder, data envelope, actions) is the Posts app's
 * `apps/posts/parts/query.php`, which the entry requires too.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

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
		// field feed the Slug / Template / Comments columns and the
		// public-URL "View" quick-action. Missing them from the
		// whitelist costs nothing on the wire but silently breaks the
		// column — keep them here.
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
 * The Pages app's `ctx.extra`: the shared list facts under the pages
 * mode, plus the reading-page assignments (the title cell paints the
 * "Front page" / "Posts page" badges on matching rows; `0` when
 * unset) and the page-template label map.
 *
 * @return array<string,mixed>
 */
function openstation_pages_app_config() {
	$config                  = openstation_posts_app_config( 'pages', 'menu_order', 'asc' );
	$config['frontPageId']   = (int) get_option( 'page_on_front', 0 );
	$config['postsPageId']   = (int) get_option( 'page_for_posts', 0 );
	$config['pageTemplates'] = openstation_pages_window_template_labels();
	return $config;
}

/**
 * Build the `{ slug: label }` map for the active theme's registered
 * page templates. The Template column paints friendly labels instead
 * of raw filenames.
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
 * classic Pages list without forcing the table to embed
 * `_embed=replies`, which is heavy and N+1.
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
