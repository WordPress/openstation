<?php
/**
 * OpenStation — My WordPress: post-lock REST field.
 *
 * Surfaces "is this post currently being edited by someone else?"
 * on every post / page / opt-in CPT REST response so the My WordPress
 * file-explorer can show a lock icon + the locking user's name on
 * the tile label without an extra round-trip.
 *
 * Core stores the lock as `_edit_lock` post meta with the shape
 * `<timestamp>:<user_id>`. `wp_check_post_lock()` is the canonical
 * read — it parses the meta, applies the `wp_check_post_lock_window`
 * filter (default 150 s), and returns the locking user id or `false`.
 * We expose the same intelligence as a structured field, gated on
 * `edit_post` so users who can't edit the post never see who else is
 * editing it.
 *
 * The field name is `openstation_lock`; shape:
 *
 *   - `null` — not locked, OR the requester lacks edit caps.
 *   - `{ userId, userName, userAvatarUrl, time }` — locked by another
 *     user. `time` is the ISO-8601 timestamp of the lock heartbeat.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Compute the lock payload for a post.
 *
 * Returns `null` when:
 *   - The post isn't locked.
 *   - The current user is the lock holder (no point flagging yourself).
 *   - The current user can't edit the post (don't leak who's editing).
 *
 * @param int $post_id Post id.
 * @return array{userId:int,userName:string,userAvatarUrl:string,time:string}|null
 */
function openstation_my_wordpress_post_lock_payload( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return null;
	}

	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return null;
	}

	require_once ABSPATH . 'wp-admin/includes/post.php';
	$lock_user_id = wp_check_post_lock( $post_id );
	if ( ! $lock_user_id ) {
		return null;
	}

	$user = get_userdata( (int) $lock_user_id );
	if ( ! $user ) {
		return null;
	}

	// Read the raw meta to surface the heartbeat timestamp — useful
	// in tooltips ("locked 8 seconds ago").
	$raw       = (string) get_post_meta( $post_id, '_edit_lock', true );
	$timestamp = 0;
	if ( '' !== $raw && false !== strpos( $raw, ':' ) ) {
		list( $timestamp ) = explode( ':', $raw );
		$timestamp         = (int) $timestamp;
	}

	$avatar = get_avatar_url( $user->ID, array( 'size' => 48 ) );

	return array(
		'userId'        => (int) $user->ID,
		'userName'      => (string) $user->display_name,
		'userAvatarUrl' => is_string( $avatar ) ? $avatar : '',
		'time'          => $timestamp > 0 ? gmdate( 'c', $timestamp ) : '',
	);
}

/**
 * Compute the contributor list for a post. Returns an array of
 * structured user shapes (one per user) so the JS side can paint
 * tiles directly without an extra `/wp/v2/users/<id>` round-trip
 * per row.
 *
 * Sources, merged in order:
 *   1. Co-Authors Plus, when installed — `get_coauthors()` returns
 *      user objects (or guest authors with a different shape).
 *   2. Revision authors — everyone who has saved the post leaves a
 *      revision row stamped with their user id.
 *   3. The `_edit_last` post meta — who saved the post most
 *      recently; the only signal on installs with revisions
 *      disabled.
 *   4. Anything plugins return from the
 *      `openstation_my_wordpress_post_contributors` filter, which
 *      receives the post id + the running user-id list. Filter
 *      contract is plain int[] for ergonomics; we expand each id
 *      into the structured shape afterwards.
 *
 * Gated on `edit_post`, same as the lock payload above — returns an
 * empty array for users who can't edit the post, so revision-author
 * identities never leak to read-only viewers.
 *
 * The post's `post_author` is intentionally NOT included here —
 * it's already surfaced by the canonical "Author" sub-folder.
 * Contributors is the *additional* people surface.
 *
 * @param int $post_id Post id.
 * @return array<int,array{userId:int,userName:string,userAvatarUrl:string}>
 */
function openstation_my_wordpress_post_contributors_payload( $post_id ) {
	$post_id = (int) $post_id;
	if ( $post_id <= 0 ) {
		return array();
	}

	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return array();
	}

	$post = get_post( $post_id );
	if ( ! $post ) {
		return array();
	}

	$primary_author_id = (int) $post->post_author;
	$ids               = array();

	// Co-Authors Plus, when active. `get_coauthors()` returns a list
	// that can mix `WP_User`s with guest-author objects (which have
	// no `ID` and aren't WP users). We only collect real users; CAP
	// guest authors are out of scope today (their avatar/edit URL
	// shape is plugin-specific and would force an extra abstraction
	// layer that doesn't pay for itself in Phase 1).
	if ( function_exists( 'get_coauthors' ) ) {
		$coauthors = get_coauthors( $post_id );
		foreach ( (array) $coauthors as $user ) {
			if ( $user instanceof WP_User ) {
				$ids[] = (int) $user->ID;
			} elseif ( is_object( $user ) && isset( $user->ID ) ) {
				$ids[] = (int) $user->ID;
			}
		}
	}

	// Revision authors — every user who has hit Save / Update on
	// this post leaves a revision row, and core stamps each
	// revision's `post_author` with the editing user. Walking the
	// revision list is therefore the canonical "who has edited this
	// post" answer without any plugin or extra meta. We dedupe
	// against the primary author below so the post owner doesn't
	// double-count.
	$revision_ids = wp_get_post_revisions(
		$post_id,
		array(
			'fields'      => 'ids',
			// `posts_per_page = -1` so a long history doesn't truncate.
			// The list is naturally bounded by core's revision retention
			// filter (`wp_revisions_to_keep`), typically `5` to `unlimited`.
			'numberposts' => -1,
		)
	);
	foreach ( (array) $revision_ids as $rev_id ) {
		$rev = get_post( $rev_id );
		if ( $rev ) {
			$ids[] = (int) $rev->post_author;
		}
	}

	// `_edit_last` is core's "who saved this post most recently"
	// post meta, set by `wp_update_post()`. On installs where
	// revisions are disabled (or pruned aggressively) this is the
	// only signal that a non-author user ever touched the row.
	$edit_last = (int) get_post_meta( $post_id, '_edit_last', true );
	if ( $edit_last > 0 ) {
		$ids[] = $edit_last;
	}

	/**
	 * Filter the list of contributor user ids for a post.
	 *
	 * Plugins that track contributors via custom meta, a taxonomy,
	 * a join table, or any other mechanism wire their source in
	 * here. Each id should resolve to a `WP_User`; non-resolving
	 * ids are silently dropped.
	 *
	 * Examples:
	 *
	 * ```php
	 * // ACF user-list field "post_contributors":
	 * add_filter( 'openstation_my_wordpress_post_contributors',
	 *     function ( $ids, $post_id ) {
	 *         $extra = (array) get_field( 'post_contributors', $post_id );
	 *         foreach ( $extra as $u ) {
	 *             if ( $u instanceof WP_User ) {
	 *                 $ids[] = $u->ID;
	 *             } elseif ( is_numeric( $u ) ) {
	 *                 $ids[] = (int) $u;
	 *             }
	 *         }
	 *         return $ids;
	 *     }, 10, 2 );
	 * ```
	 *
	 * @param int[] $ids     Contributor user ids gathered so far
	 *                       (from Co-Authors Plus, etc.).
	 * @param int   $post_id Post id.
	 */
	$ids = (array) apply_filters( 'openstation_my_wordpress_post_contributors', $ids, $post_id );

	// De-duplicate, drop the primary author so the Contributors
	// sub-folder only carries *additional* people, drop empty/0,
	// and resolve to user records.
	$out  = array();
	$seen = array();
	foreach ( $ids as $id ) {
		$id = (int) $id;
		if ( $id <= 0 ) {
			continue;
		}
		if ( $id === $primary_author_id ) {
			continue;
		}
		if ( isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$user        = get_userdata( $id );
		if ( ! $user ) {
			continue;
		}
		$avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) );
		$out[]  = array(
			'userId'        => (int) $user->ID,
			'userName'      => (string) $user->display_name,
			'userAvatarUrl' => is_string( $avatar ) ? $avatar : '',
		);
	}
	return $out;
}

/**
 * Register the REST fields on every post type the site window can
 * browse — public REST-exposed types plus the ones bridged under
 * `desktop-mode/v1`. Posts and pages cover the Phase 1 surface; CPTs
 * come along for free.
 *
 * Two fields:
 *   - `openstation_lock`         — active edit-lock holder.
 *   - `openstation_contributors` — additional contributor users
 *                                   beyond the primary author.
 */
function openstation_my_wordpress_register_lock_field() {
	$types = openstation_my_wordpress_rest_field_post_types();

	foreach ( $types as $type ) {
		register_rest_field(
			$type,
			'openstation_lock',
			array(
				'get_callback' => static function ( $post ) {
					$post_id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return openstation_my_wordpress_post_lock_payload( $post_id );
				},
				'schema'       => array(
					'description' => __( 'Active edit-lock holder, or null when the post is not locked.', 'desktop-mode' ),
					'type'        => array( 'object', 'null' ),
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
					'properties'  => array(
						'userId'        => array( 'type' => 'integer' ),
						'userName'      => array( 'type' => 'string' ),
						'userAvatarUrl' => array( 'type' => 'string' ),
						'time'          => array( 'type' => 'string' ),
					),
				),
			)
		);

		register_rest_field(
			$type,
			'openstation_contributors',
			array(
				'get_callback' => static function ( $post ) {
					$post_id = isset( $post['id'] ) ? (int) $post['id'] : 0;
					return openstation_my_wordpress_post_contributors_payload( $post_id );
				},
				'schema'       => array(
					'description' => __( 'Additional contributor users beyond the primary author. Sourced from Co-Authors Plus when present, revision authors, the `_edit_last` meta, plus anything plugins return via `openstation_my_wordpress_post_contributors`. Empty for requesters who cannot edit the post.', 'desktop-mode' ),
					'type'        => 'array',
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
					'items'       => array(
						'type'       => 'object',
						'properties' => array(
							'userId'        => array( 'type' => 'integer' ),
							'userName'      => array( 'type' => 'string' ),
							'userAvatarUrl' => array( 'type' => 'string' ),
						),
					),
				),
			)
		);
	}
}
add_action( 'rest_api_init', 'openstation_my_wordpress_register_lock_field' );
