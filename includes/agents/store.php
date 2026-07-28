<?php
/**
 * Desktop Mode — Agents: definition store (user meta on the agent row).
 *
 * Everything that defines an agent beyond its `wp_users` row lives as
 * user meta on that row, in one `_desktop_mode_agent_*` key family:
 *
 *   - `_desktop_mode_agent`              marker ('1') — the existence test
 *   - `_desktop_mode_agent_description`  "when to use" short text
 *   - `_desktop_mode_agent_instructions` system prompt (markdown)
 *   - `_desktop_mode_agent_abilities`    JSON array of ability slugs
 *   - `_desktop_mode_agent_triggers`     JSON array of { kind, config }
 *   - `_desktop_mode_agent_model`        model override (unused by the
 *                                        runner until the Core AI Client
 *                                        exposes model selection)
 *   - `_desktop_mode_agent_rate_limit`   invocations/hour, 0 = default
 *   - `_desktop_mode_agent_created_by`   creating user id (audit aid)
 *
 * User meta has no revisions — the audit trail for definition changes
 * is the `desktop_mode_agent_{created,updated,deleted}` actions fired
 * from this module's orchestrators, each carrying before/after values
 * so logging plugins can persist a history.
 *
 * This module owns every key: constants, `register_meta()` calls,
 * sanitization, getters/setters, and the create/update orchestrators
 * the REST surface calls. `identity.php` owns the user row itself.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Meta keys owned by the agents store. Constants so the other layer
 * files reuse them instead of typing the literals.
 *
 */
const DESKTOP_MODE_AGENT_USER_MARKER_META  = '_desktop_mode_agent';
const DESKTOP_MODE_AGENT_DESCRIPTION_META  = '_desktop_mode_agent_description';
const DESKTOP_MODE_AGENT_INSTRUCTIONS_META = '_desktop_mode_agent_instructions';
const DESKTOP_MODE_AGENT_ABILITIES_META    = '_desktop_mode_agent_abilities';
const DESKTOP_MODE_AGENT_TRIGGERS_META     = '_desktop_mode_agent_triggers';
const DESKTOP_MODE_AGENT_MODEL_META        = '_desktop_mode_agent_model';
const DESKTOP_MODE_AGENT_RATE_LIMIT_META   = '_desktop_mode_agent_rate_limit';
const DESKTOP_MODE_AGENT_CREATED_BY_META   = '_desktop_mode_agent_created_by';

/**
 * Every meta key the store writes — the privacy eraser and any future
 * cleanup path iterate this list instead of re-typing the constants.
 *
 * @return string[]
 */
function desktop_mode_agent_meta_keys() {
	return array(
		DESKTOP_MODE_AGENT_USER_MARKER_META,
		DESKTOP_MODE_AGENT_DESCRIPTION_META,
		DESKTOP_MODE_AGENT_INSTRUCTIONS_META,
		DESKTOP_MODE_AGENT_ABILITIES_META,
		DESKTOP_MODE_AGENT_TRIGGERS_META,
		DESKTOP_MODE_AGENT_MODEL_META,
		DESKTOP_MODE_AGENT_RATE_LIMIT_META,
		DESKTOP_MODE_AGENT_CREATED_BY_META,
	);
}

/**
 * Register the user-meta keys.
 *
 * `show_in_rest` stays false on every key — the module's own REST
 * surface (rest.php) is the only reader/writer; core `wp/v2/users`
 * never exposes agent definitions.
 *
 * @return void
 */
function desktop_mode_agents_register_user_meta() {
	$auth = static function () {
		return current_user_can( 'edit_users' );
	};

	register_meta(
		'user',
		DESKTOP_MODE_AGENT_DESCRIPTION_META,
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
		DESKTOP_MODE_AGENT_INSTRUCTIONS_META,
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
		DESKTOP_MODE_AGENT_ABILITIES_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'desktop_mode_agent_sanitize_abilities_json',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		DESKTOP_MODE_AGENT_TRIGGERS_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => false,
			'sanitize_callback' => 'desktop_mode_agent_sanitize_triggers_json',
			'auth_callback'     => $auth,
		)
	);
	register_meta(
		'user',
		DESKTOP_MODE_AGENT_MODEL_META,
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
		DESKTOP_MODE_AGENT_RATE_LIMIT_META,
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
add_action( 'init', 'desktop_mode_agents_register_user_meta' );

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

/**
 * Normalize an ability-slug list: strings only, trimmed, deduped.
 *
 * @param mixed $value Incoming list.
 * @return string[]
 */
function desktop_mode_agents_sanitize_ability_slugs( $value ) {
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

/**
 * `register_meta` sanitize callback — abilities land on disk as a JSON
 * string so a read is one meta row and no PHP-serialized arrays exist.
 *
 * @param mixed $value Incoming value (array or JSON string).
 * @return string JSON-encoded slug list.
 */
function desktop_mode_agent_sanitize_abilities_json( $value ) {
	return (string) wp_json_encode( desktop_mode_agents_sanitize_ability_slugs( $value ) );
}

/**
 * Sanitize the triggers array.
 *
 * Validates each row against the kind catalogue. Drops any row that
 * doesn't match a known kind — one bad row never rejects the whole
 * array.
 *
 * @param mixed $value Incoming triggers array (or JSON string).
 * @return array
 */
function desktop_mode_agent_sanitize_triggers( $value ) {
	if ( is_string( $value ) ) {
		$decoded = json_decode( $value, true );
		$value   = is_array( $decoded ) ? $decoded : array();
	}
	if ( ! is_array( $value ) ) {
		return array();
	}

	$known_kinds = array();
	foreach ( desktop_mode_agent_trigger_kinds() as $kind ) {
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
		$config = desktop_mode_agent_sanitize_trigger_config_deep( $config );

		$out[] = array(
			'kind'   => $kind,
			'config' => $config,
		);
	}

	return $out;
}

/**
 * `register_meta` sanitize callback — triggers land on disk as JSON.
 *
 * @param mixed $value Incoming value.
 * @return string JSON-encoded triggers list.
 */
function desktop_mode_agent_sanitize_triggers_json( $value ) {
	return (string) wp_json_encode( desktop_mode_agent_sanitize_triggers( $value ) );
}

/**
 * Recursively coerce trigger-config values into safe primitives.
 *
 * Keys are camelCase by convention (`entityKinds`, `mimeTypes`,
 * `fromAgents`) because they round-trip through the JS REST adapter
 * verbatim — so the case is preserved and only non-identifier
 * characters are stripped. `sanitize_key()` would lower-case
 * everything, breaking the contract with the client.
 *
 * @param mixed $value Arbitrary input.
 * @return mixed
 */
function desktop_mode_agent_sanitize_trigger_config_deep( $value ) {
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
			$out[ $key ] = desktop_mode_agent_sanitize_trigger_config_deep( $v );
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

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/**
 * Built-in trigger kinds.
 *
 * Phase A wires only `chat`; the other kinds are declared so the
 * Triggers pane can already store configuration for them, and Phases
 * B/C add the intake plumbing without a storage migration.
 *
 * Plugins can extend the list via the `desktop_mode_agent_trigger_kinds`
 * filter — each entry must declare a `slug`, `label`, and a JSON-Schema
 * `config_schema` describing the shape of `trigger.config`.
 *
 * @return array<int, array{slug:string,label:string,description:string,icon:string,config_schema:array}>
 */
function desktop_mode_agent_trigger_kinds() {
	$kinds = array(
		array(
			'slug'          => 'chat',
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

	/**
	 * Filter the trigger kinds available to agents.
	 *
	 * @param array $kinds Default trigger kinds.
	 */
	$filtered = apply_filters( 'desktop_mode_agent_trigger_kinds', $kinds );
	if ( ! is_array( $filtered ) ) {
		return $kinds;
	}
	return array_values( $filtered );
}

/**
 * Curated catalogue of WordPress hooks suggested for the Hook trigger.
 *
 * Not exhaustive — just the ones agents are most likely to subscribe
 * to. The renderer offers it as an autocomplete; the user can type any
 * hook name.
 *
 * @return array<int, array{hook:string, when:string}>
 */
function desktop_mode_agent_hooks_catalogue() {
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

	/**
	 * Filter the curated catalogue of suggested hooks for the Hook
	 * trigger configurator.
	 *
	 * @param array $hooks Default catalogue.
	 */
	$filtered = apply_filters( 'desktop_mode_agent_hooks_catalogue', $hooks );
	return is_array( $filtered ) ? array_values( $filtered ) : $hooks;
}

/**
 * Roles an agent may be assigned, constrained to what the acting user
 * can hand out.
 *
 * The whitelist keeps agents in the standard content-role band; the
 * `get_editable_roles()` intersection prevents a user from minting an
 * agent with a role they could not assign to a human.
 *
 * @return string[] Role slugs.
 */
function desktop_mode_agent_allowed_roles() {
	$whitelist = array( 'administrator', 'editor', 'author', 'contributor' );

	/**
	 * Filter the roles an agent may be assigned.
	 *
	 * The result is always intersected with the acting user's
	 * `get_editable_roles()` — the filter can narrow or extend the
	 * whitelist but never bypass the editable-roles constraint.
	 *
	 * @param string[] $whitelist Default role slugs.
	 */
	$whitelist = apply_filters( 'desktop_mode_agent_allowed_roles', $whitelist );
	if ( ! is_array( $whitelist ) ) {
		return array();
	}

	if ( ! function_exists( 'get_editable_roles' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}
	$editable = array_keys( get_editable_roles() );

	return array_values( array_intersect( array_map( 'strval', $whitelist ), $editable ) );
}

// ---------------------------------------------------------------------------
// Getters / setters
// ---------------------------------------------------------------------------

/**
 * Read the "when to use" description.
 *
 * @param int $user_id Agent user id.
 * @return string
 */
function desktop_mode_agent_get_description( $user_id ) {
	return (string) get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_DESCRIPTION_META, true );
}

/**
 * Read the system prompt.
 *
 * @param int $user_id Agent user id.
 * @return string
 */
function desktop_mode_agent_get_instructions( $user_id ) {
	return (string) get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_INSTRUCTIONS_META, true );
}

/**
 * Read the ability allowlist.
 *
 * @param int $user_id Agent user id.
 * @return string[]
 */
function desktop_mode_agent_get_abilities( $user_id ) {
	$raw = get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_ABILITIES_META, true );
	if ( '' === $raw || null === $raw ) {
		return array();
	}
	return desktop_mode_agents_sanitize_ability_slugs( $raw );
}

/**
 * Read triggers.
 *
 * @param int $user_id Agent user id.
 * @return array
 */
function desktop_mode_agent_get_triggers( $user_id ) {
	$raw = get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_TRIGGERS_META, true );
	if ( '' === $raw || null === $raw ) {
		return array();
	}
	return desktop_mode_agent_sanitize_triggers( $raw );
}

/**
 * Read the model override.
 *
 * @param int $user_id Agent user id.
 * @return string Empty string if not set.
 */
function desktop_mode_agent_get_model( $user_id ) {
	return (string) get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_MODEL_META, true );
}

/**
 * Read the rate limit (invocations per hour).
 *
 * @param int $user_id Agent user id.
 * @return int Zero when no per-agent override is set.
 */
function desktop_mode_agent_get_rate_limit( $user_id ) {
	return (int) get_user_meta( (int) $user_id, DESKTOP_MODE_AGENT_RATE_LIMIT_META, true );
}

// ---------------------------------------------------------------------------
// List helper
// ---------------------------------------------------------------------------

/**
 * Every agent on the site, ordered by display name.
 *
 * @param array $args Optional overrides merged into the `get_users()` query.
 * @return WP_User[]
 */
function desktop_mode_agent_get_agents( $args = array() ) {
	$defaults = array(
		'meta_key'   => DESKTOP_MODE_AGENT_USER_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
		'meta_value' => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
		'orderby'    => 'display_name',
		'order'      => 'ASC',
		'number'     => 200,
	);
	return get_users( array_merge( $defaults, is_array( $args ) ? $args : array() ) );
}

// ---------------------------------------------------------------------------
// Orchestrators — the only write paths, each firing one audit action
// ---------------------------------------------------------------------------

/**
 * Create an agent: synthetic user row + definition meta.
 *
 * @param array{name:string, role:string, slug?:string, description?:string, instructions?:string, abilities?:array} $args Creation args.
 * @return WP_User|WP_Error
 */
function desktop_mode_agent_create( $args ) {
	$role    = isset( $args['role'] ) ? sanitize_key( (string) $args['role'] ) : '';
	$allowed = desktop_mode_agent_allowed_roles();
	if ( '' === $role || ! in_array( $role, $allowed, true ) ) {
		return new WP_Error(
			'desktop_mode_agent_invalid_role',
			__( 'Pick a role you are allowed to assign to an agent.', 'desktop-mode' )
		);
	}

	$user = desktop_mode_agent_create_user( $args );
	if ( is_wp_error( $user ) ) {
		return $user;
	}

	$description  = isset( $args['description'] ) ? sanitize_text_field( (string) $args['description'] ) : '';
	$instructions = isset( $args['instructions'] ) ? wp_kses_post( (string) $args['instructions'] ) : '';
	$abilities    = isset( $args['abilities'] ) ? desktop_mode_agents_sanitize_ability_slugs( $args['abilities'] ) : array();

	if ( '' !== $description ) {
		update_user_meta( $user->ID, DESKTOP_MODE_AGENT_DESCRIPTION_META, $description );
	}
	if ( '' !== $instructions ) {
		update_user_meta( $user->ID, DESKTOP_MODE_AGENT_INSTRUCTIONS_META, $instructions );
	}
	if ( ! empty( $abilities ) ) {
		update_user_meta( $user->ID, DESKTOP_MODE_AGENT_ABILITIES_META, wp_json_encode( $abilities ) );
	}
	update_user_meta( $user->ID, DESKTOP_MODE_AGENT_CREATED_BY_META, get_current_user_id() );

	/**
	 * Fires after an agent is created.
	 *
	 * @param int   $user_id  Agent user id.
	 * @param array $args     Sanitized creation fields (name, role,
	 *                        description, instructions, abilities).
	 * @param int   $actor_id User who created the agent.
	 */
	do_action(
		'desktop_mode_agent_created',
		(int) $user->ID,
		array(
			'name'         => (string) $user->display_name,
			'role'         => $role,
			'description'  => $description,
			'instructions' => $instructions,
			'abilities'    => $abilities,
		),
		get_current_user_id()
	);

	return $user;
}

/**
 * Update an agent's definition. Accepts any subset of the recognized
 * fields, applies the valid ones, and fires `desktop_mode_agent_updated`
 * once with a before/after map of everything that changed.
 *
 * Recognized fields: `name`, `role`, `description`, `instructions`,
 * `abilities`, `triggers`, `model`, `rateLimit`.
 *
 * @param int   $user_id Agent user id.
 * @param array $fields  Field map.
 * @return true|WP_Error
 */
function desktop_mode_agent_update( $user_id, array $fields ) {
	$user = get_userdata( (int) $user_id );
	if ( ! $user || ! desktop_mode_agent_is_agent( $user ) ) {
		return new WP_Error(
			'desktop_mode_agent_not_found',
			__( 'Agent not found.', 'desktop-mode' )
		);
	}

	$changed = array();

	if ( isset( $fields['name'] ) ) {
		$name = sanitize_text_field( (string) $fields['name'] );
		if ( '' === $name ) {
			return new WP_Error(
				'desktop_mode_agent_invalid_name',
				__( 'Agent name cannot be empty.', 'desktop-mode' )
			);
		}
		if ( $name !== (string) $user->display_name ) {
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
		if ( ! in_array( $role, desktop_mode_agent_allowed_roles(), true ) ) {
			return new WP_Error(
				'desktop_mode_agent_invalid_role',
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
		$before      = desktop_mode_agent_get_description( $user->ID );
		if ( $description !== $before ) {
			$changed['description'] = array(
				'from' => $before,
				'to'   => $description,
			);
			update_user_meta( $user->ID, DESKTOP_MODE_AGENT_DESCRIPTION_META, $description );
		}
	}

	if ( isset( $fields['instructions'] ) ) {
		$instructions = wp_kses_post( (string) $fields['instructions'] );
		$before       = desktop_mode_agent_get_instructions( $user->ID );
		if ( $instructions !== $before ) {
			$changed['instructions'] = array(
				'from' => $before,
				'to'   => $instructions,
			);
			update_user_meta( $user->ID, DESKTOP_MODE_AGENT_INSTRUCTIONS_META, $instructions );
		}
	}

	if ( isset( $fields['abilities'] ) ) {
		$abilities = desktop_mode_agents_sanitize_ability_slugs( $fields['abilities'] );
		$before    = desktop_mode_agent_get_abilities( $user->ID );
		if ( $abilities !== $before ) {
			$changed['abilities'] = array(
				'from' => $before,
				'to'   => $abilities,
			);
			update_user_meta( $user->ID, DESKTOP_MODE_AGENT_ABILITIES_META, wp_json_encode( $abilities ) );
		}
	}

	if ( isset( $fields['triggers'] ) ) {
		$triggers = desktop_mode_agent_sanitize_triggers( $fields['triggers'] );
		$before   = desktop_mode_agent_get_triggers( $user->ID );
		if ( $triggers !== $before ) {
			$changed['triggers'] = array(
				'from' => $before,
				'to'   => $triggers,
			);
			update_user_meta( $user->ID, DESKTOP_MODE_AGENT_TRIGGERS_META, wp_json_encode( $triggers ) );
		}
	}

	if ( isset( $fields['model'] ) ) {
		$model  = sanitize_text_field( (string) $fields['model'] );
		$before = desktop_mode_agent_get_model( $user->ID );
		if ( $model !== $before ) {
			$changed['model'] = array(
				'from' => $before,
				'to'   => $model,
			);
			if ( '' === $model ) {
				delete_user_meta( $user->ID, DESKTOP_MODE_AGENT_MODEL_META );
			} else {
				update_user_meta( $user->ID, DESKTOP_MODE_AGENT_MODEL_META, $model );
			}
		}
	}

	if ( isset( $fields['rateLimit'] ) ) {
		$rate   = max( 0, (int) $fields['rateLimit'] );
		$before = desktop_mode_agent_get_rate_limit( $user->ID );
		if ( $rate !== $before ) {
			$changed['rateLimit'] = array(
				'from' => $before,
				'to'   => $rate,
			);
			if ( 0 === $rate ) {
				delete_user_meta( $user->ID, DESKTOP_MODE_AGENT_RATE_LIMIT_META );
			} else {
				update_user_meta( $user->ID, DESKTOP_MODE_AGENT_RATE_LIMIT_META, $rate );
			}
		}
	}

	if ( ! empty( $changed ) ) {
		/**
		 * Fires after an agent's definition changed.
		 *
		 * User meta has no revisions, so this action IS the audit
		 * trail — each changed field carries its before/after value.
		 *
		 * @param int   $user_id  Agent user id.
		 * @param array $changed  Map of field => { from, to }.
		 * @param int   $actor_id User who made the change.
		 */
		do_action( 'desktop_mode_agent_updated', (int) $user->ID, $changed, get_current_user_id() );
	}

	return true;
}
