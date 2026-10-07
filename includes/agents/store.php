<?php

defined( 'ABSPATH' ) || exit;

require_once OPENSTATION_DIR . 'includes/agents/guard.php';

const OPENSTATION_AGENT_DESCRIPTION_META = '_desktop_mode_agent_description';

const OPENSTATION_AGENT_INSTRUCTIONS_META = '_desktop_mode_agent_instructions';

const OPENSTATION_AGENT_ABILITIES_META = '_desktop_mode_agent_abilities';

const OPENSTATION_AGENT_TRIGGERS_META = '_desktop_mode_agent_triggers';

const OPENSTATION_AGENT_MODEL_META = '_desktop_mode_agent_model';

const OPENSTATION_AGENT_RATE_LIMIT_META = '_desktop_mode_agent_rate_limit';

const OPENSTATION_AGENT_CREATED_BY_META = '_desktop_mode_agent_created_by';

const OPENSTATION_AGENT_VIBES_META = '_desktop_mode_agent_vibes';

const OPENSTATION_AGENT_VIBES_MAX_LENGTH = 120;

const OPENSTATION_AGENT_FACE_META = '_desktop_mode_agent_face';

const OPENSTATION_AGENT_FACE_SEED_META = '_desktop_mode_agent_face_seed';

function openstation_agent_meta_keys() {
	return array(
		OPENSTATION_AGENT_USER_MARKER_META,
		OPENSTATION_AGENT_DESCRIPTION_META,
		OPENSTATION_AGENT_INSTRUCTIONS_META,
		OPENSTATION_AGENT_ABILITIES_META,
		OPENSTATION_AGENT_TRIGGERS_META,
		OPENSTATION_AGENT_MODEL_META,
		OPENSTATION_AGENT_RATE_LIMIT_META,
		OPENSTATION_AGENT_CREATED_BY_META,
		OPENSTATION_AGENT_VIBES_META,
		OPENSTATION_AGENT_FACE_META,
		OPENSTATION_AGENT_FACE_SEED_META,
	);
}

function openstation_agents_register_user_meta() {
	$auth = static function () {
		return current_user_can( 'edit_users' );
	};

	register_meta(
		'user',
		OPENSTATION_AGENT_DESCRIPTION_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'sanitize_text_field',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_INSTRUCTIONS_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'wp_kses_post',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_ABILITIES_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'openstation_agent_sanitize_abilities_json',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_TRIGGERS_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'openstation_agent_sanitize_triggers_json',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_MODEL_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'sanitize_text_field',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_RATE_LIMIT_META,
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => false,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_VIBES_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'openstation_agent_sanitize_vibes',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_FACE_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'openstation_agent_sanitize_face_json',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		OPENSTATION_AGENT_FACE_SEED_META,
		array(
			'type'              => 'integer',
			'single'            => true,
			'default'           => 0,
			'show_in_rest'      => false,
			'sanitize_callback' => 'absint',
			'auth_callback'     => $auth,
		)
	);
}
add_action( 'init', 'openstation_agents_register_user_meta' );

function openstation_agents_sanitize_ability_slugs( $value ) {
	if ( is_string( $value ) ) {
		$decoded = json_decode( $value, true );
		$value   = is_array( $decoded ) ? $decoded : array();
	}
	if ( ! is_array( $value ) ) {
		return array();
	}
	$out = array();
	foreach ( $value as $slug ) {
		if ( ! is_string( $slug ) ) {
			continue;
		}
		$clean = sanitize_text_field( $slug );
		if ( '' === $clean ) {
			continue;
		}
		$out[] = $clean;
	}
	return array_values( array_unique( $out ) );
}

function openstation_agent_sanitize_abilities_json( $value ) {
	return (string) wp_json_encode( openstation_agents_sanitize_ability_slugs( $value ) );
}

function openstation_agent_sanitize_vibes( $value ) {
	if ( ! is_scalar( $value ) ) {
		return '';
	}
	$clean = sanitize_text_field( (string) $value );
	return mb_substr( $clean, 0, OPENSTATION_AGENT_VIBES_MAX_LENGTH );
}

function openstation_agent_sanitize_face_json( $value ) {
	if ( is_string( $value ) ) {
		$decoded = json_decode( $value, true );
		$value   = is_array( $decoded ) ? $decoded : array();
	}
	$out = openstation_mio_narrow_look( $value );
	if ( empty( $out['appearance'] ) && empty( $out['physics'] ) ) {
		return '';
	}
	return (string) wp_json_encode( $out );
}

function openstation_agent_get_vibes( $user_id ) {
	return (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_VIBES_META, true );
}

function openstation_agent_get_face( $user_id ) {
	$raw = (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_FACE_META, true );
	if ( '' === $raw ) {
		return array(
			'appearance' => array(),
			'physics'    => array(),
		);
	}
	return openstation_sanitize_mio_look( json_decode( $raw, true ) );
}

function openstation_agent_get_face_seed( $user_id ) {
	return (int) get_user_meta( (int) $user_id, OPENSTATION_AGENT_FACE_SEED_META, true );
}

function openstation_agent_sanitize_triggers( $value ) {
	if ( is_string( $value ) ) {
		$decoded = json_decode( $value, true );
		$value   = is_array( $decoded ) ? $decoded : array();
	}
	if ( ! is_array( $value ) ) {
		return array();
	}

	$known_kinds = array();
	foreach ( openstation_agent_trigger_kinds() as $kind ) {
		$known_kinds[ $kind['slug'] ] = $kind;
	}

	$out = array();
	foreach ( $value as $row ) {
		if ( ! is_array( $row ) ) {
			continue;
		}
		$kind = isset( $row['kind'] ) ? sanitize_key( $row['kind'] ) : '';
		if ( '' === $kind || ! isset( $known_kinds[ $kind ] ) ) {
			continue;
		}

		$config = isset( $row['config'] ) && is_array( $row['config'] ) ? $row['config'] : array();
		$config = openstation_agent_sanitize_trigger_config_deep( $config );

		$out[] = array(
			'kind'   => $kind,
			'config' => $config,
		);
	}

	return $out;
}

function openstation_agent_sanitize_triggers_json( $value ) {
	return (string) wp_json_encode( openstation_agent_sanitize_triggers( $value ) );
}

function openstation_agent_sanitize_trigger_config_deep( $value ) {
	if ( is_array( $value ) ) {
		$out = array();
		foreach ( $value as $k => $v ) {
			if ( is_string( $k ) ) {
				$key = preg_replace( '/[^A-Za-z0-9_\-]/', '', $k );
				if ( '' === $key ) {
					continue;
				}
			} else {
				$key = (int) $k;
			}
			$out[ $key ] = openstation_agent_sanitize_trigger_config_deep( $v );
		}
		return $out;
	}
	if ( is_bool( $value ) || is_int( $value ) ) {
		return $value;
	}
	if ( is_numeric( $value ) ) {
		return $value + 0;
	}
	if ( is_string( $value ) ) {
		return sanitize_text_field( $value );
	}
	return null;
}

function openstation_agent_trigger_kinds() {
	$kinds = array(
		array(
			'slug'          => 'chat',
			'wired'         => true,
			'label'         => __( 'Chat', 'desktop-mode' ),
			'description'   => __( 'Open a conversation window with the agent.', 'desktop-mode' ),
			'icon'          => 'dashicons-format-chat',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'capability' => array( 'type' => 'string' ),
				),
			),
		),
		array(
			'slug'          => 'send-to',
			'wired'         => true,
			'label'         => __( 'Send to (right-click menu)', 'desktop-mode' ),
			'description'   => __( 'The agent appears as a "Send to…" action in the right-click menu for the entity kinds you pick.', 'desktop-mode' ),
			'icon'          => 'dashicons-share-alt',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'entityKinds' => array(
						'type'  => 'array',
						'items' => array(
							'type' => 'string',
							'enum' => array( 'post', 'page', 'media', 'user', 'comment' ),
						),
					),
				),
			),
		),
		array(
			'slug'          => 'drag',
			'wired'         => true,
			'label'         => __( 'Drag & drop', 'desktop-mode' ),
			'description'   => __( 'Drop a tile onto the agent.', 'desktop-mode' ),
			'icon'          => 'dashicons-move',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'mimeTypes'   => array(
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
					'entityKinds' => array(
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
				),
			),
		),
		array(
			'slug'          => 'hook',
			'wired'         => false,
			'label'         => __( 'WordPress hook', 'desktop-mode' ),
			'description'   => __( 'Run automatically when a WordPress action fires.', 'desktop-mode' ),
			'icon'          => 'dashicons-admin-plugins',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'hook'     => array( 'type' => 'string' ),
					'priority' => array( 'type' => 'integer' ),
				),
				'required'   => array( 'hook' ),
			),
		),
		array(
			'slug'          => 'endpoint',
			'wired'         => false,
			'label'         => __( 'REST endpoint', 'desktop-mode' ),
			'description'   => __( 'Expose a REST URL for external services to call.', 'desktop-mode' ),
			'icon'          => 'dashicons-rest-api',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'auth'       => array(
						'type' => 'string',
						'enum' => array( 'capability', 'application-password' ),
					),
					'capability' => array( 'type' => 'string' ),
				),
			),
		),
		array(
			'slug'          => 'agent',
			'wired'         => false,
			'label'         => __( 'Agent-to-agent', 'desktop-mode' ),
			'description'   => __( 'Run when another agent on this site emits a completion event.', 'desktop-mode' ),
			'icon'          => 'dashicons-networking',
			'config_schema' => array(
				'type'       => 'object',
				'properties' => array(
					'fromAgents' => array(
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
				),
			),
		),
	);

	$filtered = apply_filters( 'openstation_agent_trigger_kinds', $kinds );
	if ( ! is_array( $filtered ) ) {
		return $kinds;
	}
	return array_values( $filtered );
}

function openstation_agent_hooks_catalogue() {
	$hooks = array(
		array(
			'hook' => 'save_post',
			'when' => __( 'Every time a post is saved.', 'desktop-mode' ),
		),
		array(
			'hook' => 'wp_insert_post',
			'when' => __( 'A new post is inserted.', 'desktop-mode' ),
		),
		array(
			'hook' => 'transition_post_status',
			'when' => __( 'A post status changes.', 'desktop-mode' ),
		),
		array(
			'hook' => 'wp_insert_comment',
			'when' => __( 'A new comment is inserted.', 'desktop-mode' ),
		),
		array(
			'hook' => 'comment_post',
			'when' => __( 'A new comment is posted.', 'desktop-mode' ),
		),
		array(
			'hook' => 'user_register',
			'when' => __( 'A new user registers.', 'desktop-mode' ),
		),
		array(
			'hook' => 'profile_update',
			'when' => __( 'A user profile is updated.', 'desktop-mode' ),
		),
		array(
			'hook' => 'add_attachment',
			'when' => __( 'A new attachment is added.', 'desktop-mode' ),
		),
	);

	$filtered = apply_filters( 'openstation_agent_hooks_catalogue', $hooks );
	return is_array( $filtered ) ? array_values( $filtered ) : $hooks;
}

function openstation_agent_actor_can_assign_role( $role ) {
	$role = sanitize_key( (string) $role );
	$can  = current_user_can( 'promote_users' );

	if ( $can && 'administrator' === $role ) {
		$can = is_multisite()
			? is_super_admin()
			: ( current_user_can( 'manage_options' ) && current_user_can( 'create_users' ) );
	}

	return (bool) apply_filters(
		'openstation_agent_actor_can_assign_role',
		$can,
		$role,
		get_current_user_id()
	);
}

function openstation_agent_allowed_roles() {
	$whitelist = array( 'administrator', 'editor', 'author', 'contributor' );

	$whitelist = apply_filters( 'openstation_agent_allowed_roles', $whitelist );
	if ( ! is_array( $whitelist ) ) {
		return array();
	}

	if ( ! function_exists( 'get_editable_roles' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}
	$editable = array_keys( get_editable_roles() );

	$candidates = array_intersect( array_map( 'strval', $whitelist ), $editable );

	$allowed = array();
	foreach ( $candidates as $role ) {
		if ( openstation_agent_actor_can_assign_role( $role ) ) {
			$allowed[] = $role;
		}
	}

	return array_values( $allowed );
}

function openstation_agent_get_description( $user_id ) {
	return (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_DESCRIPTION_META, true );
}

function openstation_agent_get_instructions( $user_id ) {
	return (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_INSTRUCTIONS_META, true );
}

function openstation_agent_get_abilities( $user_id ) {
	$raw = get_user_meta( (int) $user_id, OPENSTATION_AGENT_ABILITIES_META, true );
	if ( '' === $raw || null === $raw ) {
		return array();
	}
	return openstation_agents_sanitize_ability_slugs( $raw );
}

function openstation_agent_get_triggers( $user_id ) {
	$raw = get_user_meta( (int) $user_id, OPENSTATION_AGENT_TRIGGERS_META, true );
	if ( '' === $raw || null === $raw ) {
		return array();
	}
	return openstation_agent_sanitize_triggers( $raw );
}

function openstation_agent_get_model( $user_id ) {
	return (string) get_user_meta( (int) $user_id, OPENSTATION_AGENT_MODEL_META, true );
}

function openstation_agent_get_rate_limit( $user_id ) {
	return (int) get_user_meta( (int) $user_id, OPENSTATION_AGENT_RATE_LIMIT_META, true );
}

function openstation_agent_trigger_for_source( $agent_user_id, $source ) {
	$source = sanitize_key( (string) $source );
	foreach ( openstation_agent_get_triggers( (int) $agent_user_id ) as $trigger ) {
		if ( isset( $trigger['kind'] ) && $source === $trigger['kind'] ) {
			return $trigger;
		}
	}
	return null;
}

function openstation_agent_user_can_invoke_agent( $agent_user_id, $source = 'chat' ) {
	$can = true;
	foreach ( openstation_agent_get_triggers( (int) $agent_user_id ) as $row ) {
		if ( ! isset( $row['config']['capability'] ) || ! is_scalar( $row['config']['capability'] ) ) {
			continue;
		}
		$capability = trim( (string) $row['config']['capability'] );
		if ( '' !== $capability && ! current_user_can( $capability ) ) {
			$can = false;
			break;
		}
	}

	return (bool) apply_filters(
		'openstation_agent_user_can_invoke_agent',
		$can,
		(int) $agent_user_id,
		(string) $source,
		openstation_agent_trigger_for_source( $agent_user_id, $source )
	);
}

function openstation_agent_get_agents( $args = array() ) {
	$defaults = array(
		'meta_key'   => OPENSTATION_AGENT_USER_MARKER_META,
		'meta_value' => '1',
		'orderby'    => 'display_name',
		'order'      => 'ASC',
		'number'     => 200,
	);
	return get_users( array_merge( $defaults, is_array( $args ) ? $args : array() ) );
}

function openstation_agent_create( $args ) {
	$role    = isset( $args['role'] ) ? sanitize_key( (string) $args['role'] ) : '';
	$allowed = openstation_agent_allowed_roles();
	if ( '' === $role || ! in_array( $role, $allowed, true ) ) {
		return new WP_Error(
			'openstation_agent_invalid_role',
			__( 'Pick a role you are allowed to assign to an agent.', 'desktop-mode' )
		);
	}

	$user = openstation_agent_create_user( $args );
	if ( is_wp_error( $user ) ) {
		return $user;
	}

	$description  = isset( $args['description'] ) ? sanitize_text_field( (string) $args['description'] ) : '';
	$instructions = isset( $args['instructions'] ) ? wp_kses_post( (string) $args['instructions'] ) : '';
	$abilities    = isset( $args['abilities'] ) ? openstation_agents_sanitize_ability_slugs( $args['abilities'] ) : array();
	$triggers     = isset( $args['triggers'] ) ? openstation_agent_sanitize_triggers( $args['triggers'] ) : array();
	$vibes        = isset( $args['vibes'] ) ? openstation_agent_sanitize_vibes( $args['vibes'] ) : '';
	$face         = isset( $args['face'] ) ? openstation_agent_sanitize_face_json( $args['face'] ) : '';

	$seed = isset( $args['faceSeed'] ) ? absint( $args['faceSeed'] ) : 0;
	if ( 0 === $seed ) {
		$seed = crc32( (string) $user->user_login );
	}

	if ( '' !== $description ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_DESCRIPTION_META, $description );
	}
	if ( '' !== $instructions ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_INSTRUCTIONS_META, $instructions );
	}
	if ( ! empty( $abilities ) ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_ABILITIES_META, wp_json_encode( $abilities ) );
	}
	if ( ! empty( $triggers ) ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_TRIGGERS_META, wp_json_encode( $triggers ) );
	}
	if ( '' !== $vibes ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_VIBES_META, $vibes );
	}
	if ( '' !== $face ) {
		update_user_meta( $user->ID, OPENSTATION_AGENT_FACE_META, $face );
	}
	update_user_meta( $user->ID, OPENSTATION_AGENT_FACE_SEED_META, $seed );
	update_user_meta( $user->ID, OPENSTATION_AGENT_CREATED_BY_META, get_current_user_id() );

	do_action(
		'openstation_agent_created',
		(int) $user->ID,
		array(
			'name'         => (string) $user->display_name,
			'role'         => $role,
			'description'  => $description,
			'instructions' => $instructions,
			'abilities'    => $abilities,
			'vibes'        => $vibes,
			'face'         => $face,
			'faceSeed'     => $seed,
		),
		get_current_user_id()
	);

	return $user;
}

function openstation_agent_update( $user_id, array $fields ) {
	$user = get_userdata( (int) $user_id );
	if ( ! $user || ! openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agent_not_found',
			__( 'Agent not found.', 'desktop-mode' )
		);
	}

	$changed = array();

	if ( isset( $fields['name'] ) ) {
		$name = sanitize_text_field( (string) $fields['name'] );
		if ( '' === $name ) {
			return new WP_Error(
				'openstation_agent_invalid_name',
				__( 'Agent name cannot be empty.', 'desktop-mode' )
			);
		}

		if ( openstation_plain_text_title( $name ) !== openstation_plain_text_title( $user->display_name ) ) {
			$changed['name'] = array(
				'from' => (string) $user->display_name,
				'to'   => $name,
			);
			wp_update_user(
				array(
					'ID'           => (int) $user->ID,
					'display_name' => $name,
					'nickname'     => $name,
				)
			);
		}
	}

	if ( isset( $fields['role'] ) ) {
		$role = sanitize_key( (string) $fields['role'] );
		if ( ! in_array( $role, openstation_agent_allowed_roles(), true ) ) {
			return new WP_Error(
				'openstation_agent_invalid_role',
				__( 'Pick a role you are allowed to assign to an agent.', 'desktop-mode' )
			);
		}
		$current_role = is_array( $user->roles ) && ! empty( $user->roles ) ? (string) reset( $user->roles ) : '';
		if ( $role !== $current_role ) {
			$changed['role'] = array(
				'from' => $current_role,
				'to'   => $role,
			);
			$user->set_role( $role );
		}
	}

	if ( isset( $fields['description'] ) ) {
		$description = sanitize_text_field( (string) $fields['description'] );
		$before      = openstation_agent_get_description( $user->ID );
		if ( $description !== $before ) {
			$changed['description'] = array(
				'from' => $before,
				'to'   => $description,
			);
			update_user_meta( $user->ID, OPENSTATION_AGENT_DESCRIPTION_META, $description );
		}
	}

	if ( isset( $fields['instructions'] ) ) {
		$instructions = wp_kses_post( (string) $fields['instructions'] );
		$before       = openstation_agent_get_instructions( $user->ID );
		if ( $instructions !== $before ) {
			$changed['instructions'] = array(
				'from' => $before,
				'to'   => $instructions,
			);
			update_user_meta( $user->ID, OPENSTATION_AGENT_INSTRUCTIONS_META, $instructions );
		}
	}

	if ( isset( $fields['abilities'] ) ) {
		$abilities = openstation_agents_sanitize_ability_slugs( $fields['abilities'] );
		$before    = openstation_agent_get_abilities( $user->ID );
		if ( $abilities !== $before ) {
			$changed['abilities'] = array(
				'from' => $before,
				'to'   => $abilities,
			);
			update_user_meta( $user->ID, OPENSTATION_AGENT_ABILITIES_META, wp_json_encode( $abilities ) );
		}
	}

	if ( isset( $fields['triggers'] ) ) {
		$triggers = openstation_agent_sanitize_triggers( $fields['triggers'] );
		$before   = openstation_agent_get_triggers( $user->ID );
		if ( $triggers !== $before ) {
			$changed['triggers'] = array(
				'from' => $before,
				'to'   => $triggers,
			);
			update_user_meta( $user->ID, OPENSTATION_AGENT_TRIGGERS_META, wp_json_encode( $triggers ) );
		}
	}

	if ( isset( $fields['model'] ) ) {
		$model  = sanitize_text_field( (string) $fields['model'] );
		$before = openstation_agent_get_model( $user->ID );
		if ( $model !== $before ) {
			$changed['model'] = array(
				'from' => $before,
				'to'   => $model,
			);
			if ( '' === $model ) {
				delete_user_meta( $user->ID, OPENSTATION_AGENT_MODEL_META );
			} else {
				update_user_meta( $user->ID, OPENSTATION_AGENT_MODEL_META, $model );
			}
		}
	}

	if ( isset( $fields['rateLimit'] ) ) {
		$rate   = max( 0, (int) $fields['rateLimit'] );
		$before = openstation_agent_get_rate_limit( $user->ID );
		if ( $rate !== $before ) {
			$changed['rateLimit'] = array(
				'from' => $before,
				'to'   => $rate,
			);
			if ( 0 === $rate ) {
				delete_user_meta( $user->ID, OPENSTATION_AGENT_RATE_LIMIT_META );
			} else {
				update_user_meta( $user->ID, OPENSTATION_AGENT_RATE_LIMIT_META, $rate );
			}
		}
	}

	if ( isset( $fields['vibes'] ) ) {
		$vibes  = openstation_agent_sanitize_vibes( $fields['vibes'] );
		$before = openstation_agent_get_vibes( $user->ID );
		if ( $vibes !== $before ) {
			$changed['vibes'] = array(
				'from' => $before,
				'to'   => $vibes,
			);
			if ( '' === $vibes ) {
				delete_user_meta( $user->ID, OPENSTATION_AGENT_VIBES_META );
			} else {
				update_user_meta( $user->ID, OPENSTATION_AGENT_VIBES_META, $vibes );
			}
		}
	}

	if ( isset( $fields['face'] ) ) {
		$face   = openstation_agent_sanitize_face_json( $fields['face'] );
		$before = (string) get_user_meta( $user->ID, OPENSTATION_AGENT_FACE_META, true );
		if ( $face !== $before ) {
			$changed['face'] = array(
				'from' => $before,
				'to'   => $face,
			);
			if ( '' === $face ) {
				delete_user_meta( $user->ID, OPENSTATION_AGENT_FACE_META );
			} else {
				update_user_meta( $user->ID, OPENSTATION_AGENT_FACE_META, $face );
			}
		}
	}

	if ( isset( $fields['faceSeed'] ) ) {
		$seed   = absint( $fields['faceSeed'] );
		$before = openstation_agent_get_face_seed( $user->ID );
		if ( $seed !== $before ) {
			$changed['faceSeed'] = array(
				'from' => $before,
				'to'   => $seed,
			);
			update_user_meta( $user->ID, OPENSTATION_AGENT_FACE_SEED_META, $seed );
		}
	}

	if ( ! empty( $changed ) ) {

		do_action( 'openstation_agent_updated', (int) $user->ID, $changed, get_current_user_id() );
	}

	return true;
}
