<?php

defined( 'ABSPATH' ) || exit;

function openstation_my_wordpress_register_post_type_routes() {
	if ( ! openstation_my_wordpress_user_can_use() ) {
		return;
	}

	foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
		if ( ! empty( $post_type->show_in_rest ) ) {
			continue;
		}
		if ( ! openstation_my_wordpress_post_type_is_bridged( $name ) ) {
			continue;
		}
		$controller = new OpenStation_My_WordPress_Post_Type_Controller( $name );
		$controller->register_routes();
	}
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_post_type_routes' );
