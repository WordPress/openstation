<?php

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M11 13h12.2a3 3 0 0 1 2.4 1.2l2.8 3.7a3 3 0 0 0 2.4 1.2H53a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="35.6" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 30.6v10M27.4 33l4.6 7.6 4.6-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function sections( Os $os ) {
	$sections = array(
		array(
			'id'         => 'posts',
			'label'      => __( 'Posts', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-post',
			'kind'       => 'post',
			'post_type'  => 'post',
			'capability' => 'edit_posts',
			'thumbnails' => true,

			'restPath'   => 'wp/v2/posts',
		),
		array(
			'id'           => 'pages',
			'label'        => __( 'Pages', 'desktop-mode' ),
			'icon'         => 'dashicons-admin-page',
			'kind'         => 'post',
			'post_type'    => 'page',
			'capability'   => 'edit_pages',
			'thumbnails'   => true,

			'hierarchical' => true,
			'restPath'     => 'wp/v2/pages',
		),
		array(
			'id'         => 'media',
			'label'      => __( 'Media', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-media',
			'kind'       => 'media',
			'post_type'  => 'attachment',
			'capability' => 'upload_files',
			'thumbnails' => true,
		),
		array(
			'id'         => 'users',
			'label'      => __( 'Users', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-users',
			'kind'       => 'user',
			'post_type'  => '',
			'capability' => 'list_users',
			'thumbnails' => true,

			'canAdd'     => current_user_can( 'create_users' )
				|| ( is_multisite() && current_user_can( 'promote_users' ) ),
		),
	);

	$sections = array_merge( $sections, woo_sections( $os ) );

	if ( function_exists( 'openstation_my_wordpress_eligible_post_types' ) ) {
		$claimed = array_column( $sections, 'post_type' );
		foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {

			if ( in_array( (string) $name, $claimed, true ) ) {
				continue;
			}
			$group      = function_exists( 'openstation_my_wordpress_post_type_group' )
				? openstation_my_wordpress_post_type_group( $name )
				: null;
			$entry      = array(
				'id'           => 'cpt-' . $name,
				'label'        => isset( $post_type->labels->name ) && '' !== $post_type->labels->name
					? (string) $post_type->labels->name
					: (string) $name,
				'icon'         => function_exists( 'openstation_my_wordpress_post_type_icon' )
					? openstation_my_wordpress_post_type_icon( $post_type )
					: 'dashicons-admin-post',
				'kind'         => 'post',
				'post_type'    => (string) $name,
				'capability'   => (string) $post_type->cap->edit_posts,
				'thumbnails'   => post_type_supports( $name, 'thumbnail' ),
				'hierarchical' => is_post_type_hierarchical( $name ),
				'group'        => $group ? (string) $group['id'] : null,
				'groupLabel'   => $group ? (string) $group['label'] : null,
				'groupIcon'    => $group ? (string) $group['icon'] : null,
				'groupOrder'   => $group ? (int) $group['order'] : null,
				'restPath'     => function_exists( 'openstation_my_wordpress_post_type_rest_path' )
					? (string) openstation_my_wordpress_post_type_rest_path( $post_type )
					: '',
			);
			$sections[] = woo_decorate_section( $entry, $post_type );
		}
	}

	if ( function_exists( 'openstation_agents_user_can_read' ) && openstation_agents_user_can_read() ) {
		$sections[] = array(
			'id'         => 'agents',
			'label'      => __( 'Agents', 'desktop-mode' ),
			'icon'       => function_exists( 'openstation_agent_avatar_url' )
				? openstation_agent_avatar_url()
				: 'dashicons-superhero',
			'kind'       => 'agent',
			'post_type'  => '',
			'capability' => '',
			'thumbnails' => false,
		);
	}

	$sections = (array) $os->filter( 'openstation_my_wordpress_app_sections', $sections );

	return array_values(
		array_filter(
			$sections,
			static function ( $section ) use ( $os ) {
				return is_array( $section ) && ! empty( $section['id'] )
					&& ( empty( $section['capability'] ) || $os->can( (string) $section['capability'] ) );
			}
		)
	);
}

function section_of( Os $os, $id ) {
	foreach ( sections( $os ) as $section ) {
		if ( $section['id'] === $id ) {
			return $section;
		}
	}
	return null;
}

function groups( array $sections ) {
	if ( function_exists( 'openstation_my_wordpress_collect_groups' ) ) {
		return openstation_my_wordpress_collect_groups( $sections );
	}
	$groups = array();
	foreach ( $sections as $section ) {
		if ( ! empty( $section['group'] ) && ! isset( $groups[ $section['group'] ] ) ) {
			$groups[ $section['group'] ] = array(
				'id'    => (string) $section['group'],
				'label' => (string) ( $section['groupLabel'] ?? $section['group'] ),
				'icon'  => (string) ( $section['groupIcon'] ?? 'dashicons-admin-plugins' ),
				'order' => (int) ( $section['groupOrder'] ?? 20 ),
			);
		}
	}
	return array_values( $groups );
}

function statuses() {
	return array( 'publish', 'future', 'draft', 'pending', 'private' );
}

function sort_options( array $section ) {
	if ( 'agent' === $section['kind'] ) {
		return array();
	}
	$woo = woo_sort_options( $section );
	if ( null !== $woo ) {
		return $woo;
	}

	if ( 'user' === $section['kind'] ) {
		return array(
			'default'    => array( __( 'Name A–Z', 'desktop-mode' ), 'display_name', 'ASC' ),
			'title-desc' => array( __( 'Name Z–A', 'desktop-mode' ), 'display_name', 'DESC' ),
			'newest'     => array( __( 'Recently registered', 'desktop-mode' ), 'registered', 'DESC' ),
			'oldest'     => array( __( 'Longest registered', 'desktop-mode' ), 'registered', 'ASC' ),
			'id-asc'     => array( __( 'ID, lowest first', 'desktop-mode' ), 'ID', 'ASC' ),
			'id-desc'    => array( __( 'ID, highest first', 'desktop-mode' ), 'ID', 'DESC' ),
			'login-asc'  => array( __( 'Username A–Z', 'desktop-mode' ), 'login', 'ASC' ),
			'login-desc' => array( __( 'Username Z–A', 'desktop-mode' ), 'login', 'DESC' ),
			'email-asc'  => array( __( 'Email A–Z', 'desktop-mode' ), 'email', 'ASC' ),
			'email-desc' => array( __( 'Email Z–A', 'desktop-mode' ), 'email', 'DESC' ),
			'posts'      => array( __( 'Most posts', 'desktop-mode' ), 'post_count', 'DESC' ),
			'posts-asc'  => array( __( 'Fewest posts', 'desktop-mode' ), 'post_count', 'ASC' ),
		);
	}
	$options = array(
		'default'      => array( __( 'Newest first', 'desktop-mode' ), 'date', 'DESC' ),
		'oldest'       => array( __( 'Oldest first', 'desktop-mode' ), 'date', 'ASC' ),
		'title-asc'    => array( __( 'Title A–Z', 'desktop-mode' ), 'title', 'ASC' ),
		'title-desc'   => array( __( 'Title Z–A', 'desktop-mode' ), 'title', 'DESC' ),
		'id-asc'       => array( __( 'ID, lowest first', 'desktop-mode' ), 'ID', 'ASC' ),
		'id-desc'      => array( __( 'ID, highest first', 'desktop-mode' ), 'ID', 'DESC' ),
		'modified'     => array( __( 'Recently modified', 'desktop-mode' ), 'modified', 'DESC' ),
		'modified-asc' => array( __( 'Least recently modified', 'desktop-mode' ), 'modified', 'ASC' ),
		'slug-asc'     => array( __( 'Slug A–Z', 'desktop-mode' ), 'name', 'ASC' ),
		'slug-desc'    => array( __( 'Slug Z–A', 'desktop-mode' ), 'name', 'DESC' ),
	);
	if ( 'media' !== $section['kind'] ) {
		$options['comments']     = array( __( 'Most comments', 'desktop-mode' ), 'comment_count', 'DESC' );
		$options['comments-asc'] = array( __( 'Fewest comments', 'desktop-mode' ), 'comment_count', 'ASC' );
	}
	return $options;
}

function sort_of( array $section, State $state ) {
	$options = sort_options( $section );
	$picked  = (string) $state->get( 'sort' );
	$row     = $options[ isset( $options[ $picked ] ) ? $picked : 'default' ];
	return array( $row[1], $row[2] );
}
