<?php

defined( 'ABSPATH' ) || exit;

require_once OPENSTATION_DIR . 'includes/agents/guard.php';

function openstation_agent_resolve_unique_login( $slug ) {
	$base    = 'agent-' . $slug;
	$login   = $base;
	$counter = 1;
	while ( username_exists( $login ) ) {
		++$counter;
		$login = $base . '-' . $counter;
	}
	return $login;
}

function openstation_agent_synthetic_email( $slug ) {
	$host = wp_parse_url( home_url( '/' ), PHP_URL_HOST );
	if ( ! is_string( $host ) || '' === $host ) {
		$host = 'invalid.local';
	}
	$email   = $slug . '@agents.' . $host;
	$counter = 1;
	while ( email_exists( $email ) ) {
		++$counter;
		$email = $slug . '+' . $counter . '@agents.' . $host;
	}
	return $email;
}

function openstation_agent_create_user( $args ) {
	$name = isset( $args['name'] ) ? trim( (string) $args['name'] ) : '';
	$role = isset( $args['role'] ) ? sanitize_key( $args['role'] ) : '';
	$slug = isset( $args['slug'] ) ? sanitize_title( $args['slug'] ) : '';

	if ( '' === $name ) {
		return new WP_Error(
			'openstation_agent_invalid_name',
			__( 'Agent name is required.', 'desktop-mode' )
		);
	}

	$roles = wp_roles()->get_names();
	if ( '' === $role || ! isset( $roles[ $role ] ) ) {
		return new WP_Error(
			'openstation_agent_invalid_role',
			__( 'Pick a valid WordPress role for the agent.', 'desktop-mode' )
		);
	}

	if ( '' === $slug ) {
		$slug = sanitize_title( $name );
	}
	if ( '' === $slug ) {
		return new WP_Error(
			'openstation_agent_invalid_slug',
			__( 'Agent slug could not be derived from the name.', 'desktop-mode' )
		);
	}

	$user_id = wp_insert_user(
		array(
			'user_login'           => openstation_agent_resolve_unique_login( $slug ),
			'user_email'           => openstation_agent_synthetic_email( $slug ),
			'user_pass'            => wp_generate_password( 64, true, true ),
			'display_name'         => $name,
			'nickname'             => $name,
			'role'                 => $role,
			'show_admin_bar_front' => false,
		)
	);

	if ( is_wp_error( $user_id ) ) {
		return $user_id;
	}

	update_user_meta( $user_id, OPENSTATION_AGENT_USER_MARKER_META, '1' );

	return new WP_User( $user_id );
}

function openstation_agent_delete( $user_id, $reassign = null ) {
	if ( ! openstation_agent_is_agent( $user_id ) ) {
		return new WP_Error(
			'openstation_agent_not_an_agent',
			__( 'User is not a OpenStation agent.', 'desktop-mode' )
		);
	}

	if ( ! function_exists( 'wp_delete_user' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}

	if ( is_multisite() ) {
		if ( ! function_exists( 'wpmu_delete_user' ) ) {
			require_once ABSPATH . 'wp-admin/includes/ms.php';
		}
		if ( null !== $reassign ) {

			wp_delete_user( (int) $user_id, $reassign );
		}
		$deleted = wpmu_delete_user( (int) $user_id );
	} else {
		$deleted = wp_delete_user( (int) $user_id, $reassign );
	}
	if ( ! $deleted ) {
		return new WP_Error(
			'openstation_agent_delete_failed',
			__( 'Could not delete the agent user.', 'desktop-mode' )
		);
	}

	do_action( 'openstation_agent_deleted', (int) $user_id, get_current_user_id() );

	return true;
}

function openstation_agent_avatar( $args, $id_or_email ) {
	$user_id = 0;
	if ( is_numeric( $id_or_email ) ) {
		$user_id = (int) $id_or_email;
	} elseif ( $id_or_email instanceof WP_User ) {
		$user_id = (int) $id_or_email->ID;
	} elseif ( $id_or_email instanceof WP_Comment ) {
		$user_id = (int) $id_or_email->user_id;
	} elseif ( is_string( $id_or_email ) && is_email( $id_or_email ) ) {
		$user = get_user_by( 'email', $id_or_email );
		if ( $user ) {
			$user_id = (int) $user->ID;
		}
	}

	if ( $user_id > 0 && openstation_agent_is_agent( $user_id ) ) {
		$args['url']          = openstation_agent_avatar_url( $user_id );
		$args['found_avatar'] = true;
	}
	return $args;
}
add_filter( 'pre_get_avatar_data', 'openstation_agent_avatar', 10, 2 );

function openstation_agent_users_columns( $columns ) {
	$columns['openstation_agent_type'] = __( 'Type', 'desktop-mode' );
	return $columns;
}
add_filter( 'manage_users_columns', 'openstation_agent_users_columns' );

function openstation_agent_users_custom_column( $output, $column_name, $user_id ) {
	if ( 'openstation_agent_type' !== $column_name ) {
		return $output;
	}
	if ( openstation_agent_is_agent( $user_id ) ) {
		return '<span class="os-agent-type" aria-label="' . esc_attr__( 'OpenStation agent', 'desktop-mode' ) . '">'
			. '<span class="dashicons dashicons-superhero" aria-hidden="true"></span> '
			. esc_html__( 'Agent', 'desktop-mode' )
			. '</span>';
	}
	return '<span class="os-agent-type-human">' . esc_html__( 'Person', 'desktop-mode' ) . '</span>';
}
add_filter( 'manage_users_custom_column', 'openstation_agent_users_custom_column', 10, 3 );
