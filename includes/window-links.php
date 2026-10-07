<?php

defined( 'ABSPATH' ) || exit;

function openstation_build_content_identity() {
	$identity = null;
	$screen   = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	$pagenow  = isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '';

	if ( 'comment.php' === $pagenow ) {

		$comment_id = isset( $_GET['c'] ) ? absint( $_GET['c'] ) : 0;
		$comment    = $comment_id ? get_comment( $comment_id ) : null;
		if ( $comment ) {
			$identity = array(
				'type'  => 'comment',
				'id'    => (int) $comment->comment_ID,
				'label' => wp_trim_words( openstation_strip_all_tags( $comment->comment_content ), 10 ),
			);

			$post_id   = (int) $comment->comment_post_ID;
			$post_type = $post_id ? get_post_type( $post_id ) : false;
			if ( $post_type ) {
				$identity['root'] = array(
					'type' => sanitize_key( $post_type ),
					'id'   => $post_id,
				);
			}
		}
	} elseif ( 'revision.php' === $pagenow ) {

		$revision_id = isset( $_GET['revision'] ) ? absint( $_GET['revision'] ) : 0;
		if ( ! $revision_id ) {

			$revision_id = isset( $_GET['to'] ) ? absint( $_GET['to'] ) : 0;
		}
		$revision = $revision_id ? wp_get_post_revision( $revision_id ) : null;
		$parent   = $revision ? get_post( (int) $revision->post_parent ) : null;
		if ( $parent instanceof WP_Post && current_user_can( 'edit_post', $parent->ID ) ) {
			$identity = array(
				'type'  => 'revisions',
				'id'    => (int) $parent->ID,

				'label' => sprintf( __( 'Revisions of %s', 'desktop-mode' ), get_the_title( $parent ) ),
				'root'  => array(
					'type' => sanitize_key( $parent->post_type ),
					'id'   => (int) $parent->ID,
				),
			);
		}
	} elseif ( $screen && 'post' === $screen->base && 'add' !== $screen->action ) {
		$post = get_post();
		if ( $post instanceof WP_Post && $post->ID > 0 ) {
			if ( 'attachment' === $post->post_type ) {
				$identity = array(
					'type'  => 'media',
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				$parent_id   = (int) $post->post_parent;
				$parent_type = $parent_id ? get_post_type( $parent_id ) : false;
				if ( $parent_type ) {
					$identity['root'] = array(
						'type' => sanitize_key( $parent_type ),
						'id'   => $parent_id,
					);
				}
			} else {
				$identity = array(
					'type'  => sanitize_key( $post->post_type ),
					'id'    => (int) $post->ID,
					'label' => get_the_title( $post ),
				);

				$links = openstation_window_links_extract_references( $post );
				if ( ! empty( $links ) ) {
					$identity['links'] = $links;
				}

				$preview_url = openstation_window_preview_url( $post );
				if ( '' !== $preview_url ) {
					$identity['previewUrl'] = $preview_url;
				}

				$revisions = openstation_window_revisions( $post );
				if ( '' !== $revisions['url'] ) {
					$identity['revisionsUrl']  = $revisions['url'];
					$identity['revisionCount'] = $revisions['count'];
				}

				$related_source_post = $post;
			}
		}
	} elseif ( 'upload.php' === $pagenow ) {

		$item_id = isset( $_GET['item'] ) ? absint( $_GET['item'] ) : 0;
		$item    = $item_id ? get_post( $item_id ) : null;
		if ( $item instanceof WP_Post && 'attachment' === $item->post_type ) {
			$identity = array(
				'type'  => 'media',
				'id'    => (int) $item->ID,
				'label' => get_the_title( $item ),
			);

			$parent_id   = (int) $item->post_parent;
			$parent_type = $parent_id ? get_post_type( $parent_id ) : false;
			if ( $parent_type ) {
				$identity['root'] = array(
					'type' => sanitize_key( $parent_type ),
					'id'   => $parent_id,
				);
			}
		}
	} elseif ( 'edit-comments.php' === $pagenow ) {

		$post_id = isset( $_GET['p'] ) ? absint( $_GET['p'] ) : 0;
		$post    = $post_id ? get_post( $post_id ) : null;
		if ( $post instanceof WP_Post && 'attachment' !== $post->post_type ) {
			$identity = array(
				'type'  => 'comments',
				'id'    => (int) $post->ID,

				'label' => sprintf( __( 'Comments on %s', 'desktop-mode' ), get_the_title( $post ) ),
				'root'  => array(
					'type' => sanitize_key( $post->post_type ),
					'id'   => (int) $post->ID,
				),
			);
		}
	} elseif ( 'term.php' === $pagenow ) {

		$term_id = isset( $_GET['tag_ID'] ) ? absint( $_GET['tag_ID'] ) : 0;
		$term    = $term_id ? get_term( $term_id ) : null;
		if ( $term instanceof WP_Term ) {
			$identity = array(
				'type'  => 'term/' . sanitize_key( $term->taxonomy ),
				'id'    => (int) $term->term_id,
				'label' => $term->name,
			);
		}
	} elseif ( 'user-edit.php' === $pagenow || 'profile.php' === $pagenow ) {

		$user_id = isset( $_GET['user_id'] ) ? absint( $_GET['user_id'] ) : get_current_user_id();
		$user    = $user_id ? get_userdata( $user_id ) : null;
		if ( $user instanceof WP_User && current_user_can( 'edit_user', $user->ID ) ) {
			$identity = array(
				'type'  => 'user',
				'id'    => (int) $user->ID,
				'label' => $user->display_name ? $user->display_name : $user->user_login,
			);
		}
	}

	$identity = apply_filters( 'openstation_window_content_identity', $identity, $screen );

	return openstation_window_related_attach(
		$identity,
		isset( $related_source_post ) && $related_source_post instanceof WP_Post ? $related_source_post : null,
		$screen
	);
}

function openstation_window_preview_url( $post ) {
	$preview_url = '';

	if (
		$post instanceof WP_Post &&
		$post->ID > 0 &&
		'attachment' !== $post->post_type &&
		is_post_type_viewable( get_post_type_object( $post->post_type ) ) &&
		current_user_can( 'edit_post', $post->ID )
	) {
		$link = get_preview_post_link(
			$post,
			array(
				'preview_id'    => $post->ID,
				'preview_nonce' => wp_create_nonce( 'post_preview_' . $post->ID ),
			)
		);
		if ( is_string( $link ) ) {
			$preview_url = $link;
		}
	}

	return (string) apply_filters( 'openstation_window_preview_url', $preview_url, $post );
}

function openstation_window_revisions( $post ) {
	$revisions = array(
		'url'   => '',
		'count' => 0,
	);

	if (
		$post instanceof WP_Post &&
		$post->ID > 0 &&
		'attachment' !== $post->post_type &&

		'auto-draft' !== $post->post_status &&
		post_type_supports( $post->post_type, 'revisions' ) &&
		current_user_can( 'edit_post', $post->ID )
	) {

		$ids = wp_get_post_revisions( $post->ID, array( 'fields' => 'ids' ) );
		if ( ! empty( $ids ) ) {

			$link = get_edit_post_link( (int) reset( $ids ), 'raw' );
			if ( is_string( $link ) && '' !== $link ) {
				$revisions['url']   = $link;
				$revisions['count'] = count( $ids );
			}
		}
	}

	$revisions = apply_filters( 'openstation_window_revisions', $revisions, $post );

	if ( ! is_array( $revisions ) ) {
		return array(
			'url'   => '',
			'count' => 0,
		);
	}

	return array(
		'url'   => isset( $revisions['url'] ) && is_string( $revisions['url'] ) ? $revisions['url'] : '',
		'count' => isset( $revisions['count'] ) ? max( 0, (int) $revisions['count'] ) : 0,
	);
}

function openstation_window_related_attach( $identity, $post, $screen ) {
	if ( ! is_array( $identity ) ) {
		return $identity;
	}
	if ( isset( $identity['label'] ) && is_string( $identity['label'] ) ) {
		$identity['label'] = openstation_plain_text_title( $identity['label'] );
	}

	$related = array();
	if (
		$post instanceof WP_Post &&

		isset( $identity['type'], $identity['id'] ) &&
		sanitize_key( $post->post_type ) === $identity['type'] &&
		(int) $post->ID === (int) $identity['id']
	) {
		$related = openstation_window_related_entities_for_post( $post );
	}
	if ( isset( $identity['related'] ) && is_array( $identity['related'] ) ) {

		$related = array_merge( $related, $identity['related'] );
	}

	$related = apply_filters( 'openstation_window_related_entities', $related, $identity, $screen );
	$related = openstation_window_related_entities_sanitize( $related );

	unset( $identity['related'] );
	if ( ! empty( $related ) ) {
		$identity['related'] = $related;
	}

	return $identity;
}

function openstation_window_links_extract_references( $post ) {
	$links = array();
	$seen  = array();
	$push  = static function ( $type, $id, $rel = '' ) use ( &$links, &$seen ) {
		$key = $type . ':' . $id;
		if ( isset( $seen[ $key ] ) || count( $links ) >= 64 ) {
			return;
		}
		$seen[ $key ] = true;
		$entry        = array(
			'type' => $type,
			'id'   => (int) $id,
		);
		if ( 'child' === $rel ) {

			$entry['rel'] = 'child';
		}
		$links[] = $entry;
	};

	if ( function_exists( 'openstation_content_graph_extract_internal_links' ) ) {
		$ids = openstation_content_graph_extract_internal_links( (string) $post->post_content );
		foreach ( array_slice( $ids, 0, 32 ) as $target_id ) {
			$target_id = (int) $target_id;
			if ( $target_id === (int) $post->ID ) {
				continue;
			}
			$target_type = get_post_type( $target_id );
			if ( ! $target_type || 'attachment' === $target_type ) {
				continue;
			}
			$push( sanitize_key( $target_type ), $target_id );
		}
	}

	if ( preg_match_all( '/\bwp-image-(\d+)\b/', (string) $post->post_content, $matches ) ) {
		foreach ( array_slice( array_unique( $matches[1] ), 0, 32 ) as $media_id ) {
			$media_id = (int) $media_id;
			if ( $media_id > 0 && 'attachment' === get_post_type( $media_id ) ) {
				$push( 'media', $media_id, 'child' );
			}
		}
	}
	$thumbnail_id = (int) get_post_thumbnail_id( $post );
	if ( $thumbnail_id > 0 && 'attachment' === get_post_type( $thumbnail_id ) ) {
		$push( 'media', $thumbnail_id, 'child' );
	}

	foreach ( get_object_taxonomies( $post, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->public ) ) {
			continue;
		}
		$terms = get_the_terms( $post, $taxonomy->name );
		if ( ! is_array( $terms ) ) {
			continue;
		}
		foreach ( array_slice( $terms, 0, 32 ) as $term ) {
			$push( 'term/' . sanitize_key( $taxonomy->name ), (int) $term->term_id );
		}
	}

	return $links;
}

function openstation_window_related_entities_for_post( $post ) {
	if ( ! $post instanceof WP_Post || ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
		return array();
	}

	$related = array();

	$comment_totals = get_comment_count( $post->ID );
	$comment_count  = isset( $comment_totals['total_comments'] ) ? (int) $comment_totals['total_comments'] : 0;
	if ( post_type_supports( $post->post_type, 'comments' ) && $comment_count > 0 ) {
		$related[] = array(
			'id'         => 'comments',
			'group'      => 'comments',
			'groupLabel' => __( 'Comments', 'desktop-mode' ),
			'label'      => __( 'Comments', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-comments',
			'url'        => admin_url( 'edit-comments.php?p=' . $post->ID ),
			'count'      => $comment_count,
		);
	}

	$term_budget = 32;
	foreach ( get_object_taxonomies( $post, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->public ) || $term_budget <= 0 ) {
			continue;
		}
		$terms = get_the_terms( $post, $taxonomy->name );
		if ( ! is_array( $terms ) ) {
			continue;
		}
		foreach ( array_slice( $terms, 0, $term_budget ) as $term ) {
			--$term_budget;
			$tax_slug  = sanitize_key( $taxonomy->name );
			$related[] = array(
				'id'         => 'term-' . $tax_slug . '-' . (int) $term->term_id,
				'group'      => 'terms/' . $tax_slug,
				'groupLabel' => (string) $taxonomy->labels->name,
				'label'      => $term->name,
				'icon'       => ! empty( $taxonomy->hierarchical ) ? 'dashicons-category' : 'dashicons-tag',
				'url'        => admin_url( 'term.php?taxonomy=' . rawurlencode( $taxonomy->name ) . '&tag_ID=' . (int) $term->term_id ),
			);
		}
	}

	$media_ids = array();
	$push_id   = static function ( $media_id ) use ( &$media_ids ) {
		$media_id = (int) $media_id;
		if ( $media_id > 0 && ! in_array( $media_id, $media_ids, true ) && 'attachment' === get_post_type( $media_id ) ) {
			$media_ids[] = $media_id;
		}
	};

	$push_id( get_post_thumbnail_id( $post ) );
	$attached = get_children(
		array(
			'post_parent'    => $post->ID,
			'post_type'      => 'attachment',
			'posts_per_page' => 20,
			'orderby'        => 'menu_order ID',
			'order'          => 'ASC',
			'fields'         => 'ids',
		)
	);
	foreach ( $attached as $media_id ) {
		$push_id( $media_id );
	}
	if ( preg_match_all( '/\bwp-image-(\d+)\b/', (string) $post->post_content, $matches ) ) {
		foreach ( array_unique( $matches[1] ) as $media_id ) {
			$push_id( $media_id );
		}
	}

	foreach ( array_slice( $media_ids, 0, 20 ) as $media_id ) {
		$label = get_the_title( $media_id );
		if ( '' === $label ) {
			$label = wp_basename( (string) get_attached_file( $media_id ) );
		}
		if ( '' === $label ) {

			$label = sprintf( __( 'Media item %d', 'desktop-mode' ), $media_id );
		}
		$related[] = array(
			'id'         => 'media-' . $media_id,
			'group'      => 'media',
			'groupLabel' => __( 'Media', 'desktop-mode' ),
			'label'      => $label,
			'icon'       => 'dashicons-admin-media',
			'url'        => admin_url( 'upload.php?item=' . $media_id ),
		);
	}

	if ( function_exists( 'openstation_content_graph_extract_internal_links' ) ) {
		$link_ids = openstation_content_graph_extract_internal_links( (string) $post->post_content );
		$count    = 0;
		foreach ( $link_ids as $target_id ) {
			if ( $count >= 10 ) {
				break;
			}
			$target_id = (int) $target_id;
			if ( $target_id === (int) $post->ID ) {
				continue;
			}
			$target_type = get_post_type( $target_id );
			if ( ! $target_type || 'attachment' === $target_type ) {
				continue;
			}
			$label = get_the_title( $target_id );
			if ( '' === $label ) {

				$label = sprintf( __( 'Post %d', 'desktop-mode' ), $target_id );
			}
			$related[] = array(
				'id'         => 'link-' . $target_id,
				'group'      => 'links',
				'groupLabel' => __( 'Linked posts', 'desktop-mode' ),
				'label'      => $label,
				'icon'       => 'dashicons-admin-links',
				'url'        => admin_url( 'post.php?post=' . $target_id . '&action=edit' ),
			);
			++$count;
		}
	}

	return $related;
}

function openstation_window_related_entities_sanitize( $related ) {
	if ( ! is_array( $related ) ) {
		return array();
	}

	$out = array();
	foreach ( $related as $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		foreach ( array( 'label', 'groupLabel' ) as $text ) {
			if ( isset( $item[ $text ] ) && is_string( $item[ $text ] ) ) {
				$item[ $text ] = openstation_plain_text_title( $item[ $text ] );
			}
		}
		foreach ( array( 'id', 'group', 'label', 'url' ) as $required ) {

			if ( ! isset( $item[ $required ] ) || ! is_string( $item[ $required ] ) || '' === trim( $item[ $required ] ) ) {
				continue 2;
			}
		}
		$entry = array(
			'id'    => $item['id'],
			'group' => $item['group'],
			'label' => $item['label'],
			'url'   => $item['url'],
		);
		if ( isset( $item['groupLabel'] ) && is_string( $item['groupLabel'] ) && '' !== trim( $item['groupLabel'] ) ) {
			$entry['groupLabel'] = $item['groupLabel'];
		}
		if ( isset( $item['icon'] ) && is_string( $item['icon'] ) && '' !== trim( $item['icon'] ) ) {
			$entry['icon'] = $item['icon'];
		}
		if ( isset( $item['count'] ) && is_numeric( $item['count'] ) ) {
			$entry['count'] = (int) $item['count'];
		}
		$out[] = $entry;
	}

	return $out;
}

function openstation_register_content_identity_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/content-identity',
		array(
			'methods'             => 'GET',
			'callback'            => 'openstation_rest_content_identity',
			'permission_callback' => 'openstation_rest_content_identity_permission',
			'args'                => array(
				'post' => array(
					'description' => __( 'Post ID to recompute the content identity for.', 'desktop-mode' ),
					'type'        => 'integer',
					'required'    => true,
					'minimum'     => 1,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_content_identity_route' );

function openstation_rest_content_identity_permission( $request ) {
	$enabled = openstation_rest_require_enabled();
	if ( true !== $enabled ) {
		return $enabled;
	}
	if ( ! current_user_can( 'edit_post', (int) $request['post'] ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_rest_content_identity( $request ) {
	$post = get_post( (int) $request['post'] );
	if ( ! $post instanceof WP_Post || 'attachment' === $post->post_type ) {
		return new WP_Error(
			'openstation_no_identity',
			__( 'No content identity for this object.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$identity = array(
		'type'  => sanitize_key( $post->post_type ),
		'id'    => (int) $post->ID,
		'label' => get_the_title( $post ),
	);
	$links    = openstation_window_links_extract_references( $post );
	if ( ! empty( $links ) ) {
		$identity['links'] = $links;
	}

	$preview_url = openstation_window_preview_url( $post );
	if ( '' !== $preview_url ) {
		$identity['previewUrl'] = $preview_url;
	}

	$revisions = openstation_window_revisions( $post );
	if ( '' !== $revisions['url'] ) {
		$identity['revisionsUrl']  = $revisions['url'];
		$identity['revisionCount'] = $revisions['count'];
	}

	$identity = apply_filters( 'openstation_window_content_identity', $identity, null );
	$identity = openstation_window_related_attach( $identity, $post, null );

	return rest_ensure_response( array( 'identity' => $identity ) );
}

function openstation_register_window_link_renderer_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window-link renderer script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_link_renderer_script_registry( $handle, true );

	do_action( 'openstation_window_link_renderer_script_registered', $handle );

	return true;
}

function openstation_window_link_renderer_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_window_link_renderer_script_registry() {
	openstation_window_link_renderer_script_registry( '__flush__' );
}

function openstation_build_window_link_renderer_scripts_payload() {
	$registry = openstation_window_link_renderer_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {

			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_link_renderer_script',
				'Window-link renderer',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
