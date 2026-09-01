<?php
/**
 * My WordPress — the section registry.
 *
 * Part of the `my-wordpress` app: required by `my-wordpress.os.php`,
 * same namespace, plain `.php` on purpose — only `*.os.php` files are
 * app entries to the framework loader. This part owns what the
 * explorer OFFERS: the four builtins, every eligible custom post type
 * with its plugin-group folder (discovered through the same
 * `openstation_my_wordpress_*` helpers WP Explorer uses), the Agents
 * tile, and the per-kind sort options.
 *
 * @package OpenStation
 */

namespace OpenStation\Apps\MyWordPress;

use OpenStation\App\Os;
use OpenStation\App\State;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/** A folder wearing the OpenStation mark — the explorer family icon. */
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M11 13h12.2a3 3 0 0 1 2.4 1.2l2.8 3.7a3 3 0 0 0 2.4 1.2H53a4 4 0 0 1 4 4v25a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V17a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="35.6" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 30.6v10M27.4 33l4.6 7.6 4.6-7.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Every section the current user may browse: the four builtins plus
 * one per eligible custom post type, carrying the same group fields
 * WP Explorer computes (`group`, `groupLabel`, `groupIcon`,
 * `groupOrder`) so plugin CPTs fold into plugin folders at the root.
 *
 * @param Os $os Host handle.
 * @return array<int,array<string,mixed>>
 */
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
		),
		array(
			'id'         => 'pages',
			'label'      => __( 'Pages', 'desktop-mode' ),
			'icon'       => 'dashicons-admin-page',
			'kind'       => 'post',
			'post_type'  => 'page',
			'capability' => 'edit_pages',
			'thumbnails' => true,
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
		),
	);

	// Every eligible CPT, through the same discovery WP Explorer uses —
	// one list of what the site contains, two windows rendering it.
	if ( function_exists( 'openstation_my_wordpress_eligible_post_types' ) ) {
		foreach ( openstation_my_wordpress_eligible_post_types() as $name => $post_type ) {
			$group      = function_exists( 'openstation_my_wordpress_post_type_group' )
				? openstation_my_wordpress_post_type_group( $name )
				: null;
			$sections[] = array(
				'id'         => 'cpt-' . $name,
				'label'      => isset( $post_type->labels->name ) && '' !== $post_type->labels->name
					? (string) $post_type->labels->name
					: (string) $name,
				'icon'       => function_exists( 'openstation_my_wordpress_post_type_icon' )
					? openstation_my_wordpress_post_type_icon( $post_type )
					: 'dashicons-admin-post',
				'kind'       => 'post',
				'post_type'  => (string) $name,
				'capability' => (string) $post_type->cap->edit_posts,
				'thumbnails' => post_type_supports( $name, 'thumbnail' ),
				'group'      => $group ? (string) $group['id'] : null,
				'groupLabel' => $group ? (string) $group['label'] : null,
				'groupIcon'  => $group ? (string) $group['icon'] : null,
				'groupOrder' => $group ? (int) $group['order'] : null,
			);
		}
	}

	// The Agents section, exactly as WP Explorer lists it: always
	// discoverable while the user may read agents, even when the
	// framework is off — the section itself explains how to turn it on.
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

	/**
	 * Filter the sections the My WordPress app offers. Runs on every
	 * render — a post type registered at any point of the bootstrap
	 * can appear, unlike a list frozen at registration time.
	 *
	 * @param array[] $sections Each: `id`, `label`, `icon`, `kind`
	 *                          (`post` | `media` | `user` | `agent`),
	 *                          `post_type`, `capability`, `thumbnails`,
	 *                          and the optional `group*` folder fields.
	 */
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

/**
 * One section by id, or null.
 *
 * @param Os     $os Host handle.
 * @param string $id Section id.
 * @return array<string,mixed>|null
 */
function section_of( Os $os, $id ) {
	foreach ( sections( $os ) as $section ) {
		if ( $section['id'] === $id ) {
			return $section;
		}
	}
	return null;
}

/**
 * The plugin folders the grouped sections fold into, through the
 * same collector (and `openstation_my_wordpress_post_type_groups`
 * filter) WP Explorer uses.
 *
 * @param array[] $sections Section descriptors.
 * @return array[] Each: `id`, `label`, `icon`, `order`.
 */
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

/**
 * The statuses the explorer lists: everything an editor works on.
 *
 * @return string[]
 */
function statuses() {
	return array( 'publish', 'future', 'draft', 'pending', 'private' );
}

/**
 * Sort options for a section's kind: `value => [ label, orderby, order ]`.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @return array<string,array{0:string,1:string,2:string}>
 */
function sort_options( array $section ) {
	if ( 'agent' === $section['kind'] ) {
		return array();
	}
	if ( 'user' === $section['kind'] ) {
		return array(
			'default'    => array( __( 'Name A–Z', 'desktop-mode' ), 'display_name', 'ASC' ),
			'title-desc' => array( __( 'Name Z–A', 'desktop-mode' ), 'display_name', 'DESC' ),
			'newest'     => array( __( 'Recently registered', 'desktop-mode' ), 'registered', 'DESC' ),
		);
	}
	return array(
		'default'    => array( __( 'Newest first', 'desktop-mode' ), 'date', 'DESC' ),
		'oldest'     => array( __( 'Oldest first', 'desktop-mode' ), 'date', 'ASC' ),
		'title-asc'  => array( __( 'Title A–Z', 'desktop-mode' ), 'title', 'ASC' ),
		'title-desc' => array( __( 'Title Z–A', 'desktop-mode' ), 'title', 'DESC' ),
	);
}

/**
 * The (orderby, order) pair the state's `sort` resolves to.
 *
 * @param array<string,mixed> $section Section descriptor.
 * @param State               $state   State.
 * @return array{0:string,1:string}
 */
function sort_of( array $section, State $state ) {
	$options = sort_options( $section );
	$picked  = (string) $state->get( 'sort' );
	$row     = $options[ isset( $options[ $picked ] ) ? $picked : 'default' ];
	return array( $row[1], $row[2] );
}
