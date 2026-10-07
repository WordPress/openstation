<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

function media_ids( \WP_Post $post ) {
	$ids = get_children(
		array(
			'post_parent' => $post->ID,
			'post_type'   => 'attachment',
			'fields'      => 'ids',
		)
	);
	$ids = array_map( 'intval', $ids );
	if ( has_post_thumbnail( $post ) ) {
		$ids[] = (int) get_post_thumbnail_id( $post );
	}
	return array_unique( $ids );
}

function folder( Os $os, array $section, $id ) {
	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}

	$contributors = function_exists( 'openstation_my_wordpress_post_contributors_payload' )
		? openstation_my_wordpress_post_contributors_payload( $id )
		: array();
	$categories   = get_the_terms( $post, 'category' );
	$categories   = is_array( $categories ) ? $categories : array();
	$tags         = get_the_terms( $post, 'post_tag' );
	$tags         = is_array( $tags ) ? $tags : array();
	$media_count  = count( media_ids( $post ) );
	$comments     = (int) get_comments_number( $post );
	$revisions    = wp_revisions_enabled( $post ) ? count( wp_get_post_revisions( $id, array( 'fields' => 'ids' ) ) ) : 0;

	$folders   = array();
	$folders[] = array(
		'relation' => 'author',
		'label'    => __( 'Author', 'desktop-mode' ),
		'icon'     => 'dashicons-admin-users',
		'count'    => 1,
	);
	if ( array() !== $contributors ) {
		$folders[] = array(
			'relation' => 'contributors',
			'label'    => __( 'Contributors', 'desktop-mode' ),
			'icon'     => 'dashicons-groups',
			'count'    => count( $contributors ),
		);
	}
	$folders[] = array(
		'relation' => 'comments',
		'label'    => __( 'Comments', 'desktop-mode' ),
		'icon'     => 'dashicons-admin-comments',
		'count'    => $comments,
		'disabled' => 0 === $comments && 'closed' === $post->comment_status,
	);
	if ( array() !== $categories ) {
		$folders[] = array(
			'relation' => 'categories',
			'label'    => __( 'Categories', 'desktop-mode' ),
			'icon'     => 'dashicons-category',
			'count'    => count( $categories ),
		);
	}
	if ( array() !== $tags ) {
		$folders[] = array(
			'relation' => 'tags',
			'label'    => __( 'Tags', 'desktop-mode' ),
			'icon'     => 'dashicons-tag',
			'count'    => count( $tags ),
		);
	}
	$folders[] = array(
		'relation' => 'media',
		'label'    => __( 'Attached media', 'desktop-mode' ),
		'icon'     => 'dashicons-format-image',
		'count'    => $media_count,
	);
	$folders[] = array(
		'relation' => 'revisions',
		'label'    => __( 'Revisions', 'desktop-mode' ),
		'icon'     => 'dashicons-backup',
		'count'    => $revisions,
	);

	return array(
		'id'      => $id,
		'title'   => '' !== $post->post_title ? openstation_plain_text_title( $post->post_title ) : __( '(no title)', 'desktop-mode' ),
		'status'  => (string) $post->post_status,

		'content' => (string) apply_filters( 'the_content', (string) $post->post_content ),
		'folders' => $folders,
	);
}

function sub( Os $os, array $section, $id, $relation ) {
	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}
	$rows  = array();
	$label = '';

	$user_row = static function ( $user_id, $name = '', $avatar = '' ) {
		$user = get_userdata( (int) $user_id );
		return array(
			'id'       => (int) $user_id,
			'title'    => openstation_plain_text_title( '' !== $name ? $name : ( $user ? (string) $user->display_name : sprintf( '#%d', $user_id ) ) ),
			'subtitle' => $user ? (string) $user->user_email : '',
			'thumb'    => '' !== $avatar ? $avatar : (string) get_avatar_url( (int) $user_id, array( 'size' => 96 ) ),
			'editUrl'  => current_user_can( 'edit_user', (int) $user_id )
				? admin_url( 'user-edit.php?user_id=' . (int) $user_id )
				: '',
		);
	};

	switch ( $relation ) {
		case 'author':
			$label  = __( 'Author', 'desktop-mode' );
			$rows[] = $user_row( (int) $post->post_author );
			break;
		case 'contributors':
			$label = __( 'Contributors', 'desktop-mode' );
			if ( function_exists( 'openstation_my_wordpress_post_contributors_payload' ) ) {
				foreach ( openstation_my_wordpress_post_contributors_payload( $id ) as $person ) {
					$rows[] = $user_row( $person['userId'], $person['userName'], $person['userAvatarUrl'] );
				}
			}
			break;
		case 'comments':
			$label = __( 'Comments', 'desktop-mode' );
			foreach ( get_comments(
				array(
					'post_id' => $id,
					'number'  => 100,
				)
			) as $comment ) {
				$rows[] = array(
					'id'       => (int) $comment->comment_ID,
					'title'    => openstation_plain_text_title( $comment->comment_author ),
					'subtitle' => openstation_plain_text_title( wp_trim_words( openstation_strip_all_tags( (string) $comment->comment_content ), 12 ) ),
					'icon'     => 'dashicons-admin-comments',
					'editUrl'  => current_user_can( 'edit_comment', (int) $comment->comment_ID )
						? admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID )
						: '',
				);
			}
			break;
		case 'categories':
		case 'tags':
			$taxonomy = 'tags' === $relation ? 'post_tag' : 'category';
			$label    = 'tags' === $relation ? __( 'Tags', 'desktop-mode' ) : __( 'Categories', 'desktop-mode' );
			$terms    = get_the_terms( $post, $taxonomy );
			foreach ( is_array( $terms ) ? $terms : array() as $term ) {
				$rows[] = array(
					'id'       => (int) $term->term_id,
					'title'    => openstation_plain_text_title( $term->name ),
					'subtitle' => sprintf(

						_n( '%s entry', '%s entries', (int) $term->count, 'desktop-mode' ),
						number_format_i18n( (int) $term->count )
					),
					'icon'     => 'tags' === $relation ? 'dashicons-tag' : 'dashicons-category',
					'editUrl'  => current_user_can( 'manage_categories' )
						? admin_url( 'term.php?taxonomy=' . $taxonomy . '&tag_ID=' . (int) $term->term_id )
						: '',
				);
			}
			break;
		case 'media':
			$label = __( 'Attached media', 'desktop-mode' );
			foreach ( media_ids( $post ) as $media_id ) {
				$media = get_post( $media_id );
				if ( ! $media ) {
					continue;
				}
				$rows[] = array(
					'id'       => $media_id,
					'title'    => '' !== $media->post_title ? openstation_plain_text_title( $media->post_title ) : sprintf( '#%d', $media_id ),
					'subtitle' => (string) $media->post_mime_type,
					'thumb'    => (string) wp_get_attachment_image_url( $media_id, 'medium' ),
					'icon'     => 'dashicons-format-image',
					'editUrl'  => current_user_can( 'edit_post', $media_id )
						? admin_url( 'post.php?post=' . $media_id . '&action=edit' )
						: '',
				);
			}
			break;
		case 'revisions':
			$label = __( 'Revisions', 'desktop-mode' );
			foreach ( wp_get_post_revisions( $id ) as $revision ) {
				$rows[] = array(
					'id'       => (int) $revision->ID,
					'title'    => openstation_plain_text_title( wp_post_revision_title_expanded( $revision, false ) ),
					'subtitle' => openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $revision->post_author ) ),
					'icon'     => 'dashicons-backup',
					'editUrl'  => current_user_can( 'edit_post', $id )
						? admin_url( 'revision.php?revision=' . (int) $revision->ID )
						: '',
				);
			}
			break;
		default:
			return null;
	}

	return array(
		'label' => $label,
		'rows'  => $rows,
	);
}

function stats_payload( $callback, array $params ) {
	if ( ! function_exists( $callback ) || ! class_exists( '\WP_REST_Request' ) ) {
		return null;
	}
	$request = new \WP_REST_Request();
	foreach ( $params as $key => $value ) {
		$request->set_param( $key, $value );
	}
	$payload = call_user_func( $callback, $request );
	return is_array( $payload ) ? $payload : null;
}

function sub_detail( Os $os, array $section, $post_id, $relation, $row_id ) {
	switch ( $relation ) {
		case 'categories':
		case 'tags':
			$stats = stats_payload(
				'openstation_my_wordpress_term_stats_callback',
				array(
					'taxonomy' => 'tags' === $relation ? 'post_tag' : 'category',
					'id'       => $row_id,
				)
			);
			return $stats ? array(
				'kind'  => 'term',
				'stats' => $stats,
			) : null;

		case 'author':
		case 'contributors':
			$user_section = array(
				'kind'      => 'user',
				'post_type' => '',
			);
			$dossier      = detail( $os, $user_section, $row_id );
			if ( ! $dossier ) {
				return null;
			}
			return array(
				'kind'   => 'user',
				'detail' => $dossier,
				'stats'  => stats_payload( 'openstation_my_wordpress_user_stats_callback', array( 'id' => $row_id ) ),
			);

		case 'comments':
			$stats = stats_payload( 'openstation_my_wordpress_comment_stats_callback', array( 'id' => $row_id ) );
			return $stats ? array(
				'kind'  => 'comment',
				'stats' => $stats,
			) : null;

		case 'media':
			$media_section = array(
				'kind'       => 'media',
				'post_type'  => 'attachment',
				'thumbnails' => true,
			);
			$dossier       = detail( $os, $media_section, $row_id );
			return $dossier ? array(
				'kind'   => 'media',
				'detail' => $dossier,
			) : null;

		case 'revisions':
			$revision = wp_get_post_revision( $row_id );
			if ( ! $revision || (int) $revision->post_parent !== (int) $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
				return null;
			}
			return array(
				'kind'    => 'revision',
				'title'   => openstation_plain_text_title( wp_post_revision_title_expanded( $revision, false ) ),
				'author'  => openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $revision->post_author ) ),
				'date'    => (string) get_the_date( '', $revision ) . ' ' . get_the_time( '', $revision ),
				'content' => wp_kses_post( (string) apply_filters( 'the_content', (string) $revision->post_content ) ),
			);
	}
	return null;
}

function edit_choices() {
	$authors = array();
	foreach ( get_users(
		array(
			'capability' => array( 'edit_posts' ),
			'number'     => 100,
			'orderby'    => 'display_name',
			'fields'     => array( 'ID', 'display_name' ),
		)
	) as $user ) {
		$authors[] = array(
			'id'   => (int) $user->ID,
			'name' => openstation_plain_text_title( $user->display_name ),
		);
	}
	$categories = array();
	foreach ( get_terms(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'number'     => 100,
		)
	) as $term ) {
		if ( $term instanceof \WP_Term ) {
			$categories[] = array(
				'id'     => (int) $term->term_id,
				'name'   => openstation_plain_text_title( $term->name ),
				'parent' => (int) $term->parent,
			);
		}
	}
	$tags = array();
	foreach ( get_terms(
		array(
			'taxonomy'   => 'post_tag',
			'hide_empty' => false,
			'number'     => 100,
		)
	) as $term ) {
		if ( $term instanceof \WP_Term ) {
			$tags[] = array(
				'id'   => (int) $term->term_id,
				'name' => openstation_plain_text_title( $term->name ),
			);
		}
	}
	return array(
		'authors'    => $authors,
		'categories' => $categories,
		'tags'       => $tags,
	);
}

function preview_actions( Os $os ) {
	if ( ! function_exists( 'openstation_my_wordpress_collect_preview_actions' ) ) {
		return array();
	}
	$out = array();
	foreach ( (array) openstation_my_wordpress_collect_preview_actions() as $action ) {
		if ( ! is_array( $action ) || empty( $action['id'] ) ) {
			continue;
		}
		if ( ! empty( $action['capability'] ) && ! $os->can( (string) $action['capability'] ) ) {
			continue;
		}
		$out[] = array(
			'id'       => (string) $action['id'],
			'label'    => (string) ( $action['label'] ?? $action['id'] ),
			'icon'     => (string) ( $action['icon'] ?? '' ),
			'sections' => array_map( 'strval', (array) ( $action['sections'] ?? array() ) ),
			'mime'     => (string) ( $action['mime'] ?? '' ),
		);
	}
	return $out;
}
