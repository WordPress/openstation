<?php
/**
 * Desktop Mode — Routines: executor.
 *
 * The executor takes a routine + payload and runs the steps. It is
 * the single entry point — every trigger funnels here, every test
 * fixture exercises this function.
 *
 * Lifecycle per run:
 *
 *   1. Resolve effective user (`run_as` author or system admin).
 *   2. Evaluate top-level conditions; bail (skipped) on miss.
 *   3. Rate-limit guard: count recent runs, bail if over.
 *   4. Switch user context (so `current_user_can` inside steps and
 *      handlers reflects the routine's run-as user).
 *   5. Walk steps, dispatching by `kind`.
 *   6. Restore user context.
 *   7. Persist a run-history row + bump stats meta.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Run a routine.
 *
 * @since 0.22.0
 *
 * @param int    $routine_id Routine post id.
 * @param array  $payload    Bound trigger payload.
 * @param string $trigger_id Trigger that fired (for the run row).
 * @param bool   $dry_run    When true, evaluate but skip side effects (no
 *                            wp_mail, no wp_remote_request, no command run).
 * @return array {
 *     @type string $status     `success` | `failure` | `skipped`.
 *     @type int    $duration_ms
 *     @type array  $steps_log
 *     @type string $error
 * }
 */
function wpdm_routine_run( $routine_id, $payload = array(), $trigger_id = '', $dry_run = false ) {
	$start = microtime( true );

	$routine = wpdm_routine_get( $routine_id );
	if ( null === $routine ) {
		return array(
			'status'      => 'failure',
			'duration_ms' => 0,
			'steps_log'   => array(),
			'error'       => 'routine_not_found',
		);
	}
	if ( ! $routine['enabled'] && ! $dry_run ) {
		return array(
			'status'      => 'skipped',
			'duration_ms' => 0,
			'steps_log'   => array(),
			'error'       => 'routine_disabled',
		);
	}

	$def    = $routine['def'];
	$author = (int) $routine['author'];
	$run_as = isset( $def['run_as'] ) ? (string) $def['run_as'] : 'author';

	// Resolve effective user.
	if ( 'system' === $run_as ) {
		// Pick the lowest-id administrator. Filterable so multisite
		// owners can pin a specific service account.
		$admin_id = wpdm_routine_resolve_system_user();

		/**
		 * Filter the system-user id used by `run_as: "system"` routines.
		 *
		 * @since 0.22.0
		 *
		 * @param int $admin_id Default: lowest-id administrator.
		 * @param int $routine_id
		 */
		$admin_id            = (int) apply_filters( 'wp_desktop_routine_system_user_id', $admin_id, $routine_id );
		$effective_user_id   = $admin_id > 0 ? $admin_id : $author;
	} else {
		$effective_user_id = $author;
	}

	$context = array(
		'routine_id'     => $routine_id,
		'run_as_user_id' => (int) $effective_user_id,
		'payload'        => is_array( $payload ) ? $payload : array(),
		'vars'           => array(),
		'step_path'      => 'steps',
	);

	/**
	 * Filter the bound payload immediately before evaluation.
	 *
	 * @since 0.22.0
	 *
	 * @param array $payload Payload bound from the trigger.
	 * @param array $routine Routine row.
	 */
	$context['payload'] = (array) apply_filters( 'wp_desktop_routine_payload', $context['payload'], $routine );

	/**
	 * Last-chance gate: returning false here halts the routine
	 * before any step runs. Useful for emergency kill-switches.
	 *
	 * @since 0.22.0
	 *
	 * @param bool  $can_run Default true.
	 * @param array $routine Routine row.
	 * @param array $payload Bound payload.
	 */
	$can_run = (bool) apply_filters( 'wp_desktop_routine_can_run', true, $routine, $context['payload'] );
	if ( ! $can_run ) {
		return wpdm_routine_finalise_run( $routine_id, 'skipped', $start, array(), 'gate_denied', $trigger_id, $context['payload'], $dry_run );
	}

	// Top-level conditions.
	foreach ( (array) $def['conditions'] as $cond ) {
		$left  = wpdm_routine_resolve( $cond['left'], $context );
		$right = wpdm_routine_resolve( $cond['right'], $context );
		if ( ! wpdm_routine_compare( $left, $cond['op'], $right ) ) {
			return wpdm_routine_finalise_run( $routine_id, 'skipped', $start, array(), 'condition_failed', $trigger_id, $context['payload'], $dry_run );
		}
	}

	// Rate limit.
	$rl = isset( $def['settings']['rate_limit'] ) ? $def['settings']['rate_limit'] : array( 'max' => 0 );
	if ( ! empty( $rl['max'] ) && wpdm_routine_is_rate_limited( $routine_id, (int) $rl['max'], (int) $rl['per_seconds'] ) ) {
		return wpdm_routine_finalise_run( $routine_id, 'skipped', $start, array(), 'rate_limited', $trigger_id, $context['payload'], $dry_run );
	}

	// Switch user context for the duration of the run.
	$prev_user = get_current_user_id();
	if ( $effective_user_id > 0 && $effective_user_id !== $prev_user ) {
		wp_set_current_user( $effective_user_id );
	}

	/**
	 * Fires before a routine's steps execute.
	 *
	 * @since 0.22.0
	 *
	 * @param array $routine Routine row.
	 * @param array $payload Bound payload.
	 */
	do_action( 'wp_desktop_routine_before_run', $routine, $context['payload'] );

	$steps_log = array();
	$status    = 'success';
	$error     = '';

	try {
		$result = wpdm_routine_walk_steps( (array) $def['steps'], $context, $steps_log, $dry_run, $def['settings'] );
		if ( is_wp_error( $result ) ) {
			$status = 'failure';
			$error  = $result->get_error_code() . ': ' . $result->get_error_message();
		}
	} catch ( \Throwable $e ) {
		$status = 'failure';
		$error  = 'exception: ' . $e->getMessage();
	}

	// Restore previous user.
	if ( $effective_user_id > 0 && $effective_user_id !== $prev_user ) {
		wp_set_current_user( $prev_user );
	}

	/**
	 * Fires after a routine completes (success or failure).
	 *
	 * @since 0.22.0
	 *
	 * @param array  $routine   Routine row.
	 * @param array  $payload   Bound payload.
	 * @param string $status    Final status.
	 * @param array  $steps_log Per-step log entries.
	 */
	do_action( 'wp_desktop_routine_after_run', $routine, $context['payload'], $status, $steps_log );

	return wpdm_routine_finalise_run( $routine_id, $status, $start, $steps_log, $error, $trigger_id, $context['payload'], $dry_run );
}

/**
 * Walk a step list. Recursive — `if` carries `then` / `else` substacks.
 *
 * @since 0.22.0
 *
 * @param array  $steps     Step list.
 * @param array  &$context  Mutable context (var scope is mutated).
 * @param array  &$log      Mutable per-run log.
 * @param bool   $dry_run   Whether side-effects are suppressed.
 * @param array  $settings  Routine settings.
 * @return true|WP_Error
 */
function wpdm_routine_walk_steps( $steps, &$context, &$log, $dry_run, $settings ) {
	foreach ( $steps as $i => $step ) {
		$entry = array(
			'kind' => $step['kind'],
			'id'   => $step['id'],
			'ok'   => true,
			'ms'   => 0,
		);
		$t0 = microtime( true );

		if ( 'if' === $step['kind'] ) {
			$cond  = $step['condition'];
			$left  = wpdm_routine_resolve( $cond['left'], $context );
			$right = wpdm_routine_resolve( $cond['right'], $context );
			$pass  = wpdm_routine_compare( $left, $cond['op'], $right );
			$entry['branch'] = $pass ? 'then' : 'else';
			// Push the `if` entry FIRST so the log reads in
			// chronological execution order — "if went to then,
			// then set_var ran" rather than "set_var ran (where
			// from?), then we discovered it was the then branch
			// of an if". The total `ms` (including children) is
			// patched in via index after the recursive walk
			// finishes.
			$log[]    = $entry;
			$if_index = count( $log ) - 1;
			$result   = wpdm_routine_walk_steps( $pass ? $step['then'] : $step['else'], $context, $log, $dry_run, $settings );
			$log[ $if_index ]['ms'] = (int) round( ( microtime( true ) - $t0 ) * 1000 );
			if ( is_wp_error( $result ) ) {
				if ( ! empty( $settings['stop_on_error'] ) ) {
					return $result;
				}
			}
			continue;
		}

		// Resolve placeholders in args (deep).
		$args   = wpdm_routine_resolve( $step['args'], $context );
		$result = wpdm_routine_dispatch_step( $step['kind'], $step['id'], $args, $context, $dry_run );

		$entry['ms'] = (int) round( ( microtime( true ) - $t0 ) * 1000 );

		if ( is_wp_error( $result ) ) {
			$entry['ok']    = false;
			$entry['error'] = $result->get_error_code() . ': ' . $result->get_error_message();
			$log[]          = $entry;

			/**
			 * Fires when a step inside a routine fails.
			 *
			 * @since 0.22.0
			 *
			 * @param array    $step    Step entry.
			 * @param array    $context Run context.
			 * @param WP_Error $error   Error.
			 */
			do_action( 'wp_desktop_routine_step_failed', $step, $context, $result );

			if ( ! empty( $settings['stop_on_error'] ) ) {
				return $result;
			}
			continue;
		}

		// Honour `_stop` early-exit returned by the `stop` step.
		if ( is_array( $result ) && ! empty( $result['_stop'] ) ) {
			$entry['stopped'] = true;
			$log[]            = $entry;
			return true;
		}

		// Honour `_set_var` payload from the `set_var` step.
		if ( is_array( $result ) && isset( $result['_set_var'] ) ) {
			$name = (string) $result['_set_var']['name'];
			if ( '' !== $name ) {
				$context['vars'][ $name ] = $result['_set_var']['value'];
			}
			$entry['result'] = array( 'set_var' => $name );
			$log[]           = $entry;
			continue;
		}

		// Step result lands at `vars.<step.id or kind>` for downstream
		// placeholder resolution.
		$slot = '' !== $step['id'] ? $step['id'] : $step['kind'] . '_' . $i;
		$context['vars'][ $slot ] = $result;
		$entry['result']          = $result;
		$log[]                    = $entry;
	}
	return true;
}

/**
 * Dispatch a single step by kind.
 *
 * @since 0.22.0
 *
 * @param string $kind    Step kind.
 * @param string $id      Step id (slug, command name, action id, …).
 * @param array  $args    Resolved args.
 * @param array  $context Run context.
 * @param bool   $dry_run Suppress side effects.
 * @return mixed Step result or `WP_Error`.
 */
function wpdm_routine_dispatch_step( $kind, $id, $args, $context, $dry_run ) {
	// `classify` joins the side-effecting kinds — every fire is a
	// paid API call, so dry-run skips it like email / http.
	if ( $dry_run && in_array( $kind, array( 'email', 'http', 'command', 'ai_tool', 'action', 'classify' ), true ) ) {
		return array( 'dry_run' => true, 'kind' => $kind, 'id' => $id );
	}
	switch ( $kind ) {
		case 'email':
			return wpdm_routine_step_email( $args, $context );
		case 'http':
			return wpdm_routine_step_http( $args, $context );
		case 'log':
			return wpdm_routine_step_log( $args, $context );
		case 'wait':
			return wpdm_routine_step_wait( $args, $context );
		case 'set_var':
			return wpdm_routine_step_set_var( $args, $context );
		case 'stop':
			return wpdm_routine_step_stop( $args, $context );
		case 'classify':
			return wpdm_routine_step_classify( $args, $context );
		case 'action':
			return wpdm_routine_dispatch_action( $id, $args, $context );
		case 'ai_tool':
			return wpdm_routine_dispatch_ai_tool( $id, $args, $context );
		case 'command':
			// Slash-commands are JS-side. The PHP engine cannot run them
			// directly; record the intent. The shell receives an
			// `outbound_commands` list in the run row and may execute
			// them when a shell session is open. Phase 2 wires the
			// listener; Phase 1 just records the intent.
			return array( 'queued_command' => $id, 'args' => $args );
	}
	return new WP_Error( 'wpdm_routine_unknown_step_kind', sprintf( 'Unknown step kind `%s`.', $kind ) );
}

/**
 * Dispatch to a `wp_register_desktop_routine_action`-registered handler.
 *
 * @since 0.22.0
 *
 * @param string $id      Action id.
 * @param array  $args    Resolved args.
 * @param array  $context Run context.
 * @return mixed
 */
function wpdm_routine_dispatch_action( $id, $args, $context ) {
	$entry = wpdm_routine_action_registry( $id );
	if ( ! is_array( $entry ) ) {
		return new WP_Error( 'wpdm_routine_action_not_registered', sprintf( 'Action `%s` is not registered.', $id ) );
	}
	$cap = (string) ( $entry['capability'] ?? '' );
	if ( '' !== $cap ) {
		$user = get_user_by( 'id', (int) $context['run_as_user_id'] );
		if ( ! $user || ! user_can( $user, $cap ) ) {
			return new WP_Error( 'wpdm_routine_action_forbidden', sprintf( 'Author lacks capability `%s` for action `%s`.', $cap, $id ) );
		}
	}
	try {
		$result = call_user_func( $entry['handler'], $args, $context );
	} catch ( \Throwable $e ) {
		return new WP_Error( 'wpdm_routine_action_exception', $e->getMessage() );
	}
	return $result;
}

/**
 * Dispatch to a registered AI tool handler. Reuses the AI Copilot's
 * registry so any tool the AI can call is also a routine action for
 * free.
 *
 * @since 0.22.0
 *
 * @param string $id      AI tool name.
 * @param array  $args    Resolved args.
 * @param array  $context Run context.
 * @return mixed
 */
function wpdm_routine_dispatch_ai_tool( $id, $args, $context ) {
	if ( ! function_exists( 'desktop_mode_desktop_ai_tool_registry' ) ) {
		return new WP_Error( 'wpdm_routine_ai_tool_unavailable', 'AI Copilot module unavailable.' );
	}
	$entry = desktop_mode_desktop_ai_tool_registry( $id );
	if ( ! is_array( $entry ) ) {
		return new WP_Error( 'wpdm_routine_ai_tool_not_registered', sprintf( 'AI tool `%s` is not registered.', $id ) );
	}
	$cap = (string) ( $entry['capability'] ?? '' );
	if ( '' !== $cap ) {
		$user = get_user_by( 'id', (int) $context['run_as_user_id'] );
		if ( ! $user || ! user_can( $user, $cap ) ) {
			return new WP_Error( 'wpdm_routine_ai_tool_forbidden', sprintf( 'Author lacks capability `%s`.', $cap ) );
		}
	}
	if ( ! function_exists( 'desktop_mode_ai_invoke_registered_tool' ) ) {
		return new WP_Error( 'wpdm_routine_ai_tool_unavailable', 'AI Copilot dispatcher unavailable.' );
	}
	return desktop_mode_ai_invoke_registered_tool( $entry, (array) $args, (int) $context['run_as_user_id'] );
}

/**
 * Resolve the lowest-id administrator for `run_as: "system"`.
 *
 * @since 0.22.0
 *
 * @return int
 */
function wpdm_routine_resolve_system_user() {
	$users = get_users(
		array(
			'role'    => 'administrator',
			'orderby' => 'ID',
			'order'   => 'ASC',
			'number'  => 1,
			'fields'  => 'ID',
		)
	);
	return ! empty( $users ) ? (int) $users[0] : 0;
}

/**
 * Rate-limit check.
 *
 * @since 0.22.0
 *
 * @param int $routine_id  Routine post id.
 * @param int $max         Max runs in the window.
 * @param int $per_seconds Window length in seconds.
 * @return bool True when over the limit.
 */
function wpdm_routine_is_rate_limited( $routine_id, $max, $per_seconds ) {
	if ( $max <= 0 ) {
		return false;
	}
	global $wpdb;
	$table = wpdm_routine_runs_table();
	$count = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM $table WHERE routine_id = %d AND started_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL %d SECOND)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			(int) $routine_id,
			(int) $per_seconds
		)
	);
	return $count >= $max;
}

/**
 * Persist a finalised run + return the canonical result envelope.
 *
 * @since 0.22.0
 *
 * @param int    $routine_id Routine post id.
 * @param string $status     Final status.
 * @param float  $start      microtime(true) at start.
 * @param array  $steps_log  Per-step log entries.
 * @param string $error      Error string.
 * @param string $trigger_id Trigger id for the row.
 * @param array  $payload    Bound payload.
 * @param bool   $dry_run    When true, skip the DB row.
 * @return array
 */
function wpdm_routine_finalise_run( $routine_id, $status, $start, $steps_log, $error, $trigger_id, $payload, $dry_run ) {
	$duration_ms = (int) round( ( microtime( true ) - $start ) * 1000 );
	if ( ! $dry_run ) {
		wpdm_routine_record_run(
			array(
				'routine_id'  => $routine_id,
				'status'      => $status,
				'duration_ms' => $duration_ms,
				'trigger_id'  => $trigger_id,
				'payload'     => $payload,
				'steps_log'   => $steps_log,
				'error'       => $error,
			)
		);
	}
	return array(
		'status'      => $status,
		'duration_ms' => $duration_ms,
		'steps_log'   => $steps_log,
		'error'       => $error,
	);
}
