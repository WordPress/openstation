<?php
/**
 * Server-side plausibility checks for Popup Siege scores.
 *
 * @package OpenStationPopupSiege
 */

defined( 'ABSPATH' ) || exit;

/**
 * Check whether score metadata has exactly the expected keys.
 *
 * @param mixed    $meta Metadata map.
 * @param string[] $keys Expected keys.
 * @return bool
 */
function popup_siege_meta_has_exact_keys( $meta, $keys ) {
	if ( ! is_array( $meta ) ) {
		return false;
	}

	$actual = array_keys( $meta );
	sort( $actual, SORT_STRING );
	sort( $keys, SORT_STRING );

	return $actual === $keys;
}

/**
 * Check the strict non-negative integer shape emitted by the game runtime.
 *
 * @param mixed $value Candidate value.
 * @return bool
 */
function popup_siege_is_nonnegative_integer( $value ) {
	return is_int( $value ) && $value >= 0;
}

/**
 * Validate Popup Siege's rules-v3 terminal snapshot.
 *
 * The runtime submits one flat, exact terminal schema. This checks identities,
 * objective derivation, scoring arithmetic, and terminal invariants. It is an
 * arcade plausibility guard, not a server-authoritative replay.
 *
 * @param int   $score Submitted score.
 * @param mixed $meta  Sanitized metadata.
 * @return bool
 */
function popup_siege_validate_terminal_meta( $score, $meta ) {
	$keys = array(
		'brick_points',
		'bricks_destroyed',
		'bricks_total',
		'clear_bonus',
		'closed_popup_ids',
		'end_reason',
		'first_unfinished_objective_id',
		'lives_remaining',
		'mode',
		'objective_states',
		'popup_points',
		'popups_closed',
		'popups_total',
		'purge_points',
		'restored',
		'result',
		'rules_version',
		'seconds_remaining',
		'terminal_schema_version',
		'time',
	);
	if ( ! popup_siege_meta_has_exact_keys( $meta, $keys ) ) {
		return false;
	}

	$integer_keys = array(
		'terminal_schema_version',
		'rules_version',
		'time',
		'seconds_remaining',
		'lives_remaining',
		'bricks_destroyed',
		'bricks_total',
		'restored',
		'popups_closed',
		'popups_total',
		'brick_points',
		'popup_points',
		'purge_points',
		'clear_bonus',
	);
	foreach ( $integer_keys as $key ) {
		if ( ! popup_siege_is_nonnegative_integer( $meta[ $key ] ) ) {
			return false;
		}
	}

	if (
		$score < 0 ||
		$score > 15000 ||
		1 !== $meta['terminal_schema_version'] ||
		3 !== $meta['rules_version'] ||
		$meta['time'] > 99 ||
		$meta['seconds_remaining'] > 90 ||
		$meta['lives_remaining'] > 3 ||
		$meta['restored'] > 100 ||
		30 !== $meta['bricks_total'] ||
		4 !== $meta['popups_total'] ||
		$meta['popups_closed'] > 4 ||
		$meta['bricks_destroyed'] > 30 ||
		$meta['brick_points'] > 3960 ||
		$meta['purge_points'] > 4500 ||
		0 !== $meta['purge_points'] % 150 ||
		$meta['purge_points'] / 150 > $meta['bricks_destroyed'] ||
		! is_string( $meta['mode'] ) ||
		! in_array( $meta['mode'], array( 'Free Play', 'Challenge' ), true ) ||
		! is_string( $meta['result'] ) ||
		! in_array( $meta['result'], array( 'rescued', 'overrun' ), true ) ||
		! is_string( $meta['end_reason'] ) ||
		! in_array( $meta['end_reason'], array( 'archive-sweep', 'time', 'lives' ), true ) ||
		! is_string( $meta['closed_popup_ids'] ) ||
		! is_string( $meta['objective_states'] ) ||
		! is_string( $meta['first_unfinished_objective_id'] ) ||
		(int) round( ( $meta['bricks_destroyed'] / 30 ) * 100 ) !== $meta['restored']
	) {
		return false;
	}

	$popup_order = array( 'download', 'toolbar', 'casino', 'malware-boss' );
	$closed_ids  = '' === $meta['closed_popup_ids']
		? array()
		: explode( ',', $meta['closed_popup_ids'] );
	if (
		count( $closed_ids ) !== $meta['popups_closed'] ||
		count( array_unique( $closed_ids ) ) !== count( $closed_ids )
	) {
		return false;
	}

	$expected_closed_ids = array_values(
		array_filter(
			$popup_order,
			static function ( $id ) use ( $closed_ids ) {
				return in_array( $id, $closed_ids, true );
			}
		)
	);
	if ( $closed_ids !== $expected_closed_ids ) {
		return false;
	}

	$popup_values = array(
		'download'     => 750,
		'toolbar'      => 750,
		'casino'       => 750,
		'malware-boss' => 1100,
	);
	$popup_points = array_sum(
		array_map(
			static function ( $id ) use ( $popup_values ) {
				return $popup_values[ $id ];
			},
			$closed_ids
		)
	);
	if ( $meta['popup_points'] !== $popup_points ) {
		return false;
	}

	$objective_definitions = array(
		array( 'download-trap', array( 'download' ) ),
		array( 'toolbar-swarm', array( 'toolbar', 'casino' ) ),
		array( 'malware-boss', array( 'malware-boss' ) ),
		array( 'archive-sweep', array() ),
	);
	$objective_states      = array();
	$first_unfinished      = '';
	foreach ( $objective_definitions as $definition ) {
		list( $objective_id, $target_ids ) = $definition;
		$closed_count                      = count( array_intersect( $target_ids, $closed_ids ) );
		$total                             = max( 1, count( $target_ids ) );
		$complete                          = 'archive-sweep' === $objective_id
			? 'rescued' === $meta['result']
			: count( $target_ids ) === $closed_count;
		if ( ! $complete && '' === $first_unfinished ) {
			$first_unfinished = $objective_id;
		}
		$objective_states[] = sprintf(
			'%s:%s:%d/%d',
			$objective_id,
			$complete ? 'complete' : 'missed',
			$closed_count,
			$total
		);
	}
	if (
		implode( '|', $objective_states ) !== $meta['objective_states'] ||
		$first_unfinished !== $meta['first_unfinished_objective_id']
	) {
		return false;
	}

	$clear_bonus = 'rescued' === $meta['result']
		? $meta['seconds_remaining'] * 20 + $meta['lives_remaining'] * 500
		: 0;
	if (
		$meta['clear_bonus'] !== $clear_bonus ||
		$score !==
			$meta['brick_points'] +
			$meta['popup_points'] +
			$meta['purge_points'] +
			$meta['clear_bonus']
	) {
		return false;
	}

	if ( 'rescued' === $meta['result'] ) {
		return (
			'archive-sweep' === $meta['end_reason'] &&
			30 === $meta['bricks_destroyed'] &&
			4 === $meta['popups_closed'] &&
			$meta['lives_remaining'] >= 1 &&
			$meta['seconds_remaining'] <= 3
		);
	}

	if ( 'archive-sweep' === $meta['end_reason'] || 4 === $meta['popups_closed'] ) {
		return false;
	}

	if ( 'lives' === $meta['end_reason'] ) {
		return 0 === $meta['lives_remaining'];
	}

	return 90 === $meta['time'] && 0 === $meta['seconds_remaining'];
}

/**
 * Reject scores that do not satisfy Popup Siege's terminal contract.
 *
 * @param mixed  $pre     Existing short-circuit result.
 * @param string $game    Game id.
 * @param int    $user_id User id.
 * @param int    $score   Submitted score.
 * @param mixed  $meta    Sanitized score metadata.
 * @return mixed
 */
function popup_siege_validate_score( $pre, $game, $user_id, $score, $meta = null ) {
	unset( $user_id );

	if ( $pre instanceof WP_Error || 'popup-siege' !== $game ) {
		return $pre;
	}

	if ( $score < 0 || $score > 15000 ) {
		return new WP_Error(
			'popup_siege_implausible_score',
			__( 'That Popup Siege score is outside the expected range.', 'desktop-mode-popup-siege' )
		);
	}

	if ( ! popup_siege_validate_terminal_meta( $score, $meta ) ) {
		return new WP_Error(
			'popup_siege_invalid_terminal_meta',
			__( 'That Popup Siege result does not match the supported score contract.', 'desktop-mode-popup-siege' )
		);
	}

	return $pre;
}
