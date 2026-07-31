<?php
/**
 * Desktop Mode — Content Graph: REST routes.
 *
 * Three endpoints under `desktop-mode/v1/content-graph`:
 *
 *   GET /post-types
 *     Lists the types eligible for the graph (`slug`, `label`, `icon`,
 *     `count`, `taxonomies`).
 *
 *   GET /nodes?types=post,page,...
 *     Returns the full `{ nodes, edges, stats }` tuple. Cached server-
 *     side, see graph-builder.php.
 *
 *   GET /post/<id>
 *     Returns the side-panel detail bundle for one post:
 *       { post: {...}, author, contributors, comments, categories,
 *         attached_media, revisions }.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Capability check shared across every endpoint.
 *
 * @return bool
 */
function desktop_mode_content_graph_rest_permission() {
	return desktop_mode_content_graph_user_can_use();
}

/**
 * Register the routes.
 */
function desktop_mode_content_graph_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/content-graph/post-types',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_content_graph_rest_post_types',
			'permission_callback' => 'desktop_mode_content_graph_rest_permission',
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/content-graph/nodes',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_content_graph_rest_nodes',
			'permission_callback' => 'desktop_mode_content_graph_rest_permission',
			'args'                => array(
				'types' => array(
					'description' => 'Comma-separated list of post type slugs to include.',
					'type'        => 'string',
					'default'     => '',
				),
			),
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/content-graph/post/(?P<id>\d+)',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'desktop_mode_content_graph_rest_post_detail',
			'permission_callback' => 'desktop_mode_content_graph_rest_permission',
			'args'                => array(
				'id' => array(
					'type'     => 'integer',
					'required' => true,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_content_graph_register_routes' );

/**
 * GET /post-types
 *
 * @return WP_REST_Response
 */
function desktop_mode_content_graph_rest_post_types() {
	$types = desktop_mode_content_graph_post_types();
	$out   = array();
	foreach ( $types as $entry ) {
		$slug = isset( $entry['slug'] ) ? (string) $entry['slug'] : '';
		// 'readable' scopes the private bucket to posts the current
		// user can actually read (others' private posts require the
		// type's read_private_posts capability), keeping the filter-bar
		// counts consistent with the rows /nodes returns.
		$counts = $slug ? wp_count_posts( $slug, 'readable' ) : null;
		$count  = 0;
		if ( $counts && isset( $counts->publish ) ) {
			$count = (int) $counts->publish;
			if ( isset( $counts->private ) ) {
				$count += (int) $counts->private;
			}
		}
		$out[] = array(
			'slug'       => $slug,
			'label'      => isset( $entry['label'] ) ? (string) $entry['label'] : $slug,
			'icon'       => isset( $entry['icon'] ) ? (string) $entry['icon'] : 'dashicons-admin-post',
			'count'      => $count,
			'taxonomies' => $entry['taxonomies'],
		);
	}
	return rest_ensure_response( $out );
}

/**
 * GET /nodes
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function desktop_mode_content_graph_rest_nodes( WP_REST_Request $request ) {
	$raw   = (string) $request->get_param( 'types' );
	$types = '' === $raw
		? wp_list_pluck( desktop_mode_content_graph_post_types(), 'slug' )
		: array_map( 'trim', explode( ',', $raw ) );
	$payload = desktop_mode_content_graph_build( (array) $types );
	return rest_ensure_response( desktop_mode_content_graph_filter_payload_for_user( $payload ) );
}

/**
 * Strip revision-derived data the current user may not see from a
 * graph payload before it goes out.
 *
 * Revision authorship is edit-level data in core (wp/v2 exposes a
 * post's revisions only behind `edit_post`), so each node's
 * `contributor_ids` — distinct revision authors — are emptied for
 * posts the user cannot `edit_post`. Authors-catalog entries that
 * were referenced only via stripped contributor ids are removed too.
 * This runs at response time, not build time, because the cached
 * payload is shared across users of the same privilege tier.
 *
 * @param array $payload Payload from `desktop_mode_content_graph_build()`.
 * @return array
 */
function desktop_mode_content_graph_filter_payload_for_user( array $payload ) {
	if ( empty( $payload['nodes'] ) || ! is_array( $payload['nodes'] ) ) {
		return $payload;
	}

	// Bulk-warm the post cache for the cap checks — only nodes that
	// actually carry contributor ids need an edit_post decision.
	$check_ids = array();
	foreach ( $payload['nodes'] as $node ) {
		if ( ! empty( $node['contributor_ids'] ) && ! empty( $node['id'] ) ) {
			$check_ids[] = (int) $node['id'];
		}
	}
	if ( ! empty( $check_ids ) && function_exists( '_prime_post_caches' ) ) {
		_prime_post_caches( $check_ids, false, false );
	}

	$referenced = array();
	foreach ( $payload['nodes'] as $i => $node ) {
		$id       = isset( $node['id'] ) ? (int) $node['id'] : 0;
		$contribs = isset( $node['contributor_ids'] ) && is_array( $node['contributor_ids'] )
			? $node['contributor_ids']
			: array();
		if ( ! empty( $contribs ) && ! current_user_can( 'edit_post', $id ) ) {
			$contribs                                  = array();
			$payload['nodes'][ $i ]['contributor_ids'] = array();
		}
		$author_id = isset( $node['author_id'] ) ? (int) $node['author_id'] : 0;
		if ( $author_id > 0 ) {
			$referenced[ $author_id ] = true;
		}
		foreach ( $contribs as $cid ) {
			if ( (int) $cid > 0 ) {
				$referenced[ (int) $cid ] = true;
			}
		}
	}

	if ( isset( $payload['groups']['authors'] ) && is_array( $payload['groups']['authors'] ) ) {
		$payload['groups']['authors'] = array_intersect_key( $payload['groups']['authors'], $referenced );
	}

	return $payload;
}

/**
 * GET /post/<id>
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_content_graph_rest_post_detail( WP_REST_Request $request ) {
	$id   = (int) $request['id'];
	$post = $id > 0 ? get_post( $id ) : null;
	if ( ! $post ) {
		return new WP_Error(
			'desktop_mode_content_graph_post_not_found',
			__( 'Post not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	if ( ! current_user_can( 'read_post', $id ) ) {
		return new WP_Error(
			'desktop_mode_content_graph_forbidden',
			__( 'Insufficient permissions.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	// Revision history (and the identities of who edited the post) is
	// edit-level data in core — wp/v2 only exposes revisions behind
	// edit_post. Mirror that: readers get comment-author contributors
	// only, no revision list.
	$can_edit     = current_user_can( 'edit_post', $post->ID );
	$author       = desktop_mode_content_graph_format_user( (int) $post->post_author );
	$contributors = desktop_mode_content_graph_collect_contributors( $post, $can_edit );
	$comments     = desktop_mode_content_graph_collect_comments( $post );
	$categories   = desktop_mode_content_graph_collect_terms( $post );
	$attached     = desktop_mode_content_graph_collect_attached_media( $post );
	$revisions    = $can_edit ? desktop_mode_content_graph_collect_revisions( $post ) : array();

	return rest_ensure_response(
		array(
			'post'           => array(
				'id'       => (int) $post->ID,
				'type'     => $post->post_type,
				'title'    => get_the_title( $post ),
				'status'   => $post->post_status,
				'slug'     => $post->post_name,
				'edit_url' => (string) get_edit_post_link( $post->ID, 'raw' ),
				'view_url' => (string) get_permalink( $post ),
				'date'     => mysql2date( 'c', $post->post_date_gmt, false ),
				'modified' => mysql2date( 'c', $post->post_modified_gmt, false ),
			),
			'author'         => $author,
			'contributors'   => $contributors,
			'comments'       => $comments,
			'categories'     => $categories,
			'attached_media' => $attached,
			'revisions'      => $revisions,
		)
	);
}

/**
 * Format a user record for the side panel.
 *
 * @param int $user_id
 * @return array|null
 */
function desktop_mode_content_graph_format_user( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return null;
	}
	$user = get_userdata( $user_id );
	if ( ! $user ) {
		return null;
	}
	return array(
		'id'       => $user_id,
		'name'     => (string) $user->display_name,
		'slug'     => (string) $user->user_nicename,
		'avatar'   => (string) get_avatar_url( $user_id, array( 'size' => 64 ) ),
		'edit_url' => (string) get_edit_user_link( $user_id ),
	);
}

/**
 * Collect contributors: distinct revision authors (excluding the
 * current author) plus distinct comment authors who have a
 * registered user account.
 *
 * @param WP_Post $post
 * @param bool    $include_revision_authors Whether to include revision
 *                authors. Pass false for users who cannot `edit_post`
 *                the post — revision authorship is edit-level data;
 *                approved comment authors are public either way.
 * @return array[]
 */
function desktop_mode_content_graph_collect_contributors( WP_Post $post, $include_revision_authors = true ) {
	$author_id = (int) $post->post_author;
	$ids       = array();
	if ( $include_revision_authors ) {
		$revs = wp_get_post_revisions(
			$post->ID,
			array(
				'posts_per_page' => 100,
				'fields'         => 'ids',
			)
		);
		foreach ( (array) $revs as $rev_id ) {
			$rev = get_post( $rev_id );
			if ( $rev && (int) $rev->post_author > 0 && (int) $rev->post_author !== $author_id ) {
				$ids[ (int) $rev->post_author ] = true;
			}
		}
	}
	$comment_users = get_comments(
		array(
			'post_id' => $post->ID,
			'status'  => 'approve',
			'fields'  => 'ids',
		)
	);
	foreach ( (array) $comment_users as $cid ) {
		$comment = get_comment( $cid );
		if ( $comment && (int) $comment->user_id > 0 && (int) $comment->user_id !== $author_id ) {
			$ids[ (int) $comment->user_id ] = true;
		}
	}
	$out = array();
	foreach ( array_keys( $ids ) as $uid ) {
		$entry = desktop_mode_content_graph_format_user( $uid );
		if ( $entry ) {
			$out[] = $entry;
		}
	}
	return $out;
}

/**
 * Collect approved comments (most recent first, capped at 50).
 *
 * @param WP_Post $post
 * @return array[]
 */
function desktop_mode_content_graph_collect_comments( WP_Post $post ) {
	$comments = get_comments(
		array(
			'post_id' => $post->ID,
			'status'  => 'approve',
			'number'  => 50,
			'orderby' => 'comment_date_gmt',
			'order'   => 'DESC',
		)
	);
	$out = array();
	foreach ( $comments as $comment ) {
		$out[] = array(
			'id'       => (int) $comment->comment_ID,
			'author'   => (string) $comment->comment_author,
			'user_id'  => (int) $comment->user_id,
			'date'     => mysql2date( 'c', $comment->comment_date_gmt, false ),
			'excerpt'  => wp_html_excerpt( wp_strip_all_tags( (string) $comment->comment_content ), 140, '...' ),
			'edit_url' => (string) admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
		);
	}
	return $out;
}

/**
 * Collect every taxonomy term attached to the post (categories, tags,
 * and any custom taxonomy registered for the post type).
 *
 * @param WP_Post $post
 * @return array[]
 */
function desktop_mode_content_graph_collect_terms( WP_Post $post ) {
	$taxes = get_object_taxonomies( $post->post_type, 'objects' );
	$out   = array();
	foreach ( $taxes as $tax ) {
		if ( ! $tax->public && ! $tax->show_ui ) {
			continue;
		}
		$terms = get_the_terms( $post, $tax->name );
		if ( empty( $terms ) || is_wp_error( $terms ) ) {
			continue;
		}
		foreach ( $terms as $term ) {
			$out[] = array(
				'id'        => (int) $term->term_id,
				'name'      => (string) $term->name,
				'slug'      => (string) $term->slug,
				'taxonomy'  => (string) $term->taxonomy,
				'tax_label' => (string) $tax->labels->singular_name,
				'count'     => (int) $term->count,
				'edit_url'  => (string) get_edit_term_link( $term->term_id, $term->taxonomy ),
			);
		}
	}
	return $out;
}

/**
 * Collect attached media (anything with this post as its `post_parent`)
 * plus any media referenced from a `wp:image` block. Returns up to 50.
 *
 * @param WP_Post $post
 * @return array[]
 */
function desktop_mode_content_graph_collect_attached_media( WP_Post $post ) {
	$attachments = get_attached_media( '', $post );
	$out         = array();
	foreach ( $attachments as $att ) {
		$out[] = array(
			'id'       => (int) $att->ID,
			'title'    => (string) get_the_title( $att ),
			'mime'     => (string) $att->post_mime_type,
			'thumb'    => (string) wp_get_attachment_image_url( $att->ID, 'thumbnail' ),
			'edit_url' => (string) get_edit_post_link( $att->ID, 'raw' ),
		);
		if ( count( $out ) >= 50 ) {
			break;
		}
	}
	return $out;
}

/**
 * Collect post revisions (most recent first, capped at 30).
 *
 * @param WP_Post $post
 * @return array[]
 */
function desktop_mode_content_graph_collect_revisions( WP_Post $post ) {
	$revs = wp_get_post_revisions(
		$post->ID,
		array(
			'posts_per_page' => 30,
		)
	);
	$out  = array();
	foreach ( $revs as $rev ) {
		$out[] = array(
			'id'       => (int) $rev->ID,
			'date'     => mysql2date( 'c', $rev->post_date_gmt, false ),
			'author'   => desktop_mode_content_graph_format_user( (int) $rev->post_author ),
			'edit_url' => (string) admin_url( 'revision.php?revision=' . (int) $rev->ID ),
		);
	}
	return $out;
}
