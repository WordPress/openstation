<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const PER_PAGE       = 24;
const MEDIA_PER_PAGE = 48;

function allowed( Os $os, array $section, $id, $verb ) {
	$woo = woo_allowed( $section, (int) $id, $verb );
	if ( null !== $woo ) {
		return $woo;
	}
	if ( 'user' === $section['kind'] ) {
		return 'edit' === $verb && $os->can( 'edit_user', (int) $id );
	}
	return $os->can( $verb . '_post', (int) $id );
}

function lock_holder( $post_id ) {
	if ( ! function_exists( 'openstation_my_wordpress_post_lock_payload' ) ) {
		return '';
	}
	$lock = openstation_my_wordpress_post_lock_payload( (int) $post_id );
	if ( is_array( $lock ) ) {
		return (string) $lock['userName'];
	}
	return '';
}

function rest_extras( \WP_Post $post ) {
	$meta = array();
	foreach ( get_registered_meta_keys( 'post', (string) $post->post_type ) as $key => $args ) {
		if ( ! empty( $args['show_in_rest'] ) ) {
			$meta[ $key ] = get_post_meta( $post->ID, $key, true );
		}
	}

	$extras = array( 'meta' => array() === $meta ? new \stdClass() : $meta );
	foreach ( get_object_taxonomies( $post->post_type, 'objects' ) as $taxonomy ) {
		if ( empty( $taxonomy->show_in_rest ) ) {
			continue;
		}
		$base            = isset( $taxonomy->rest_base ) && '' !== (string) $taxonomy->rest_base
			? (string) $taxonomy->rest_base
			: (string) $taxonomy->name;
		$ids             = wp_get_object_terms( $post->ID, $taxonomy->name, array( 'fields' => 'ids' ) );
		$extras[ $base ] = is_wp_error( $ids ) ? array() : array_map( 'intval', $ids );
	}
	return $extras;
}

function tiebroken( $by, $order, $tiebreak ) {
	if ( 'ID' === $by ) {
		return array( 'ID' => $order );
	}
	return array(
		$by  => $order,
		'ID' => $tiebreak,
	);
}

function fetch( Os $os, array $section, State $state ) {

	$woo_page = woo_list( $os, $section, $state );
	if ( null !== $woo_page ) {
		return $woo_page;
	}

	$query              = (string) $state->get( 'query' );
	$page               = max( 1, (int) $state->get( 'page' ) );
	list( $by, $order ) = sort_of( $section, $state );

	if ( 'user' === $section['kind'] ) {
		$users   = new \WP_User_Query(
			array(
				'number'      => PER_PAGE,
				'offset'      => ( $page - 1 ) * PER_PAGE,
				'search'      => '' !== $query ? '*' . $query . '*' : '',

				'orderby'     => tiebroken( $by, $order, 'ASC' ),
				'count_total' => true,
			)
		);
		$results = $users->get_results();

		$counts = count_many_users_posts( wp_list_pluck( $results, 'ID' ), 'post', true );
		$items  = array();
		foreach ( $results as $user ) {
			$items[] = user_row(
				$user,
				static function ( $user_id ) use ( $os, $section ) {
					return allowed( $os, $section, $user_id, 'edit' );
				},
				(int) ( $counts[ $user->ID ] ?? 0 )
			);
		}
		return Os::page( $items, $users->get_total(), $page, PER_PAGE );
	}

	$is_media = 'media' === $section['kind'];
	$per_page = $is_media ? MEDIA_PER_PAGE : PER_PAGE;
	$args     = array(
		'post_type'      => (string) $section['post_type'],
		'post_status'    => $is_media ? 'inherit' : statuses(),
		's'              => $query,
		'posts_per_page' => $per_page,
		'paged'          => $page,

		'orderby'        => tiebroken( $by, $order, 'DESC' ),
	);

	$posts = new \WP_Query( woo_query_args( $args, $section, $state ) );
	$items = array();
	foreach ( $posts->posts as $post ) {
		$items[] = array(
			'id'        => (int) $post->ID,
			'title'     => '' !== $post->post_title ? openstation_plain_text_title( $post->post_title ) : __( '(no title)', 'desktop-mode' ),
			'subtitle'  => $is_media
				? (string) $post->post_mime_type
				: sprintf(

					__( '%1$s — %2$s', 'desktop-mode' ),
					openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $post->post_author ) ),
					(string) get_the_date( '', $post )
				),
			'status'    => $is_media ? '' : (string) $post->post_status,

			'excerpt'   => $is_media
				? ''
				: mb_substr(
					html_entity_decode( wp_strip_all_tags( (string) get_the_excerpt( $post ) ), ENT_QUOTES | ENT_HTML5, 'UTF-8' ),
					0,
					240
				),
			'thumb'     => ! empty( $section['thumbnails'] )
				? ( $is_media
					? (string) wp_get_attachment_image_url( $post->ID, 'medium' )
					: (string) get_the_post_thumbnail_url( $post, 'thumbnail' ) )
				: '',
			'link'      => esc_url_raw( $is_media ? (string) wp_get_attachment_url( $post->ID ) : (string) get_permalink( $post ) ),
			'mime'      => $is_media ? (string) $post->post_mime_type : '',
			'lockedBy'  => $is_media ? '' : lock_holder( $post->ID ),
			'canEdit'   => allowed( $os, $section, (int) $post->ID, 'edit' ),
			'canDelete' => allowed( $os, $section, (int) $post->ID, 'delete' ),
		);

		$items[ count( $items ) - 1 ] += $is_media ? media_facts( $post ) : post_facts( $post );
		if ( ! $is_media ) {

			$items[ count( $items ) - 1 ] += rest_extras( $post );

			$items[ count( $items ) - 1 ] += woo_extras( $post );
		}
	}
	return Os::page( $items, $posts->found_posts, $page, $per_page );
}

function post_facts( \WP_Post $post ) {
	$parent    = (int) $post->post_parent;
	$shortlink = (string) wp_get_shortlink( $post->ID );
	return array(
		'slug'        => (string) $post->post_name,
		'author'      => openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $post->post_author ) ),
		'authorId'    => (int) $post->post_author,
		'date'        => (string) get_the_date( 'c', $post ),
		'modified'    => (string) get_the_modified_date( 'c', $post ),
		'comments'    => (int) $post->comment_count,
		'shortlink'   => '' !== $shortlink ? esc_url_raw( $shortlink ) : '',
		'parent'      => $parent,
		'parentTitle' => $parent > 0 ? openstation_plain_text_title( get_the_title( $parent ) ) : '',
		'words'       => str_word_count( wp_strip_all_tags( (string) $post->post_content ) ),
	);
}

function media_facts( \WP_Post $post ) {
	$file   = get_attached_file( $post->ID );
	$meta   = (array) wp_get_attachment_metadata( $post->ID );
	$bytes  = $file && file_exists( $file ) ? (int) filesize( $file ) : 0;
	$parent = (int) $post->post_parent;
	return array(
		'slug'        => (string) $post->post_name,
		'file'        => $file ? wp_basename( $file ) : '',
		'bytes'       => $bytes,
		'size'        => $bytes > 0 ? (string) size_format( $bytes ) : '',
		'dimensions'  => isset( $meta['width'], $meta['height'] ) ? $meta['width'] . ' × ' . $meta['height'] : '',
		'alt'         => (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ),
		'author'      => openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $post->post_author ) ),
		'authorId'    => (int) $post->post_author,
		'date'        => (string) get_the_date( 'c', $post ),
		'modified'    => (string) get_the_modified_date( 'c', $post ),
		'parent'      => $parent,
		'parentTitle' => $parent > 0 ? openstation_plain_text_title( get_the_title( $parent ) ) : '',
	);
}

function user_row( \WP_User $user, callable $can_edit, $post_count = null ) {
	return array(
		'id'         => (int) $user->ID,
		'title'      => openstation_plain_text_title( $user->display_name ),

		'name'       => openstation_plain_text_title( $user->display_name ),
		'subtitle'   => (string) $user->user_email,
		'status'     => implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ),
		'excerpt'    => '',
		'thumb'      => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
		'link'       => esc_url_raw( get_author_posts_url( $user->ID ) ),
		'mime'       => '',
		'lockedBy'   => '',
		'canEdit'    => (bool) $can_edit( (int) $user->ID ),
		'canDelete'  => false,

		'login'      => (string) $user->user_login,
		'email'      => (string) $user->user_email,
		'roles'      => array_values( array_map( 'strval', (array) $user->roles ) ),

		'registered' => (string) get_date_from_gmt( (string) $user->user_registered, 'c' ),
		'posts'      => null === $post_count
			? (int) count_user_posts( $user->ID, 'post', true )
			: (int) $post_count,
	);
}

function count_of( array $section ) {
	$woo = woo_count( $section );
	if ( null !== $woo ) {
		return $woo;
	}
	if ( 'agent' === $section['kind'] ) {

		return function_exists( 'openstation_agent_get_agents' )
			? count( openstation_agent_get_agents() )
			: 0;
	}
	if ( 'user' === $section['kind'] ) {
		$counts = count_users();
		return (int) $counts['total_users'];
	}
	$counts = wp_count_posts( (string) $section['post_type'] );
	if ( 'media' === $section['kind'] ) {
		return (int) ( $counts->inherit ?? 0 );
	}
	$total = 0;
	foreach ( statuses() as $status ) {
		$total += (int) ( $counts->$status ?? 0 );
	}
	return $total;
}

function edit_url( array $section, $id ) {
	$woo = woo_edit_url( $section, (int) $id );
	if ( '' !== $woo ) {
		return $woo;
	}
	if ( 'user' === $section['kind'] ) {
		return admin_url( 'user-edit.php?user_id=' . (int) $id );
	}
	return admin_url( 'post.php?post=' . (int) $id . '&action=edit' );
}

function edit_title( array $section, $id ) {

	if ( woo_section_is( $section, 'wc-orders' ) ) {
		$detail = woo_detail( $section, (int) $id );
		return $detail ? (string) $detail['title'] : '';
	}
	if ( 'user' === $section['kind'] ) {
		$user = get_userdata( (int) $id );
		return $user ? openstation_plain_text_title( $user->display_name ) : '';
	}
	$post = get_post( (int) $id );
	if ( ! $post ) {
		return '';
	}
	$title = openstation_plain_text_title( $post->post_title );
	return '' !== $title ? $title : __( '(no title)', 'desktop-mode' );
}

function detail( Os $os, array $section, $id ) {
	if ( woo_section_is( $section, 'wc-orders' ) ) {
		return woo_detail( $section, $id );
	}
	if ( 'user' === $section['kind'] ) {
		$user = get_userdata( $id );
		if ( ! $user ) {
			return null;
		}

		return array(
			'kind'      => 'user',
			'id'        => $id,
			'title'     => openstation_plain_text_title( $user->display_name ),
			'avatar'    => (string) get_avatar_url( $id, array( 'size' => 192 ) ),
			'facts'     => Os::facts(
				array(
					array( __( 'Email', 'desktop-mode' ), (string) $user->user_email, 'bio' ),
					array( __( 'Role', 'desktop-mode' ), implode( ', ', array_map( 'ucfirst', (array) $user->roles ) ), 'bio' ),
					array( __( 'Registered', 'desktop-mode' ), (string) date_i18n( get_option( 'date_format' ), strtotime( $user->user_registered ) ), 'bio' ),
				)
			),
			'stats'     => stats_payload( 'openstation_my_wordpress_user_stats_callback', array( 'id' => $id ) ),
			'canEdit'   => allowed( $os, $section, $id, 'edit' ),
			'canDelete' => false,
		);
	}

	$post = get_post( $id );
	if ( ! $post || $post->post_type !== $section['post_type'] ) {
		return null;
	}
	$title = '' !== $post->post_title ? openstation_plain_text_title( $post->post_title ) : __( '(no title)', 'desktop-mode' );

	if ( 'media' === $section['kind'] ) {
		$file = get_attached_file( $id );
		$meta = (array) wp_get_attachment_metadata( $id );
		$used = array();
		if ( function_exists( 'openstation_my_wordpress_media_usage_build' ) ) {
			foreach ( array_slice( (array) ( openstation_my_wordpress_media_usage_build( $post )['usedIn'] ?? array() ), 0, 12 ) as $row ) {
				$used[] = array(
					'title'  => openstation_plain_text_title( $row['title'] ?? '' ),
					'usedAs' => (string) ( $row['usedAs'] ?? '' ),
				);
			}
		}
		return array(
			'kind'      => 'media',
			'id'        => $id,
			'title'     => $title,
			'mime'      => (string) $post->post_mime_type,
			'image'     => (string) wp_get_attachment_image_url( $id, 'large' ),
			'full'      => (string) wp_get_attachment_image_url( $id, 'full' ),
			'facts'     => Os::facts(
				array(
					array( __( 'Type', 'desktop-mode' ), (string) $post->post_mime_type ),
					array( __( 'Size', 'desktop-mode' ), $file && file_exists( $file ) ? (string) size_format( (int) filesize( $file ) ) : '' ),
					array(
						__( 'Dimensions', 'desktop-mode' ),
						isset( $meta['width'], $meta['height'] ) ? $meta['width'] . ' × ' . $meta['height'] : '',
					),
					array( __( 'Uploaded', 'desktop-mode' ), (string) get_the_date( '', $post ) ),
				)
			),
			'usedIn'    => $used,
			'canEdit'   => allowed( $os, $section, $id, 'edit' ),
			'canDelete' => allowed( $os, $section, $id, 'delete' ),
		);
	}

	$content = apply_filters( 'the_content', (string) $post->post_content );

	return array(
		'kind'      => 'post',
		'id'        => $id,
		'title'     => $title,
		'image'     => (string) get_the_post_thumbnail_url( $post, 'large' ),
		'content'   => (string) $content,
		'lockedBy'  => lock_holder( $id ),
		'facts'     => Os::facts(
			array(
				array( __( 'Status', 'desktop-mode' ), ucfirst( (string) $post->post_status ) ),
				array( __( 'Author', 'desktop-mode' ), openstation_plain_text_title( get_the_author_meta( 'display_name', (int) $post->post_author ) ) ),
				array( __( 'Published', 'desktop-mode' ), (string) get_the_date( '', $post ) ),
				array( __( 'Modified', 'desktop-mode' ), (string) get_the_modified_date( '', $post ) ),
				array( __( 'Words', 'desktop-mode' ), number_format_i18n( str_word_count( wp_strip_all_tags( (string) $post->post_content ) ) ) ),
			)
		),
		'canEdit'   => allowed( $os, $section, $id, 'edit' ),
		'canDelete' => allowed( $os, $section, $id, 'delete' ),
	);
}
