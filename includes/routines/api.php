<?php
/**
 * Desktop Mode — Routines: public registration API.
 *
 * Three entry points for plugin authors:
 *
 *   - {@see desktop_mode_register_routine_trigger()}
 *   - {@see desktop_mode_register_routine_action()}
 *   - {@see desktop_mode_register_routine_template()}
 *
 * All three are validation-fail-fast: invalid input returns a
 * `WP_Error` rather than throwing. Identical shape to the rest of
 * the plugin's registration APIs (`desktop_mode_register_window`,
 * `desktop_mode_register_ai_tool`, etc.) so plugin authors learn
 * one pattern.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Declare a triggerable hook with friendly metadata.
 *
 * Optional — undeclared hooks remain reachable via the "raw hook"
 * trigger kind, but lose discoverability and payload autocomplete.
 *
 * Example:
 *
 * ```php
 * desktop_mode_register_routine_trigger( array(
 *     'id'             => 'woocommerce_new_order',
 *     'label'          => 'WooCommerce — Order received',
 *     'group'          => 'WooCommerce',
 *     'icon'           => 'dashicons-cart',
 *     'kind'           => 'hook',
 *     'priority'       => 10,
 *     'accepted_args'  => 1,
 *     'payload_schema' => array(
 *         'order_id' => array( 'type' => 'integer', 'description' => 'Order ID' ),
 *     ),
 *     'sample_payload' => array( 'order_id' => 42 ),
 *     'binder'         => 'my_plugin_bind_order_payload',
 * ) );
 * ```
 *
 * The `binder` is an optional callable that receives the raw hook
 * args and returns a normalised associative payload — the same
 * shape exposed in the routine builder's variable picker. When
 * omitted the engine falls back to positional `arg0..argN`.
 *
 * @since 0.22.0
 *
 * @param array $args Trigger spec.
 * @return true|WP_Error
 */
function desktop_mode_register_routine_trigger( $args ) {
	$defaults = array(
		'id'             => '',
		'label'          => '',
		'group'          => '',
		'icon'           => 'dashicons-flag',
		'kind'           => 'hook',
		'priority'       => 10,
		'accepted_args'  => 1,
		'payload_schema' => array(),
		'sample_payload' => array(),
		'binder'         => null,
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = sanitize_key( (string) $args['id'] );
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'wpdm_routine_trigger_invalid_id',
			__( 'Routine trigger registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'wpdm_routine_trigger_missing_label',
			__( 'Routine trigger registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$kind = in_array( (string) $args['kind'], array( 'hook', 'broadcast' ), true )
		? (string) $args['kind']
		: 'hook';
	if ( null !== $args['binder'] && ! is_callable( $args['binder'] ) ) {
		return desktop_mode_registration_error(
			'wpdm_routine_trigger_invalid_binder',
			__( 'Routine trigger `binder` must be callable when provided.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'             => $id,
		'label'          => (string) $args['label'],
		'group'          => (string) $args['group'],
		'icon'           => (string) $args['icon'],
		'kind'           => $kind,
		'priority'       => (int) $args['priority'],
		'accepted_args'  => max( 1, (int) $args['accepted_args'] ),
		'payload_schema' => is_array( $args['payload_schema'] ) ? $args['payload_schema'] : array(),
		'sample_payload' => is_array( $args['sample_payload'] ) ? $args['sample_payload'] : array(),
		'binder'         => $args['binder'],
	);
	wpdm_routine_trigger_registry( $id, $entry );

	/**
	 * Fires after a routine trigger is registered.
	 *
	 * @since 0.22.0
	 *
	 * @param string $id    Trigger id.
	 * @param array  $entry Stored entry.
	 */
	do_action( 'desktop_mode_routine_trigger_registered', $id, $entry );

	return true;
}

/**
 * Declare a custom routine action.
 *
 * Most plugins won't need this — every command registered via
 * `wp.desktop.registerCommand({ aiCallable: true })` and every
 * server tool registered via `desktop_mode_register_ai_tool` is
 * automatically usable as a step. Use this only when you have a
 * dedicated handler that's *not* a slash-command and *not* an AI
 * tool.
 *
 * @since 0.22.0
 *
 * @param array $args {
 *     @type string   $id          Required. `[a-z0-9_.\-]{1,64}`.
 *     @type string   $label       Required.
 *     @type string   $description Optional.
 *     @type string   $icon        Optional.
 *     @type string   $group       Optional.
 *     @type string   $capability  Required. Default `manage_options`.
 *     @type array    $args_schema JSON-Schema-ish for inputs.
 *     @type callable $handler     Required. `function( array $args, array $context ): array|WP_Error`.
 * }
 * @return true|WP_Error
 */
function desktop_mode_register_routine_action( $args ) {
	$defaults = array(
		'id'          => '',
		'label'       => '',
		'description' => '',
		'icon'        => 'dashicons-controls-play',
		'group'       => '',
		'capability'  => 'manage_options',
		'args_schema' => array(),
		'handler'     => null,
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id || ! preg_match( '/^[a-z0-9_.\-]{1,64}$/', $id ) ) {
		return desktop_mode_registration_error(
			'wpdm_routine_action_invalid_id',
			__( 'Routine action `id` must match [a-z0-9_.-]{1,64}.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return desktop_mode_registration_error(
			'wpdm_routine_action_missing_label',
			__( 'Routine action registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( ! is_callable( $args['handler'] ) ) {
		return desktop_mode_registration_error(
			'wpdm_routine_action_invalid_handler',
			__( 'Routine action registration requires a callable `handler`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'          => $id,
		'label'       => (string) $args['label'],
		'description' => (string) $args['description'],
		'icon'        => (string) $args['icon'],
		'group'       => (string) $args['group'],
		'capability'  => (string) $args['capability'],
		'args_schema' => is_array( $args['args_schema'] ) ? $args['args_schema'] : array(),
		'handler'     => $args['handler'],
	);
	wpdm_routine_action_registry( $id, $entry );

	/**
	 * Fires after a routine action is registered.
	 *
	 * @since 0.22.0
	 *
	 * @param string $id    Action id.
	 * @param array  $entry Stored entry.
	 */
	do_action( 'desktop_mode_routine_action_registered', $id, $entry );

	return true;
}

/**
 * Ship a starter recipe (template) shown in the Routines UI.
 *
 * @since 0.22.0
 *
 * @param array $args {
 *     @type string $id          Required.
 *     @type string $title       Required.
 *     @type string $description Optional.
 *     @type string $icon        Optional.
 *     @type string $group       Optional.
 *     @type array  $def         Required. Routine definition (same JSON shape stored in `_wpd_routine_def`).
 * }
 * @return true|WP_Error
 */
function desktop_mode_register_routine_template( $args ) {
	$defaults = array(
		'id'          => '',
		'title'       => '',
		'description' => '',
		'icon'        => 'dashicons-star-filled',
		'group'       => 'Starter',
		'def'         => null,
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = sanitize_key( (string) $args['id'] );
	if ( '' === $id ) {
		return desktop_mode_registration_error(
			'wpdm_routine_template_invalid_id',
			__( 'Routine template registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( '' === (string) $args['title'] ) {
		return desktop_mode_registration_error(
			'wpdm_routine_template_missing_title',
			__( 'Routine template registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( ! is_array( $args['def'] ) ) {
		return desktop_mode_registration_error(
			'wpdm_routine_template_invalid_def',
			__( 'Routine template requires an array `def`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$validated = wpdm_routine_validate_def( $args['def'] );
	if ( is_wp_error( $validated ) ) {
		return $validated;
	}

	$entry = array(
		'id'          => $id,
		'title'       => (string) $args['title'],
		'description' => (string) $args['description'],
		'icon'        => (string) $args['icon'],
		'group'       => (string) $args['group'],
		'def'         => $validated,
	);
	wpdm_routine_template_registry( $id, $entry );

	/**
	 * Fires after a routine template is registered.
	 *
	 * @since 0.22.0
	 *
	 * @param string $id    Template id.
	 * @param array  $entry Stored entry.
	 */
	do_action( 'desktop_mode_routine_template_registered', $id, $entry );

	return true;
}
