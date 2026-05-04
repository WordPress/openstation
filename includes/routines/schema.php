<?php
/**
 * Desktop Mode — Routines: definition validator.
 *
 * One routine definition is:
 *
 * ```
 * {
 *   "version": 1,
 *   "trigger":   { "kind": "hook|broadcast", "id": "<hook>", "priority": 10 },
 *   "conditions":[{ "left": "{{post.ID}}", "op": "eq", "right": 42 }, ...],
 *   "steps":     [{ "kind": "command|ai_tool|action|email|http|log|wait|if|stop",
 *                  "id":   "<slug if applicable>",
 *                  "args": { ... }, "children": [ ... ] }, ...],
 *   "run_as":    "author" | "system",
 *   "settings":  { "rate_limit": { "max": 10, "per_seconds": 60 },
 *                  "timeout_ms": 5000,
 *                  "stop_on_error": true }
 * }
 * ```
 *
 * Validation is *defensive* — every read either gets a normalised
 * shape with all optional fields filled in, or a `WP_Error`. The
 * executor never has to second-guess the shape it receives.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Step kinds the executor knows how to run.
 *
 * Plugins extend the catalog by registering an action via
 * `desktop_mode_register_routine_action()`; those land in the
 * `action` kind. The kinds here are *built-ins* — the executor
 * dispatches each by static switch.
 *
 * @since 0.22.0
 *
 * @return string[]
 */
function wpdm_routine_known_step_kinds() {
	return array(
		'command',
		'ai_tool',
		'action',
		'email',
		'http',
		'log',
		'wait',
		'if',
		'stop',
		'set_var',
		// `classify` — AI sorts a piece of text into one of N
		// user-defined buckets, returns `{ bucket_id, confidence,
		// reasoning }` for downstream steps to branch on.
		// Powered by OpenAI structured output (same backbone as
		// the "Describe it" generator).
		'classify',
	);
}

/**
 * Comparison operators allowed in conditions / `if` step.
 *
 * @since 0.22.0
 *
 * @return string[]
 */
function wpdm_routine_known_operators() {
	return array( 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'matches', 'in', 'not_in', 'truthy', 'falsy' );
}

/**
 * Validate + normalise a routine definition.
 *
 * @since 0.22.0
 *
 * @param mixed $def Raw definition (associative array).
 * @return array|WP_Error Normalised definition on success.
 */
function wpdm_routine_validate_def( $def ) {
	if ( ! is_array( $def ) ) {
		return new WP_Error(
			'wpdm_routine_def_not_array',
			__( 'Routine definition must be an object.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	// Trigger.
	$trigger_in = isset( $def['trigger'] ) && is_array( $def['trigger'] ) ? $def['trigger'] : array();
	$trigger    = wpdm_routine_validate_trigger( $trigger_in );
	if ( is_wp_error( $trigger ) ) {
		return $trigger;
	}

	// Conditions (optional).
	$conditions = array();
	if ( ! empty( $def['conditions'] ) ) {
		if ( ! is_array( $def['conditions'] ) ) {
			return new WP_Error( 'wpdm_routine_conditions_not_array', __( '`conditions` must be an array.', 'desktop-mode' ), array( 'status' => 400 ) );
		}
		foreach ( $def['conditions'] as $i => $raw ) {
			if ( ! is_array( $raw ) ) {
				return new WP_Error( 'wpdm_routine_condition_invalid', sprintf( 'Condition #%d is not an object.', $i ), array( 'status' => 400 ) );
			}
			$validated = wpdm_routine_validate_condition( $raw, "conditions[$i]" );
			if ( is_wp_error( $validated ) ) {
				return $validated;
			}
			$conditions[] = $validated;
		}
	}

	// Steps.
	$steps_in = isset( $def['steps'] ) && is_array( $def['steps'] ) ? $def['steps'] : array();
	$steps    = array();
	foreach ( $steps_in as $i => $raw ) {
		$validated = wpdm_routine_validate_step( $raw, "steps[$i]" );
		if ( is_wp_error( $validated ) ) {
			return $validated;
		}
		$steps[] = $validated;
	}

	// run_as.
	$run_as = isset( $def['run_as'] ) ? (string) $def['run_as'] : 'author';
	if ( ! in_array( $run_as, array( 'author', 'system' ), true ) ) {
		$run_as = 'author';
	}
	// run_as system requires manage_options to set. We don't fail
	// the validation here (the saved CPT row's edit gate already
	// enforces `manage_options`); we keep the field as authored.

	// Settings.
	$settings_in = isset( $def['settings'] ) && is_array( $def['settings'] ) ? $def['settings'] : array();
	$settings    = array(
		'rate_limit'     => array(
			'max'         => isset( $settings_in['rate_limit']['max'] ) ? max( 0, (int) $settings_in['rate_limit']['max'] ) : 0,
			'per_seconds' => isset( $settings_in['rate_limit']['per_seconds'] ) ? max( 1, (int) $settings_in['rate_limit']['per_seconds'] ) : 60,
		),
		'timeout_ms'    => isset( $settings_in['timeout_ms'] ) ? max( 100, min( 30000, (int) $settings_in['timeout_ms'] ) ) : 5000,
		'stop_on_error' => isset( $settings_in['stop_on_error'] ) ? (bool) $settings_in['stop_on_error'] : true,
	);

	return array(
		'version'    => WPDM_ROUTINE_DEF_VERSION,
		'trigger'    => $trigger,
		'conditions' => $conditions,
		'steps'      => $steps,
		'run_as'     => $run_as,
		'settings'   => $settings,
	);
}

/**
 * Validate a trigger spec.
 *
 * @since 0.22.0
 *
 * @param array $raw Raw trigger.
 * @return array|WP_Error
 */
function wpdm_routine_validate_trigger( $raw ) {
	$kind = isset( $raw['kind'] ) ? (string) $raw['kind'] : 'hook';
	if ( ! in_array( $kind, array( 'hook', 'broadcast' ), true ) ) {
		return new WP_Error( 'wpdm_routine_trigger_kind_invalid', __( 'Trigger `kind` must be `hook` or `broadcast`.', 'desktop-mode' ), array( 'status' => 400 ) );
	}
	$id = isset( $raw['id'] ) ? (string) $raw['id'] : '';
	// Hook names allow more chars than `sanitize_key` (`/` for compat,
	// uppercase for a few WP core hooks like `WPLANG`). Restrict to a
	// safe set rather than blindly trusting the input.
	if ( '' === $id || ! preg_match( '/^[A-Za-z0-9_.\-\/]{1,128}$/', $id ) ) {
		return new WP_Error( 'wpdm_routine_trigger_id_invalid', __( 'Trigger `id` must be a hook or broadcast topic name.', 'desktop-mode' ), array( 'status' => 400 ) );
	}

	return array(
		'kind'     => $kind,
		'id'       => $id,
		'priority' => isset( $raw['priority'] ) ? (int) $raw['priority'] : 10,
	);
}

/**
 * Validate a single condition row.
 *
 * @since 0.22.0
 *
 * @param array  $raw  Raw condition.
 * @param string $path Diagnostic path (`conditions[3]`).
 * @return array|WP_Error
 */
function wpdm_routine_validate_condition( $raw, $path = 'condition' ) {
	$op = isset( $raw['op'] ) ? (string) $raw['op'] : 'eq';
	if ( ! in_array( $op, wpdm_routine_known_operators(), true ) ) {
		return new WP_Error( 'wpdm_routine_op_invalid', sprintf( '%s: unknown operator `%s`.', $path, $op ), array( 'status' => 400 ) );
	}
	return array(
		'left'  => isset( $raw['left'] ) ? $raw['left'] : '',
		'op'    => $op,
		'right' => isset( $raw['right'] ) ? $raw['right'] : '',
	);
}

/**
 * Validate a step row (recursive — `if` carries `then`/`else`
 * branches that are themselves step lists).
 *
 * @since 0.22.0
 *
 * @param mixed  $raw  Raw step.
 * @param string $path Diagnostic path.
 * @return array|WP_Error
 */
function wpdm_routine_validate_step( $raw, $path = 'step' ) {
	if ( ! is_array( $raw ) ) {
		return new WP_Error( 'wpdm_routine_step_not_array', sprintf( '%s is not an object.', $path ), array( 'status' => 400 ) );
	}
	$kind = isset( $raw['kind'] ) ? (string) $raw['kind'] : '';
	if ( ! in_array( $kind, wpdm_routine_known_step_kinds(), true ) ) {
		return new WP_Error( 'wpdm_routine_step_kind_invalid', sprintf( '%s: unknown kind `%s`.', $path, $kind ), array( 'status' => 400 ) );
	}

	$out = array(
		'kind' => $kind,
		'id'   => isset( $raw['id'] ) ? (string) $raw['id'] : '',
		'args' => isset( $raw['args'] ) && is_array( $raw['args'] ) ? $raw['args'] : array(),
	);

	if ( 'if' === $kind ) {
		$cond_raw = isset( $raw['condition'] ) ? $raw['condition'] : array();
		if ( ! is_array( $cond_raw ) ) {
			return new WP_Error( 'wpdm_routine_if_condition_invalid', sprintf( '%s: `if` requires a `condition` object.', $path ), array( 'status' => 400 ) );
		}
		$cond = wpdm_routine_validate_condition( $cond_raw, "$path.condition" );
		if ( is_wp_error( $cond ) ) {
			return $cond;
		}
		$out['condition'] = $cond;

		$then_raw = isset( $raw['then'] ) && is_array( $raw['then'] ) ? $raw['then'] : array();
		$else_raw = isset( $raw['else'] ) && is_array( $raw['else'] ) ? $raw['else'] : array();

		$out['then'] = array();
		foreach ( $then_raw as $i => $sub ) {
			$validated = wpdm_routine_validate_step( $sub, "$path.then[$i]" );
			if ( is_wp_error( $validated ) ) {
				return $validated;
			}
			$out['then'][] = $validated;
		}
		$out['else'] = array();
		foreach ( $else_raw as $i => $sub ) {
			$validated = wpdm_routine_validate_step( $sub, "$path.else[$i]" );
			if ( is_wp_error( $validated ) ) {
				return $validated;
			}
			$out['else'][] = $validated;
		}
	}

	return $out;
}
