<?php
/**
 * Desktop Mode — Recycle Bin: capture.
 *
 * Intercepts media deletion so attachments are routed to the WordPress
 * trash instead of being permanently deleted on first call. Posts and
 * pages already use the trash by default — this file's job is to bring
 * media in line so the Recycle Bin window has something to show.
 *
 * The interception is filterable end-to-end:
 *
 *   - `desktop_mode_recycle_bin_should_capture` decides whether a given
 *     attachment is captured at all (capability gates, plugin opt-out).
 *   - `desktop_mode_recycle_bin_capture_post_types` controls which post
 *     types we listen for in the first place.
 *   - The `desktop_mode_recycle_bin_item_captured` action fires after a
 *     successful capture so plugins can mirror the event (audit log,
 *     external storage, etc.).
 *
 * @package WPDesktopMode
 * @since   0.19.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Default list of post types the recycle bin is willing to capture.
 *
 * Posts and pages already trash by default; the value of capturing them
 * here is consistency: every "deleted" thing flows through the same
 * filter pipeline, so a plugin that wants a single audit log can
 * subscribe once.
 *
 * @since 0.19.0
 *
 * @return string[]
 */
function desktop_mode_recycle_bin_capture_post_types() {
	$types = array( 'post', 'page', 'attachment' );

	/**
	 * Filter the post types the recycle bin tracks.
	 *
	 * Returning a list excluding `attachment` disables the soft-delete
	 * interception entirely — vanilla WordPress media deletion resumes.
	 *
	 * @since 0.19.0
	 *
	 * @param string[] $types Post types whose deletions the recycle bin tracks.
	 */
	$types = apply_filters( 'desktop_mode_recycle_bin_capture_post_types', $types );

	return array_values( array_filter( array_map( 'strval', (array) $types ) ) );
}

/**
 * Whether the recycle bin should capture a given attachment.
 *
 * Returning `false` from the `desktop_mode_recycle_bin_should_capture`
 * filter restores vanilla `wp_delete_attachment()` semantics for that
 * single call — useful for "really delete now" admin flows.
 *
 * @since 0.19.0
 *
 * @param WP_Post $post  Attachment post object.
 * @param bool    $force Whether `wp_delete_attachment( $id, true )` was used.
 * @return bool
 */
function desktop_mode_recycle_bin_should_capture_attachment( $post, $force ) {
	// Honor explicit force-delete: that's the user (or a plugin) saying
	// "skip the bin." Same contract as posts.
	if ( $force ) {
		return false;
	}

	if ( ! in_array( 'attachment', desktop_mode_recycle_bin_capture_post_types(), true ) ) {
		return false;
	}

	/**
	 * Filter whether a specific attachment should be soft-deleted into
	 * the recycle bin instead of being permanently deleted.
	 *
	 * @since 0.19.0
	 *
	 * @param bool    $capture Default true.
	 * @param WP_Post $post    Attachment being deleted.
	 */
	return (bool) apply_filters( 'desktop_mode_recycle_bin_should_capture', true, $post );
}

/**
 * Short-circuits `wp_delete_attachment()` to route the attachment
 * through the trash instead.
 *
 * Returning a non-null value from the `pre_delete_attachment` filter
 * tells core to skip its delete codepath and use our return value as
 * the function result. We call `wp_trash_post()`, stash a marker so
 * the bin knows when it was deleted and by whom, and return the
 * trashed post object — same shape `wp_delete_attachment()` would.
 *
 * @since 0.19.0
 *
 * @param mixed   $delete Default null (continue with deletion).
 * @param WP_Post $post   Attachment about to be deleted.
 * @param bool    $force  Whether force-delete was requested.
 * @return mixed Non-null short-circuits core deletion.
 */
function desktop_mode_recycle_bin_intercept_attachment_delete( $delete, $post, $force ) {
	if ( null !== $delete ) {
		// Another plugin already short-circuited — don't double-handle.
		return $delete;
	}

	if ( ! ( $post instanceof WP_Post ) || 'attachment' !== $post->post_type ) {
		return $delete;
	}

	if ( ! desktop_mode_recycle_bin_should_capture_attachment( $post, $force ) ) {
		return $delete;
	}

	$trashed = wp_trash_post( $post->ID );
	if ( ! $trashed ) {
		// Trash failed — let core try its normal deletion so we don't
		// silently drop the user's request on the floor.
		return $delete;
	}

	desktop_mode_recycle_bin_record_capture( $post->ID );

	return $trashed;
}

/**
 * Mirror the capture for posts/pages so the bin has a uniform record
 * of "who deleted this and when."
 *
 * Core's `wp_trash_post_meta` is set on every trash but it doesn't
 * include the user id — we stash that ourselves under a private meta
 * key so the table can show "deleted by Alice".
 *
 * @since 0.19.0
 *
 * @param int $post_id Post being trashed.
 */
function desktop_mode_recycle_bin_on_trash_post( $post_id ) {
	$post = get_post( $post_id );
	if ( ! $post ) {
		return;
	}
	if ( ! in_array( $post->post_type, desktop_mode_recycle_bin_capture_post_types(), true ) ) {
		return;
	}
	desktop_mode_recycle_bin_record_capture( $post_id );
}

/**
 * Persist who-deleted-what-when metadata for a single item.
 *
 * Stored under `_desktop_mode_trash_*` postmeta on the trashed post itself —
 * survives un-trash naturally because we only consult it while in the
 * bin, and gets cleaned up by core when the post is permanently
 * deleted via the standard postmeta cascade.
 *
 * @since 0.19.0
 *
 * @param int $post_id Post id being captured.
 */
function desktop_mode_recycle_bin_record_capture( $post_id ) {
	$user_id = get_current_user_id();
	$now_gmt = current_time( 'mysql', true );

	update_post_meta( $post_id, '_desktop_mode_trash_user_id', (int) $user_id );
	update_post_meta( $post_id, '_desktop_mode_trash_time_gmt', $now_gmt );

	/**
	 * Fires after the recycle bin records a capture.
	 *
	 * Use this to mirror the event into an external audit log or to
	 * extend the captured payload with custom postmeta.
	 *
	 * @since 0.19.0
	 *
	 * @param int    $post_id Post id that was captured.
	 * @param int    $user_id User id who triggered the capture.
	 * @param string $now_gmt MySQL-format GMT timestamp.
	 */
	do_action( 'desktop_mode_recycle_bin_item_captured', $post_id, $user_id, $now_gmt );
}

add_filter( 'pre_delete_attachment', 'desktop_mode_recycle_bin_intercept_attachment_delete', 10, 3 );
add_action( 'wp_trash_post', 'desktop_mode_recycle_bin_on_trash_post', 10, 1 );

/**
 * Capture deleted-by metadata for comments — symmetric to
 * `desktop_mode_recycle_bin_record_capture` but writing to `commentmeta`
 * instead of `postmeta`. Comments use `wp_set_comment_status('trash')`
 * which fires `trashed_comment`; we don't need to short-circuit
 * anything (core already routes to a real trash status), just
 * stamp the moment so the bin can show "by Alice, 5 minutes ago".
 *
 * @since 0.21.0
 *
 * @param int $comment_id Comment about to be trashed.
 */
function desktop_mode_recycle_bin_on_trash_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = get_current_user_id();
	$now_gmt    = current_time( 'mysql', true );

	update_comment_meta( $comment_id, '_desktop_mode_trash_user_id', $user_id );
	update_comment_meta( $comment_id, '_desktop_mode_trash_time_gmt', $now_gmt );

	/**
	 * Fires after the recycle bin records a comment capture.
	 *
	 * @since 0.21.0
	 *
	 * @param int    $comment_id Comment id that was captured.
	 * @param int    $user_id    User id who triggered the capture.
	 * @param string $now_gmt    MySQL-format GMT timestamp.
	 */
	do_action( 'desktop_mode_recycle_bin_comment_captured', $comment_id, $user_id, $now_gmt );
}
add_action( 'trashed_comment', 'desktop_mode_recycle_bin_on_trash_comment', 10, 1 );
