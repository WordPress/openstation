<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_RECYCLE_BIN_CHANGE_OPTION = '_desktop_mode_recycle_bin_change_ts';

function openstation_recycle_bin_request_dirty( $set = null ) {
	static $dirty = false;
	if ( null !== $set ) {
		$dirty = (bool) $set;
	}
	return $dirty;
}

function openstation_recycle_bin_signal_change() {
	$ts = (int) round( microtime( true ) * 1000 );
	update_option( OPENSTATION_RECYCLE_BIN_CHANGE_OPTION, $ts, false );
	openstation_recycle_bin_request_dirty( true );

	do_action( 'openstation_recycle_bin_signal', $ts );
}

function openstation_recycle_bin_signal_change_for_post( $post_id, $action = 'trashed' ) {
	$post = get_post( $post_id );
	if ( $post instanceof WP_Post ) {
		openstation_recycle_bin_record_change( (string) $post->post_type, (int) $post_id, (string) $action );
	}
	openstation_recycle_bin_signal_change();
}

function openstation_recycle_bin_record_change( $post_type = '', $post_id = 0, $action = '' ) {
	if ( '' !== $post_type ) {
		openstation_content_changes_record( (string) $post_type, (int) $post_id, (string) $action );
	}
	return openstation_content_changes_log();
}

function openstation_recycle_bin_should_emit_footer_signal() {
	if ( ! function_exists( 'openstation_is_chromeless_request' ) ) {
		return false;
	}
	if ( ! openstation_is_chromeless_request() ) {
		return false;
	}

	return (bool) apply_filters( 'openstation_recycle_bin_emit_footer_signal', true );
}

function openstation_recycle_bin_emit_footer_signal() {
	if ( ! openstation_recycle_bin_should_emit_footer_signal() ) {
		return;
	}

	$ts = (int) get_option( OPENSTATION_RECYCLE_BIN_CHANGE_OPTION, 0 );

	if ( $ts <= 0 ) {

		return;
	}

	?>
	<script id="os-recycle-bin-realtime-signal">
		( function () {
			if ( window.parent === window ) {
				return;
			}
			try {
				window.parent.postMessage(
					{
						type: 'os-recycle-bin-changed',
						ts: <?php echo (int) $ts; ?>,
						source: 'chromeless'
					},
					window.location.origin
				);
			} catch ( _err ) {               }
		} )();
	</script>
	<?php
}

function openstation_recycle_bin_heartbeat_received( $response, $data ) {
	if ( ! is_array( $response ) ) {
		$response = array();
	}
	if ( ! isset( $data['openstation_recycle_bin_seen_ts'] ) ) {
		return $response;
	}
	if ( function_exists( 'openstation_recycle_bin_user_can_use' ) && ! openstation_recycle_bin_user_can_use() ) {
		return $response;
	}

	$seen    = (int) $data['openstation_recycle_bin_seen_ts'];
	$latest  = (int) get_option( OPENSTATION_RECYCLE_BIN_CHANGE_OPTION, 0 );
	$changed = $latest > $seen;

	$response['openstation_recycle_bin'] = array(
		'changed' => $changed,
		'ts'      => $latest,
	);

	if ( $changed ) {
		$response['openstation_recycle_bin']['count'] = openstation_recycle_bin_count();
	}

	return $response;
}

function openstation_recycle_bin_register_realtime_hooks() {
	add_action(
		'wp_trash_post',
		function ( $post_id ) {
			openstation_recycle_bin_signal_change_for_post( $post_id, 'trashed' );
		}
	);
	add_action(
		'untrash_post',
		function ( $post_id ) {
			openstation_recycle_bin_signal_change_for_post( $post_id, 'untrashed' );
		}
	);
	add_action(
		'before_delete_post',
		function ( $post_id ) {
			openstation_recycle_bin_signal_change_for_post( $post_id, 'deleted' );
		}
	);

	add_action(
		'trashed_comment',
		function ( $comment_id ) {
			openstation_recycle_bin_record_change( 'comment', (int) $comment_id, 'trashed' );
			openstation_recycle_bin_signal_change();
		}
	);
	add_action(
		'untrashed_comment',
		function ( $comment_id ) {
			openstation_recycle_bin_record_change( 'comment', (int) $comment_id, 'untrashed' );
			openstation_recycle_bin_signal_change();
		}
	);
	add_action(
		'deleted_comment',
		function ( $comment_id ) {
			openstation_recycle_bin_record_change( 'comment', (int) $comment_id, 'deleted' );
			openstation_recycle_bin_signal_change();
		}
	);

	add_action( 'openstation_recycle_bin_item_captured', 'openstation_recycle_bin_signal_change' );
	add_action( 'openstation_recycle_bin_after_restore', 'openstation_recycle_bin_signal_change' );
	add_action( 'openstation_recycle_bin_after_purge', 'openstation_recycle_bin_signal_change' );
	add_action( 'openstation_recycle_bin_emptied', 'openstation_recycle_bin_signal_change' );

	add_action( 'admin_footer', 'openstation_recycle_bin_emit_footer_signal', 100 );

	add_filter( 'heartbeat_received', 'openstation_recycle_bin_heartbeat_received', 10, 2 );
}
add_action( 'init', 'openstation_recycle_bin_register_realtime_hooks', 5 );
