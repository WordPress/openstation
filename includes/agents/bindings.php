<?php
/**
 * Desktop Mode — Agents: bindings layer (per-site invocation policy).
 *
 * Triggers, model overrides, and rate limits live as user meta on the
 * agent's `wp_users` row. The argument from PR #240's body: this is the
 * site-specific knowledge ("how this site reaches the agent"), not the
 * portable behaviour ("what the agent does"). Push MD / Claude Code /
 * Codex have no concept of WP hook subscriptions, so triggers should
 * not round-trip through the `wp_guideline` post.
 *
 * Trigger shape (one row each in the JSON-encoded array):
 *
 *   {
 *       "kind":  "drag" | "chat" | "hook" | "endpoint" | "agent",
 *       "config": { ... shape per kind ... }
 *   }
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Meta keys owned by the bindings layer.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENT_TRIGGERS_META   = '_desktop_mode_agent_triggers';
const DESKTOP_MODE_AGENT_MODEL_META      = '_desktop_mode_agent_model';
const DESKTOP_MODE_AGENT_RATE_LIMIT_META = '_desktop_mode_agent_rate_limit';

/**
 * Built-in trigger kinds.
 *
 * Plugins can extend the list via the `desktop_mode_agent_trigger_kinds`
 * filter — each entry must declare a `slug`, `label`, and a JSON-Schema
 * `config_schema` describing the shape of `trigger.config`.
 *
 * @since 0.23.0
 *
 * @return array<int, array{slug:string,label:string,config_schema:array}>
 */
function desktop_mode_agent_trigger_kinds() {
	$kinds = array(
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
					'mimeTypes'    => array(
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
						'enum' => array( 'capability', 'nonce', 'anonymous' ),
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
	 * @since 0.23.0
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
 * @since 0.23.0
 *
 * @return array<int, array{hook:string, when:string}>
 */
function desktop_mode_agent_hooks_catalogue() {
	$hooks = array(
		array( 'hook' => 'save_post',            'when' => __( 'Every time a post is saved.', 'desktop-mode' ) ),
		array( 'hook' => 'wp_insert_post',       'when' => __( 'A new post is inserted.', 'desktop-mode' ) ),
		array( 'hook' => 'transition_post_status', 'when' => __( 'A post status changes.', 'desktop-mode' ) ),
		array( 'hook' => 'wp_insert_comment',    'when' => __( 'A new comment is inserted.', 'desktop-mode' ) ),
		array( 'hook' => 'comment_post',         'when' => __( 'A new comment is posted.', 'desktop-mode' ) ),
		array( 'hook' => 'wp_login',             'when' => __( 'A user logs in successfully.', 'desktop-mode' ) ),
		array( 'hook' => 'user_register',        'when' => __( 'A new user registers.', 'desktop-mode' ) ),
		array( 'hook' => 'profile_update',       'when' => __( 'A user profile is updated.', 'desktop-mode' ) ),
		array( 'hook' => 'add_attachment',       'when' => __( 'A new attachment is added.', 'desktop-mode' ) ),
		array( 'hook' => 'wp_handle_upload',     'when' => __( 'A file finishes uploading.', 'desktop-mode' ) ),
	);

	/**
	 * Filter the curated catalogue of suggested hooks for the Hook
	 * trigger configurator.
	 *
	 * @since 0.23.0
	 *
	 * @param array $hooks Default catalogue.
	 */
	$filtered = apply_filters( 'desktop_mode_agent_hooks_catalogue', $hooks );
	return is_array( $filtered ) ? array_values( $filtered ) : $hooks;
}

/**
 * Sanitize the triggers array.
 *
 * Validates each row against the kind catalogue's `config_schema`. Drops
 * any row that doesn't match a known kind or whose required fields are
 * missing. We don't reject the whole array on one bad row — that would
 * be cruel after a manual REST edit.
 *
 * @since 0.23.0
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
		// Best-effort flat sanitize — every leaf gets stringified.
		$config = desktop_mode_agent_sanitize_trigger_config_deep( $config );

		$out[] = array(
			'kind'   => $kind,
			'config' => $config,
		);
	}

	return $out;
}

/**
 * Recursively coerce trigger-config values into safe primitives.
 *
 * Keys are camelCase by convention (`entityKinds`, `mimeTypes`,
 * `fromAgents`) because they round-trip through the JS REST adapter
 * verbatim — so we preserve the case and only strip non-printable /
 * non-identifier characters. `sanitize_key()` would lower-case
 * everything, breaking the contract with the client.
 *
 * @since 0.23.0
 *
 * @param mixed $value Arbitrary input.
 * @return mixed
 */
function desktop_mode_agent_sanitize_trigger_config_deep( $value ) {
	if ( is_array( $value ) ) {
		$out = array();
		foreach ( $value as $k => $v ) {
			if ( is_string( $k ) ) {
				// Allow camelCase + ASCII underscore / dash. Strip
				// anything else.
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

/**
 * Collect every agent on the site that has a `send-to` trigger
 * configured, projected into the shape the bundle's context-menu
 * filter consumes:
 *
 *   [
 *     {
 *       id:          int    (agent user id)
 *       slug:        string ('foo' from 'agent-foo')
 *       name:        string (display_name)
 *       avatarUrl:   string
 *       entityKinds: string[] ('post' / 'page' / 'media' / 'user' / 'comment')
 *     },
 *     ...
 *   ]
 *
 * Used by `desktop_mode_agents_window_config()` to ship send-to
 * targets to the bundle on window open, and by the REST route at
 * `/desktop-mode/v1/agents/send-to-targets` for live re-fetch after
 * an agent's triggers change.
 *
 * @since 0.23.0
 *
 * @return array
 */
function desktop_mode_agents_collect_send_to_targets() {
	$users = get_users(
		array(
			'meta_key'   => DESKTOP_MODE_AGENT_USER_MARKER_META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
			'meta_value' => '1', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
			'number'     => 200,
		)
	);

	$out = array();
	foreach ( $users as $user ) {
		$triggers = desktop_mode_agent_get_triggers( $user->ID );
		$entity_kinds = array();
		foreach ( $triggers as $trigger ) {
			if ( 'send-to' !== ( $trigger['kind'] ?? '' ) ) {
				continue;
			}
			$kinds = isset( $trigger['config']['entityKinds'] ) && is_array( $trigger['config']['entityKinds'] )
				? $trigger['config']['entityKinds']
				: array();
			foreach ( $kinds as $kind ) {
				if ( is_string( $kind ) && '' !== $kind ) {
					$entity_kinds[ $kind ] = true;
				}
			}
		}
		if ( empty( $entity_kinds ) ) {
			continue;
		}

		$slug = (string) $user->user_login;
		if ( 0 === strpos( $slug, 'agent-' ) ) {
			$slug = substr( $slug, strlen( 'agent-' ) );
		}

		$avatar = get_avatar_url( $user->ID, array( 'size' => 64 ) );
		if ( ! is_string( $avatar ) || '' === $avatar ) {
			$avatar = function_exists( 'desktop_mode_agent_avatar_data_uri' )
				? desktop_mode_agent_avatar_data_uri()
				: '';
		}

		// Pull the agent's behaviour description from the linked
		// guideline (post_excerpt). The Send-To dispatcher surfaces it
		// as the subtitle in the "Agent run" window so the user sees
		// *what this agent does* during execution instead of an echo
		// of their own send-to message.
		$description = '';
		if ( function_exists( 'desktop_mode_agents_get_guideline_for_user' ) ) {
			$guideline = desktop_mode_agents_get_guideline_for_user( (int) $user->ID );
			if ( $guideline instanceof WP_Post ) {
				$description = (string) $guideline->post_excerpt;
			}
		}

		$out[] = array(
			'id'          => (int) $user->ID,
			'slug'        => $slug,
			'name'        => (string) $user->display_name,
			'description' => $description,
			'avatarUrl'   => $avatar,
			'entityKinds' => array_keys( $entity_kinds ),
		);
	}

	/**
	 * Filter the list of send-to-eligible agents projected to the
	 * bundle.
	 *
	 * @since 0.23.0
	 *
	 * @param array $out List of send-to target descriptors.
	 */
	return apply_filters( 'desktop_mode_agents_send_to_targets', $out );
}

/**
 * Read triggers for an agent.
 *
 * @since 0.23.0
 *
 * @param int $user_id Agent user id.
 * @return array
 */
function desktop_mode_agent_get_triggers( $user_id ) {
	$raw = get_user_meta( $user_id, DESKTOP_MODE_AGENT_TRIGGERS_META, true );
	if ( '' === $raw || null === $raw ) {
		return array();
	}
	return desktop_mode_agent_sanitize_triggers( $raw );
}

/**
 * Write triggers for an agent.
 *
 * @since 0.23.0
 *
 * @param int   $user_id  Agent user id.
 * @param array $triggers Triggers array.
 * @return array Sanitised triggers that were written.
 */
function desktop_mode_agent_set_triggers( $user_id, $triggers ) {
	$clean = desktop_mode_agent_sanitize_triggers( $triggers );
	update_user_meta( $user_id, DESKTOP_MODE_AGENT_TRIGGERS_META, wp_json_encode( $clean ) );

	/**
	 * Fires after an agent's triggers are updated.
	 *
	 * @since 0.23.0
	 *
	 * @param int   $user_id Agent user id.
	 * @param array $clean   Sanitised triggers written.
	 */
	do_action( 'desktop_mode_agent_triggers_updated', $user_id, $clean );

	return $clean;
}

/**
 * Read model override.
 *
 * @since 0.23.0
 *
 * @param int $user_id Agent user id.
 * @return string Empty string if not set.
 */
function desktop_mode_agent_get_model( $user_id ) {
	return (string) get_user_meta( $user_id, DESKTOP_MODE_AGENT_MODEL_META, true );
}

/**
 * Write model override.
 *
 * @since 0.23.0
 *
 * @param int    $user_id Agent user id.
 * @param string $model   Model identifier; empty string clears the override.
 * @return void
 */
function desktop_mode_agent_set_model( $user_id, $model ) {
	$clean = sanitize_text_field( (string) $model );
	if ( '' === $clean ) {
		delete_user_meta( $user_id, DESKTOP_MODE_AGENT_MODEL_META );
		return;
	}
	update_user_meta( $user_id, DESKTOP_MODE_AGENT_MODEL_META, $clean );
}

/**
 * Read rate limit (invocations per hour).
 *
 * @since 0.23.0
 *
 * @param int $user_id Agent user id.
 * @return int Zero when no limit is set.
 */
function desktop_mode_agent_get_rate_limit( $user_id ) {
	return (int) get_user_meta( $user_id, DESKTOP_MODE_AGENT_RATE_LIMIT_META, true );
}

/**
 * Write rate limit.
 *
 * @since 0.23.0
 *
 * @param int $user_id    Agent user id.
 * @param int $rate_limit Invocations per hour; <= 0 clears the override.
 * @return void
 */
function desktop_mode_agent_set_rate_limit( $user_id, $rate_limit ) {
	$clean = (int) $rate_limit;
	if ( $clean <= 0 ) {
		delete_user_meta( $user_id, DESKTOP_MODE_AGENT_RATE_LIMIT_META );
		return;
	}
	update_user_meta( $user_id, DESKTOP_MODE_AGENT_RATE_LIMIT_META, $clean );
}
