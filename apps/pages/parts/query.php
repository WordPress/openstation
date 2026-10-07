<?php

defined( 'ABSPATH' ) || exit;

function openstation_pages_window_default_query_args() {
	$args = array(

		'_embed'  => 'author,wp:featuredmedia',

		'_fields' =>
			'id,title,status,date,date_gmt,modified,modified_gmt,author,parent,menu_order,slug,link,template,comment_status,excerpt,openstation_lock,openstation_comment_count,_links,_embedded',
		'orderby' => 'menu_order',
		'order'   => 'asc',
	);

	return (array) apply_filters( 'openstation_pages_window_query_args', $args );
}

function openstation_pages_app_config() {
	$config                  = openstation_posts_app_config( 'pages', 'menu_order', 'asc' );
	$config['frontPageId']   = (int) get_option( 'page_on_front', 0 );
	$config['postsPageId']   = (int) get_option( 'page_for_posts', 0 );
	$config['pageTemplates'] = openstation_pages_window_template_labels();
	return $config;
}

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

	return (array) apply_filters( 'openstation_pages_window_template_labels', $labels );
}

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
