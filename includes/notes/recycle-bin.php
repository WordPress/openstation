<?php
/**
 * Desktop Mode — Pinned notes in the Recycle Bin.
 *
 * `wpd_note` is a headless CPT (`show_ui => false`), so the bin's
 * auto-capture of admin-UI post types skips it — this file opts it in
 * through the bin's existing filter pipeline and adapts the generic
 * post handling to the notes ownership model:
 *
 *   - OWNER-ONLY visibility. The bin's default gates use `edit_post`
 *     / `delete_post`, which (a) let administrators manage everyone's
 *     trashed notes (the live-notes REST controller deliberately does
 *     NOT allow that, and a private note's text should not surface in
 *     someone else's bin) and (b) lock out subscribers entirely (they
 *     hold no `edit_posts`-family caps, yet they own their notes).
 *     Both are replaced with a plain `post_author` check.
 *
 *   - Badge-count correction. The generic count buckets post types by
 *     the viewer's `edit_posts`/`edit_others_posts` caps, which counts
 *     other users' notes for editors/admins and zero notes for
 *     subscribers — both diverge from what the list shows. The count
 *     filter re-scopes the notes contribution to owned-only.
 *
 *   - A paper-flavored row: sticky-note icon, "Note" label, and the
 *     note text as the subtitle.
 *
 * Restoring from the bin runs `wp_untrash_post()`, so the
 * `wp_untrash_post_status` filter in `cpt.php` brings the note back
 * with its original private/publish status, and the Heartbeat delta
 * re-pins it on the wall without a reload.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Opt `wpd_note` into the recycle bin's capture list.
 *
 * @param string[] $types Tracked post types.
 * @return string[]
 */
function desktop_mode_notes_recycle_bin_capture_types( $types ) {
	$types   = (array) $types;
	$types[] = DESKTOP_MODE_NOTES_POST_TYPE;
	return $types;
}
add_filter( 'desktop_mode_recycle_bin_capture_post_types', 'desktop_mode_notes_recycle_bin_capture_types' );

/**
 * Whether a trashed post is a note owned by the current user.
 *
 * @param WP_Post $post Trashed post.
 * @return bool
 */
function desktop_mode_notes_recycle_bin_owns( $post ) {
	return (int) $post->post_author === get_current_user_id();
}

/**
 * Owner-only view/restore/purge for notes — replaces the bin's
 * default `edit_post`/`delete_post` gates for this post type.
 *
 * @param bool    $can  The bin's default answer.
 * @param WP_Post $post Trashed post.
 * @return bool
 */
function desktop_mode_notes_recycle_bin_gate( $can, $post ) {
	if ( DESKTOP_MODE_NOTES_POST_TYPE !== $post->post_type ) {
		return $can;
	}
	return desktop_mode_notes_recycle_bin_owns( $post );
}
add_filter( 'desktop_mode_recycle_bin_user_can_view', 'desktop_mode_notes_recycle_bin_gate', 10, 2 );
add_filter( 'desktop_mode_recycle_bin_user_can_restore', 'desktop_mode_notes_recycle_bin_gate', 10, 2 );
add_filter( 'desktop_mode_recycle_bin_user_can_purge', 'desktop_mode_notes_recycle_bin_gate', 10, 2 );

/**
 * Paper-flavored row shape for trashed notes.
 *
 * @param array   $item Bin item shape.
 * @param WP_Post $post Source post.
 * @return array
 */
function desktop_mode_notes_recycle_bin_item( $item, $post ) {
	if ( DESKTOP_MODE_NOTES_POST_TYPE !== $post->post_type ) {
		return $item;
	}
	$item['type_label'] = __( 'Note', 'desktop-mode' );
	$item['icon']       = 'dashicons-sticky';
	$item['subtitle']   = wp_trim_words( desktop_mode_recycle_bin_plain_text( (string) $post->post_content ), 18, '…' );
	// Notes have no admin edit screen — a chromeless post.php iframe
	// would 403 on the headless CPT.
	$item['edit_link'] = '';

	// "Deleted by" fallback. The bin's who-deleted stamp is written at
	// trash time, so notes trashed before wpd_note joined the capture
	// list (or trashed with no logged-in user: WP-CLI, cron) have none.
	// For notes the owner is the only principal who can trash, so
	// attributing an unstamped row to the author is correct by
	// construction. Display-time only — nothing is written back.
	if ( '' === (string) $item['deleted_by'] ) {
		$owner = get_userdata( (int) $post->post_author );
		if ( $owner instanceof WP_User ) {
			$item['deleted_by']    = $owner->display_name;
			$item['deleted_by_id'] = (int) $post->post_author;
		}
	}

	return $item;
}
add_filter( 'desktop_mode_recycle_bin_item', 'desktop_mode_notes_recycle_bin_item', 10, 2 );

/**
 * Number of trashed notes for a given scope.
 *
 * @param int|null $author_id Scope to one author, or null for all.
 * @return int
 */
function desktop_mode_notes_recycle_bin_trashed_count( $author_id = null ) {
	$args = array(
		'post_type'      => DESKTOP_MODE_NOTES_POST_TYPE,
		'post_status'    => 'trash',
		'posts_per_page' => 1,
		'fields'         => 'ids',
		'no_found_rows'  => false,
	);
	if ( null !== $author_id ) {
		$args['author'] = (int) $author_id;
	}
	$query = new WP_Query( $args );
	return (int) $query->found_posts;
}

/**
 * Re-scope the badge count's notes contribution to owned-only, so
 * the badge always matches what the (owner-gated) list shows.
 *
 * The generic count already included: ALL trashed notes for users
 * holding `edit_others_posts`, OWN trashed notes for `edit_posts`
 * holders, and none for anyone else. Normalize every case to "own
 * trashed notes".
 *
 * @param int $total Generic total.
 * @return int
 */
function desktop_mode_notes_recycle_bin_count( $total ) {
	$total = (int) $total;
	$own   = desktop_mode_notes_recycle_bin_trashed_count( get_current_user_id() );

	if ( current_user_can( 'edit_others_posts' ) ) {
		// Counted everyone's notes; keep only ours.
		$total = $total - desktop_mode_notes_recycle_bin_trashed_count() + $own;
	} elseif ( ! current_user_can( 'edit_posts' ) ) {
		// Counted none of ours; add them.
		$total = $total + $own;
	}
	// `edit_posts`-only users were already counted author-scoped.

	return max( 0, $total );
}
add_filter( 'desktop_mode_recycle_bin_count', 'desktop_mode_notes_recycle_bin_count' );
