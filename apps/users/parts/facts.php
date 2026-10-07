<?php

defined( 'ABSPATH' ) || exit;

function openstation_users_profile_facts() {
	static $cache = array();
	$viewer_id = (int) get_current_user_id();

	if ( $viewer_id <= 0 ) {
		return array();
	}
	if ( isset( $cache[ $viewer_id ] ) ) {
		return $cache[ $viewer_id ];
	}
	$cache[ $viewer_id ] = array(
		'currentUserId'    => $viewer_id,

		'canEdit'          => current_user_can( 'edit_users' ),
		'canPromote'       => current_user_can( 'promote_users' ),
		'canCreate'        => current_user_can( 'create_users' ),
		'canDelete'        => is_multisite() ? current_user_can( 'remove_users' ) : current_user_can( 'delete_users' ),

		'canViewFootprint' => function_exists( 'openstation_my_wordpress_user_can_use' ) && openstation_my_wordpress_user_can_use(),
		'isMultisite'      => is_multisite(),

		'assignableRoles'  => openstation_users_window_role_label_map( $viewer_id ),
		'allRoles'         => openstation_users_window_all_roles_map(),
		'locales'          => openstation_users_window_locales_map(),
		'defaultRole'      => (string) get_option( 'default_role', 'subscriber' ),
		'contactMethods'   => (array) wp_get_user_contact_methods(),
		'colorSchemes'     => openstation_user_edit_window_color_schemes(),
	);
	return $cache[ $viewer_id ];
}
