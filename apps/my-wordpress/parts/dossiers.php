<?php
/**
 * My WordPress — navigate-into: the detail folder and its sub-lists.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. This part owns what a post
 * OPENS INTO: the relation folders with live counts, each relation's
 * rows, the right-pane dossier behind a selected row (rendered
 * through WP Explorer's own stats callbacks), the Edit… modal's
 * choice lists, and the shared preview-action descriptors.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * The ids "Attached media" lists and counts: the post's attachments
 * plus its featured image, each once.
 *
 * @param \WP_Post $post Post.
 * @return int[]
 */
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

/**
 * The detail FOLDER a post navigates into: the rendered article plus
 * one folder tile per related surface — Author, Contributors,
 * Comments, Categories, Tags, Attached media, Revisions — with live
 * counts. WP Explorer's detail view, as data.
 *
 * @param Os                  $os      Host handle.
 * @param array<string,mixed> $section Section descriptor.
 * @param int                 $id      Post id.
 * @return array<string,mixed>|null Null when the post vanished.
 */
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
		// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Applying Core's own content pipeline, not declaring a hook.
		'content' => (string) apply_filters( 'the_content', (string) $post->post_content ),
		'folders' => $folders,
	);
}

/**
 * The rows inside one relation sub-folder. Uniform shape: `id`,
 * `title`, `subtitle`, `icon` | `thumb`, `editUrl`.
 *
 * @param Os                  $os       Host handle.
 * @param array<string,mixed> $section  Section descriptor.
 * @param int                 $id       Post id.
 * @param string              $relation Relation slug.
 * @return array{label:string,rows:array[]}|null
 */
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
						/* translators: %s: entry count. */
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
				// A grid of identical clock icons, each labelled with
				// Core's whole "author, 2 days ago (October 6, 2026 @
				// 09:22:49)" sentence, told revisions apart by nothing
				// a glance could catch. The author's face is the
				// picture, the label is just "2 days ago", and the
				// author and exact date ride in the tooltip.
				$facts  = revision_facts( $revision );
				$rows[] = array(
					'id'       => (int) $revision->ID,
					'title'    => $facts['autosave']
						/* translators: %s: how long ago, e.g. "2 days ago". */
						? sprintf( __( '%s · Autosave', 'desktop-mode' ), $facts['ago'] )
						: $facts['ago'],
					'subtitle' => $facts['author'] . ' · ' . $facts['date'],
					'thumb'    => $facts['avatar'],
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

/**
 * The facts a revision is told apart by: who saved it, how long ago,
 * the exact moment, whether it was an autosave, and the author's face.
 *
 * A revision whose author was deleted keeps a dangling `post_author`;
 * it reads "Unknown author" rather than Core's leading ", 3 weeks ago".
 *
 * @param \WP_Post $revision Revision post.
 * @return array{author: string, ago: string, date: string, autosave: bool, avatar: string}
 */
function revision_facts( $revision ) {
	$author_id = (int) $revision->post_author;
	$author    = $author_id ? (string) get_the_author_meta( 'display_name', $author_id ) : '';
	$saved_gmt = (int) get_post_modified_time( 'U', true, $revision );

	return array(
		'author'   => '' !== $author ? openstation_plain_text_title( $author ) : __( 'Unknown author', 'desktop-mode' ),
		/* translators: %s: human-readable time difference, e.g. "2 days". */
		'ago'      => sprintf( __( '%s ago', 'desktop-mode' ), human_time_diff( $saved_gmt ) ),
		'date'     => (string) wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $saved_gmt ),
		'autosave' => (bool) wp_is_post_autosave( $revision ),
		'avatar'   => '' !== $author ? (string) get_avatar_url( $author_id, array( 'size' => 128 ) ) : '',
	);
}

/**
 * Invoke one of WP Explorer's stats REST callbacks in-process, with a
 * synthetic request — the panes render the SAME payloads WP Explorer
 * renders, filters (`openstation_my_wordpress_term_stats` and
 * friends) included.
 *
 * @param string              $callback Function name.
 * @param array<string,mixed> $params   Request params.
 * @return array<string,mixed>|null Null when unavailable or refused.
 */
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

/**
 * The right-pane dossier for one SELECTED sub-list row, per relation:
 * the term-stats card for a category or tag (stat tiles, 12-month
 * activity, first/last post, recent posts), the user dossier + stats
 * for author/contributors, the comment dossier, the media dossier
 * with its usage scan, a revision preview.
 *
 * @param Os                  $os       Host handle.
 * @param array<string,mixed> $section  Section descriptor.
 * @param int                 $post_id  Post navigated into.
 * @param string              $relation Relation slug.
 * @param int                 $row_id   Selected row id.
 * @return array<string,mixed>|null
 */
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
			$facts = revision_facts( $revision );
			return array(
				'kind'    => 'revision',
				// Plain text, built from the same facts as the tile: Core's
				// expanded title leads with an avatar <img> and, for a
				// deleted author, with a stray ", ".
				'title'   => sprintf(
					/* translators: 1: author name, 2: how long ago, 3: exact date. */
					__( '%1$s, %2$s (%3$s)', 'desktop-mode' ),
					$facts['author'],
					$facts['ago'],
					$facts['date']
				),
				'author'  => $facts['author'],
				'date'    => (string) get_the_date( '', $revision ) . ' ' . get_the_time( '', $revision ),
				'content' => wp_kses_post( (string) apply_filters( 'the_content', (string) $revision->post_content ) ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound -- Core's own content pipeline.
			);
	}
	return null;
}

/**
 * The choices the Edit… modal offers: the site's authors, the
 * category tree (in `<os-category-picker>`'s item shape, `parent`
 * included) and the tag terms the token field suggests from. Only
 * computed while a post-kind section is open.
 *
 * @return array{authors:array[],categories:array[],tags:array[]}
 */
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

/**
 * The preview-action descriptors the acting user may see — the same
 * `openstation_my_wordpress_preview_actions` pipeline WP Explorer
 * collects, minus the fields the client does not need.
 *
 * @param Os $os Host handle.
 * @return array<int,array<string,mixed>>
 */
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
