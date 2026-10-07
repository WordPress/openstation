<?php

defined( 'ABSPATH' ) || exit;

function openstation_content_graph_icon_svg() {
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'

		. '<path d="M14 16 32 32 52 18M32 32 40 49" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'

		. '<circle cx="32" cy="32" r="9" fill="currentColor"/>'

		. '<circle cx="14" cy="16" r="5.5" fill="currentColor"/>'
		. '<circle cx="52" cy="18" r="5.5" fill="currentColor"/>'
		. '<circle cx="40" cy="49" r="5" fill="currentColor"/>'
		. '</svg>';
}

function openstation_content_graph_user_can_use() {
	$can = current_user_can( 'edit_posts' );

	return (bool) apply_filters( 'openstation_content_graph_user_can_use', $can );
}

function openstation_content_graph_post_types() {
	$types  = get_post_types( array( 'public' => true ), 'objects' );
	$result = array();
	foreach ( $types as $type ) {

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

	$filtered = (string) apply_filters( 'openstation_content_graph_template_html', $html );

	$allowed_html = function_exists( 'openstation_native_window_allowed_html' )
		? openstation_native_window_allowed_html()
		: wp_kses_allowed_html( 'post' );

	echo wp_kses( $filtered, $allowed_html );
}

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

			'siteName'       => openstation_site_title(),
			'postTypes'      => openstation_content_graph_post_types(),
		),
	);

	$window_args = (array) apply_filters( 'openstation_content_graph_window_args', $window_args );

	$registered = openstation_register_window( 'desktop-mode-content-graph', $window_args );
	if ( is_wp_error( $registered ) ) {

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

	$icon_args = (array) apply_filters( 'openstation_content_graph_icon_args', $icon_args );

	openstation_register_icon( 'desktop-mode-content-graph', $icon_args );
}
add_action( 'init', 'openstation_content_graph_register_window', 20 );
