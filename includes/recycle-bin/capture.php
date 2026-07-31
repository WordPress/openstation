<?php
/**
 * Desktop Mode — Recycle Bin: capture.
 *
 * Stamps "who-deleted-what-when" metadata onto posts, pages, and
 * comments as they pass through `wp_trash_post()` / `trashed_comment`,
 * so the Recycle Bin window can show "deleted by Alice, 5 minutes ago"
 * without a second roundtrip.
 *
 * Media attachments are NOT auto-routed through Trash — they follow
 * vanilla WordPress behavior (permanent-delete on first click). To
 * enable trash for media, define `MEDIA_TRASH` as `true` in
 * `wp-config.php`; the Recycle Bin window will surface trashed
 * attachments automatically because `attachment` is in the default
 * `desktop_mode_recycle_bin_capture_post_types` list.
 *
 *   - `desktop_mode_recycle_bin_capture_post_types` controls which post
 *     types we listen for in the first place.
 *   - The `desktop_mode_recycle_bin_item_captured` action fires after a
 *     successful capture so plugins can mirror the event (audit log,
 *     external storage, etc.).
 *
 * @package WPDesktopMode
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
 * Custom post types with an admin UI (`show_ui`, non-builtin) are
 * included by default — a trashed WooCommerce product or
 * portfolio entry belongs in the site-wide bin just as much as a
 * post does. Visibility stays safe because every row is still gated
 * per-item on `edit_post` before it is listed. Headless CPTs
 * (`show_ui => false`, e.g. the pinned-notes `wpd_note`) stay out
 * unless their owning feature opts in via the filter.
 *
 * @return string[]
 */
function desktop_mode_recycle_bin_capture_post_types() {
	$types = array( 'post', 'page', 'attachment' );

	$custom = get_post_types(
		array(
			'show_ui'  => true,
			'_builtin' => false,
		),
		'names'
	);
	$types  = array_merge( $types, array_values( (array) $custom ) );

	/**
	 * Filter the post types the recycle bin tracks.
	 *
	 * Returning a list excluding `attachment` stops the bin from
	 * stamping and listing trashed attachments; it does not change how
	 * WordPress deletes media (that is governed by `MEDIA_TRASH`).
	 * Remove a custom post type here to keep its trash out of the bin,
	 * or add a headless (`show_ui => false`) type to opt it in.
	 *
	 * @param string[] $types Post types whose deletions the recycle bin tracks.
	 */
	$types = apply_filters( 'desktop_mode_recycle_bin_capture_post_types', $types );

	return array_values( array_unique( array_filter( array_map( 'strval', (array) $types ) ) ) );
}

/**
 * Mirror the capture for posts/pages so the bin has a uniform record
 * of "who deleted this and when."
 *
 * Core's `wp_trash_post_meta` is set on every trash but it doesn't
 * include the user id — we stash that ourselves under a private meta
 * key so the table can show "deleted by Alice".
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
	 * @param int    $post_id Post id that was captured.
	 * @param int    $user_id User id who triggered the capture.
	 * @param string $now_gmt MySQL-format GMT timestamp.
	 */
	do_action( 'desktop_mode_recycle_bin_item_captured', $post_id, $user_id, $now_gmt );
}

add_action( 'wp_trash_post', 'desktop_mode_recycle_bin_on_trash_post', 10, 1 );

/**
 * Capture deleted-by metadata for comments — symmetric to
 * `desktop_mode_recycle_bin_record_capture` but writing to `commentmeta`
 * instead of `postmeta`. Comments use `wp_set_comment_status('trash')`
 * which fires `trashed_comment`; we don't need to short-circuit
 * anything (core already routes to a real trash status), just
 * stamp the moment so the bin can show "by Alice, 5 minutes ago".
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
	 * @param int    $comment_id Comment id that was captured.
	 * @param int    $user_id    User id who triggered the capture.
	 * @param string $now_gmt    MySQL-format GMT timestamp.
	 */
	do_action( 'desktop_mode_recycle_bin_comment_captured', $comment_id, $user_id, $now_gmt );
}
add_action( 'trashed_comment', 'desktop_mode_recycle_bin_on_trash_comment', 10, 1 );
