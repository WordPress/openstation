<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AI_SEARCH_MAX_ITERATIONS = 10;

const OPENSTATION_AI_SEARCH_BATCH_SIZE = 10;

function openstation_ai_get_admin_page_catalog() {
	$catalog = array(
		array(
			'title'       => __( 'Dashboard', 'desktop-mode' ),
			'url'         => admin_url( 'index.php' ),
			'icon'        => 'dashicons-dashboard',
			'description' => __( 'The main admin dashboard: activity, drafts, site overview.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'All Posts', 'desktop-mode' ),
			'url'         => admin_url( 'edit.php' ),
			'icon'        => 'dashicons-admin-post',
			'description' => __( 'List, edit, bulk-manage blog posts.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Add New Post', 'desktop-mode' ),
			'url'         => admin_url( 'post-new.php' ),
			'icon'        => 'dashicons-plus',
			'description' => __( 'Create a new blog post.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Categories', 'desktop-mode' ),
			'url'         => admin_url( 'edit-tags.php?taxonomy=category' ),
			'icon'        => 'dashicons-category',
			'description' => __( 'Manage post categories: add, rename, merge.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Tags', 'desktop-mode' ),
			'url'         => admin_url( 'edit-tags.php?taxonomy=post_tag' ),
			'icon'        => 'dashicons-tag',
			'description' => __( 'Manage post tags.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'All Pages', 'desktop-mode' ),
			'url'         => admin_url( 'edit.php?post_type=page' ),
			'icon'        => 'dashicons-admin-page',
			'description' => __( 'List and edit static pages (About, Contact, etc.).', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Add New Page', 'desktop-mode' ),
			'url'         => admin_url( 'post-new.php?post_type=page' ),
			'icon'        => 'dashicons-plus',
			'description' => __( 'Create a new page.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Media Library', 'desktop-mode' ),
			'url'         => admin_url( 'upload.php' ),
			'icon'        => 'dashicons-admin-media',
			'description' => __( 'Browse, upload, and manage images, files, videos.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Comments', 'desktop-mode' ),
			'url'         => admin_url( 'edit-comments.php' ),
			'icon'        => 'dashicons-admin-comments',
			'description' => __( 'Moderate and reply to comments on posts and pages.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Themes', 'desktop-mode' ),
			'url'         => admin_url( 'themes.php' ),
			'icon'        => 'dashicons-admin-appearance',
			'description' => __( 'Change, install, or customize the active theme.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Customize', 'desktop-mode' ),
			'url'         => admin_url( 'customize.php' ),
			'icon'        => 'dashicons-admin-customizer',
			'description' => __( 'Live-preview theme customisation: colors, fonts, layout.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Widgets', 'desktop-mode' ),
			'url'         => admin_url( 'widgets.php' ),
			'icon'        => 'dashicons-screenoptions',
			'description' => __( 'Manage sidebar and footer widgets.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Menus', 'desktop-mode' ),
			'url'         => admin_url( 'nav-menus.php' ),
			'icon'        => 'dashicons-menu',
			'description' => __( 'Create and edit navigation menus.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Plugins', 'desktop-mode' ),
			'url'         => admin_url( 'plugins.php' ),
			'icon'        => 'dashicons-admin-plugins',
			'description' => __( 'Activate, deactivate, update or delete plugins.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Add New Plugin', 'desktop-mode' ),
			'url'         => admin_url( 'plugin-install.php' ),
			'icon'        => 'dashicons-plus',
			'description' => __( 'Search and install new plugins from the directory.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Users', 'desktop-mode' ),
			'url'         => admin_url( 'users.php' ),
			'icon'        => 'dashicons-admin-users',
			'description' => __( 'Manage user accounts and roles.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Add New User', 'desktop-mode' ),
			'url'         => admin_url( 'user-new.php' ),
			'icon'        => 'dashicons-plus',
			'description' => __( 'Create a new user account.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Your Profile', 'desktop-mode' ),
			'url'         => admin_url( 'profile.php' ),
			'icon'        => 'dashicons-id',
			'description' => __( 'Edit your own profile, password, admin colour scheme.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'General Settings', 'desktop-mode' ),
			'url'         => admin_url( 'options-general.php' ),
			'icon'        => 'dashicons-admin-settings',
			'description' => __( 'Site title, tagline, URL, timezone, language.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Writing Settings', 'desktop-mode' ),
			'url'         => admin_url( 'options-writing.php' ),
			'icon'        => 'dashicons-edit',
			'description' => __( 'Default post category, post format, remote publishing.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Reading Settings', 'desktop-mode' ),
			'url'         => admin_url( 'options-reading.php' ),
			'icon'        => 'dashicons-book',
			'description' => __( 'Homepage, blog posts per page, search-engine visibility.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Discussion Settings', 'desktop-mode' ),
			'url'         => admin_url( 'options-discussion.php' ),
			'icon'        => 'dashicons-format-chat',
			'description' => __( 'Comment moderation, avatars, email notifications.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Media Settings', 'desktop-mode' ),
			'url'         => admin_url( 'options-media.php' ),
			'icon'        => 'dashicons-format-image',
			'description' => __( 'Image size settings for thumbnail / medium / large.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Permalinks', 'desktop-mode' ),
			'url'         => admin_url( 'options-permalink.php' ),
			'icon'        => 'dashicons-admin-links',
			'description' => __( 'URL structure for posts, pages, categories, tags.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Privacy', 'desktop-mode' ),
			'url'         => admin_url( 'options-privacy.php' ),
			'icon'        => 'dashicons-privacy',
			'description' => __( 'Privacy policy page selection and preview.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Tools', 'desktop-mode' ),
			'url'         => admin_url( 'tools.php' ),
			'icon'        => 'dashicons-admin-tools',
			'description' => __( 'Built-in site tools.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Import', 'desktop-mode' ),
			'url'         => admin_url( 'import.php' ),
			'icon'        => 'dashicons-download',
			'description' => __( 'Import content from other platforms (WP, Tumblr, RSS, etc.).', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Export', 'desktop-mode' ),
			'url'         => admin_url( 'export.php' ),
			'icon'        => 'dashicons-upload',
			'description' => __( 'Export all site content as XML.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Site Health', 'desktop-mode' ),
			'url'         => admin_url( 'site-health.php' ),
			'icon'        => 'dashicons-heart',
			'description' => __( 'Performance and security recommendations for the site.', 'desktop-mode' ),
		),
		array(
			'title'       => __( 'Updates', 'desktop-mode' ),
			'url'         => admin_url( 'update-core.php' ),
			'icon'        => 'dashicons-update',
			'description' => __( 'WordPress, theme, and plugin updates.', 'desktop-mode' ),
		),
	);

	return (array) apply_filters( 'openstation_ai_admin_page_catalog', $catalog );
}

function openstation_ai_search_answer_schema() {
	return array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'answer_type', 'message', 'entity_id', 'entity_type', 'admin_links' ),
		'properties'           => array(
			'answer_type' => array(
				'type'        => 'string',
				'enum'        => array( 'entity', 'navigation', 'chat' ),
				'description' => 'Classification of the answer: "entity" when you identified a specific post/page/comment the user was asking about. "navigation" when you are returning admin_links: wp-admin destinations or plugin install links. "chat" for everything else, including summaries of tool results (error logs, site info), greetings, clarifications and "I couldn\'t find anything".',
			),
			'message'     => array(
				'type'        => 'string',
				'description' => 'A friendly, conversational response to show the user. Write in first person like a helpful assistant (e.g. "I found your Málaga post — this one", "Here\'s where you manage categories"). NOT a search-engine sentence ("Match found").',
			),
			'entity_id'   => array(
				'anyOf'       => array(
					array( 'type' => 'integer' ),
					array( 'type' => 'null' ),
				),
				'description' => 'The WordPress ID of the matching entity. Required when answer_type is "entity"; set to null otherwise.',
			),
			'entity_type' => array(
				'anyOf'       => array(
					array(
						'type' => 'string',
						'enum' => array( 'post', 'page', 'comment' ),
					),
					array( 'type' => 'null' ),
				),
				'description' => 'Type of the matching entity. Required when answer_type is "entity"; set to null otherwise.',
			),
			'admin_links' => array(
				'anyOf'       => array(
					array(
						'type'  => 'array',
						'items' => array(
							'type'                 => 'object',
							'additionalProperties' => false,
							'required'             => array( 'title', 'url', 'description', 'icon' ),
							'properties'           => array(
								'title'       => array( 'type' => 'string' ),
								'url'         => array( 'type' => 'string' ),
								'description' => array( 'type' => 'string' ),
								'icon'        => array( 'type' => 'string' ),
							),
						),
					),
					array( 'type' => 'null' ),
				),
				'description' => 'List of 1-3 wp-admin destinations (copy verbatim from the list_admin_pages tool result). Required when answer_type is "navigation"; set to null otherwise.',
			),
		),
	);
}

function openstation_ai_search_dispatch_tool( $tool_name, array $args ) {
	$offset = max( 0, (int) ( $args['offset'] ?? 0 ) );
	$query  = isset( $args['query'] ) ? sanitize_text_field( (string) $args['query'] ) : '';

	switch ( $tool_name ) {
		case 'search_posts':
			return openstation_ai_search_fetch_posts( 'post', $query, $offset );
		case 'search_pages':
			return openstation_ai_search_fetch_posts( 'page', $query, $offset );
		case 'search_comments':
			return openstation_ai_search_fetch_comments( $query, $offset );
		case 'search_comments_by_post':
			$post_id = max( 0, (int) ( $args['post_id'] ?? 0 ) );
			return openstation_ai_search_fetch_comments_by_post( $post_id, $query, $offset );
		case 'list_admin_pages':
			return array(
				'tool'  => 'list_admin_pages',
				'pages' => openstation_ai_get_admin_page_catalog(),
			);
		case 'search_wporg_plugins':
			$q = isset( $args['query'] ) ? sanitize_text_field( (string) $args['query'] ) : '';
			return openstation_ai_fetch_wporg_plugins( $q );
		case 'get_php_error_log':
			if ( ! current_user_can( 'manage_options' ) ) {
				return array(
					'tool'          => 'get_php_error_log',
					'log_available' => false,
					'error'         => 'Only administrators can access the PHP error log.',
					'entries'       => array(),
				);
			}
			$lines = isset( $args['lines'] ) ? max( 1, min( 500, (int) $args['lines'] ) ) : 50;
			return openstation_ai_fetch_error_log( $lines );
	}

	return array(
		'tool'     => $tool_name,
		'offset'   => $offset,
		'items'    => array(),
		'count'    => 0,
		'total'    => 0,
		'has_more' => false,
		'error'    => "Unknown tool '{$tool_name}'.",
	);
}

function openstation_ai_search_fetch_posts( $post_type, $query, $offset ) {
	$wp_query = new WP_Query(
		array(
			'post_type'              => $post_type,
			'post_status'            => 'publish',
			'has_password'           => false,
			's'                      => (string) $query,
			'posts_per_page'         => OPENSTATION_AI_SEARCH_BATCH_SIZE,
			'offset'                 => $offset,
			'no_found_rows'          => false,
			'update_post_term_cache' => false,
			'update_post_meta_cache' => false,
		)
	);

	$items = array();
	foreach ( $wp_query->posts as $post ) {
		$items[] = array(

			'id'       => $post->ID,
			'type'     => $post->post_type,

			'title'    => wp_strip_all_tags( $post->post_title ),
			'excerpt'  => openstation_ai_search_excerpt( $post->post_content ),
			'date'     => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',

			'url'      => (string) get_permalink( $post ),
			'edit_url' => (string) get_edit_post_link( $post->ID, 'raw' ),
		);
	}

	$total = (int) $wp_query->found_posts;

	return array(
		'tool'        => 'search_' . $post_type . 's',
		'query'       => (string) $query,
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE,
	);
}

function openstation_ai_search_excerpt( $content ) {
	$text = wp_strip_all_tags( (string) $content );
	$text = preg_replace( '/\s+/', ' ', trim( $text ) );
	return (string) mb_substr( $text, 0, 300 );
}

function openstation_ai_can_read_post( $post ) {

	if ( is_numeric( $post ) && (int) $post <= 0 ) {
		return false;
	}

	$post = get_post( $post );
	if ( ! $post instanceof WP_Post ) {
		return false;
	}

	if ( post_password_required( $post ) && ! current_user_can( 'edit_post', $post->ID ) ) {
		return false;
	}

	if ( is_post_publicly_viewable( $post ) ) {
		return true;
	}

	$post_type = get_post_type_object( $post->post_type );
	if ( ! $post_type || ! is_post_type_viewable( $post_type ) ) {
		return current_user_can( 'edit_post', $post->ID );
	}

	return current_user_can( 'read_post', $post->ID );
}

function openstation_ai_can_read_comment_parent( $comment ) {
	$comment = get_comment( $comment );
	if ( ! $comment instanceof WP_Comment ) {
		return false;
	}
	return openstation_ai_can_read_post( (int) $comment->comment_post_ID );
}

function openstation_ai_search_fetch_comments( $query, $offset ) {
	$base_args = array(
		'status' => 'approve',
		'type'   => 'comment',
		'search' => (string) $query,
	);

	$comments = get_comments(
		array_merge(
			$base_args,
			array(
				'number' => OPENSTATION_AI_SEARCH_BATCH_SIZE,
				'offset' => $offset,
				'count'  => false,
			)
		)
	);

	$total = (int) get_comments( array_merge( $base_args, array( 'count' => true ) ) );

	$parent_ids = array_unique(
		array_map(
			static function ( $c ) {
				return (int) $c->comment_post_ID;
			},
			$comments
		)
	);
	if ( $parent_ids ) {
		_prime_post_caches( $parent_ids, false, false );
	}

	$comments = array_values( array_filter( $comments, 'openstation_ai_can_read_comment_parent' ) );

	$items = array();
	foreach ( $comments as $comment ) {

		$parent_post  = get_post( $comment->comment_post_ID );
		$parent_title = wp_strip_all_tags( $parent_post->post_title );

		$items[] = array(
			'id'          => (int) $comment->comment_ID,
			'type'        => 'comment',

			'post_title'  => $parent_title,

			'author_name' => openstation_plain_text_title( get_comment_author( $comment ) ),
			'excerpt'     => openstation_ai_search_excerpt( $comment->comment_content ),

			'url'         => (string) get_comment_link( $comment ),
			'edit_url'    => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
			'post_id'     => (int) $comment->comment_post_ID,
			'post_url'    => (string) get_permalink( $parent_post ),
		);
	}

	return array(
		'tool'        => 'search_comments',
		'query'       => (string) $query,
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE,
	);
}

function openstation_ai_search_fetch_comments_by_post( $post_id, $query, $offset ) {
	$post_id = (int) $post_id;

	if ( $post_id <= 0 ) {
		return array(
			'tool'     => 'search_comments_by_post',
			'post_id'  => $post_id,
			'offset'   => $offset,
			'items'    => array(),
			'count'    => 0,
			'total'    => 0,
			'has_more' => false,
			'error'    => 'post_id must be a positive integer.',
		);
	}

	if ( ! openstation_ai_can_read_post( $post_id ) ) {
		return array(
			'tool'     => 'search_comments_by_post',
			'post_id'  => $post_id,
			'offset'   => $offset,
			'items'    => array(),
			'count'    => 0,
			'total'    => 0,
			'has_more' => false,
			'error'    => 'Post not found or not readable.',
		);
	}

	$base_args = array(
		'post_id' => $post_id,
		'status'  => 'approve',
		'type'    => 'comment',
		'search'  => (string) $query,
	);

	$comments = get_comments(
		array_merge(
			$base_args,
			array(
				'number' => OPENSTATION_AI_SEARCH_BATCH_SIZE,
				'offset' => $offset,
				'count'  => false,
			)
		)
	);

	$total = (int) get_comments( array_merge( $base_args, array( 'count' => true ) ) );

	$parent_post  = get_post( $post_id );
	$parent_title = wp_strip_all_tags( $parent_post->post_title );

	$items = array();
	foreach ( $comments as $comment ) {
		$items[] = array(
			'id'          => (int) $comment->comment_ID,
			'type'        => 'comment',
			'post_id'     => $post_id,
			'post_title'  => $parent_title,
			'author_name' => openstation_plain_text_title( get_comment_author( $comment ) ),
			'excerpt'     => openstation_ai_search_excerpt( $comment->comment_content ),
			'url'         => (string) get_comment_link( $comment ),
			'edit_url'    => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
		);
	}

	return array(
		'tool'        => 'search_comments_by_post',
		'post_id'     => $post_id,
		'post_title'  => $parent_title,
		'query'       => (string) $query,
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + OPENSTATION_AI_SEARCH_BATCH_SIZE,
	);
}

function openstation_ai_search_build_entity( $entity_type, $entity_id ) {
	$entity_id = (int) $entity_id;

	if ( in_array( $entity_type, array( 'post', 'page' ), true ) ) {
		$post = get_post( $entity_id );

		if ( ! $post instanceof WP_Post || ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
			return null;
		}

		if ( ! openstation_ai_can_read_post( $post ) ) {
			return null;
		}

		return array(
			'id'       => $entity_id,
			'type'     => $post->post_type,
			'title'    => openstation_plain_text_title( $post->post_title ),
			'status'   => $post->post_status,
			'date'     => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',
			'url'      => (string) get_permalink( $post ),
			'edit_url' => (string) get_edit_post_link( $entity_id, 'raw' ),
			'excerpt'  => openstation_ai_search_excerpt( $post->post_content ),
		);
	}

	if ( 'comment' === $entity_type ) {
		$comment = get_comment( $entity_id );

		if ( ! $comment instanceof WP_Comment || ! openstation_ai_can_read_comment_parent( $comment ) ) {
			return null;
		}

		if ( '1' !== (string) $comment->comment_approved && ! current_user_can( 'edit_comment', $entity_id ) ) {
			return null;
		}

		$can_moderate = current_user_can( 'moderate_comments' );
		$parent_post  = get_post( (int) $comment->comment_post_ID );

		$meta   = $can_moderate ? openstation_ai_get_meta( 'comment', $entity_id ) : null;
		$entity = array(
			'id'         => $entity_id,
			'type'       => 'comment',
			'excerpt'    => openstation_ai_search_excerpt( $comment->comment_content ),
			'post_id'    => (int) $comment->comment_post_ID,
			'post_title' => openstation_plain_text_title( $parent_post->post_title ),
			'post_url'   => (string) get_permalink( $parent_post ),
			'url'        => (string) get_comment_link( $comment ),
			'edit_url'   => current_user_can( 'edit_comment', $entity_id )
				? admin_url( 'comment.php?action=editcomment&c=' . $entity_id )
				: '',
		);

		if ( $can_moderate ) {
			$entity['harmful'] = $meta ? (bool) ( $meta['harmful'] ?? false ) : false;
			$entity['spam']    = $meta ? (bool) ( $meta['spam'] ?? false ) : false;
		}

		return $entity;
	}

	return null;
}

function openstation_ai_continue_label( $resume_tool, $from_item ) {
	switch ( $resume_tool ) {
		case 'search_pages':

			return sprintf( __( 'Continue searching in pages (from item %d)', 'desktop-mode' ), $from_item );
		case 'search_comments':

			return sprintf( __( 'Continue searching in comments (from item %d)', 'desktop-mode' ), $from_item );
		default:

			return sprintf( __( 'Continue searching in posts (from item %d)', 'desktop-mode' ), $from_item );
	}
}

function openstation_ai_search_resumable_tools() {
	return array( 'search_posts', 'search_pages', 'search_comments' );
}

function openstation_ai_normalize_tool_schema( $schema ) {
	if ( ! is_array( $schema ) || empty( $schema ) ) {
		return array(
			'type'       => 'object',
			'properties' => (object) array(),
		);
	}

	$schema = openstation_ai_strip_wp_schema_keys( $schema );

	$schema['type'] = 'object';

	unset( $schema['oneOf'], $schema['allOf'], $schema['anyOf'] );

	if ( ! isset( $schema['properties'] ) || array() === $schema['properties'] ) {
		$schema['properties'] = (object) array();
	}

	return $schema;
}

function openstation_ai_strip_wp_schema_keys( array $schema ) {
	unset( $schema['sanitize_callback'], $schema['validate_callback'], $schema['arg_options'] );

	foreach ( array( 'properties', 'patternProperties' ) as $map_key ) {
		if ( isset( $schema[ $map_key ] ) && is_array( $schema[ $map_key ] ) ) {
			foreach ( $schema[ $map_key ] as $name => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $map_key ][ $name ] = openstation_ai_strip_wp_schema_keys( $sub );
				}
			}
		}
	}

	if ( isset( $schema['items'] ) && is_array( $schema['items'] ) ) {
		$items   = $schema['items'];
		$is_list = array_keys( $items ) === range( 0, count( $items ) - 1 );
		if ( $is_list && array() !== $items ) {

			foreach ( $items as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$items[ $i ] = openstation_ai_strip_wp_schema_keys( $sub );
				}
			}
			$schema['items'] = $items;
		} else {
			$schema['items'] = openstation_ai_strip_wp_schema_keys( $items );
		}
	}

	if ( isset( $schema['additionalProperties'] ) && is_array( $schema['additionalProperties'] ) ) {
		$schema['additionalProperties'] = openstation_ai_strip_wp_schema_keys( $schema['additionalProperties'] );
	}

	foreach ( array( 'oneOf', 'allOf', 'anyOf' ) as $combinator ) {
		if ( isset( $schema[ $combinator ] ) && is_array( $schema[ $combinator ] ) ) {
			foreach ( $schema[ $combinator ] as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $combinator ][ $i ] = openstation_ai_strip_wp_schema_keys( $sub );
				}
			}
		}
	}

	return $schema;
}

function openstation_ai_run_search( $query, $initial_tool = null, $start_offset = 0, array $extra = array() ) {
	$start_offset = max( 0, (int) $start_offset );
	$search_tools = array( 'search_posts', 'search_pages', 'search_comments', 'search_comments_by_post' );
	$valid_tools  = array_merge(
		$search_tools,
		array( 'list_admin_pages', 'search_wporg_plugins', 'get_php_error_log' )
	);

	$user_id            = isset( $extra['user_id'] ) ? (int) $extra['user_id'] : get_current_user_id();
	$request_id         = isset( $extra['request_id'] ) && is_string( $extra['request_id'] ) && '' !== $extra['request_id']
		? (string) $extra['request_id']
		: ( function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'openstation_ai_', true ) );
	$command_tools_raw  = isset( $extra['command_tools'] ) && is_array( $extra['command_tools'] ) ? $extra['command_tools'] : array();
	$system_prompt_text = isset( $extra['system_prompt_text'] ) && is_string( $extra['system_prompt_text'] ) ? $extra['system_prompt_text'] : '';
	$system_prompt_mode = isset( $extra['system_prompt_mode'] ) && in_array( $extra['system_prompt_mode'], array( 'append', 'replace' ), true )
		? (string) $extra['system_prompt_mode']
		: 'append';

	do_action(
		'openstation_ai_search_started',
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	if ( null !== $initial_tool && ! in_array( $initial_tool, openstation_ai_search_resumable_tools(), true ) ) {
		$initial_tool = null;
	}

	$continuation_note = '';
	if ( null !== $initial_tool && ( $start_offset > 0 || 'search_posts' !== $initial_tool ) ) {
		$continuation_note = sprintf(
			"\n\nNote: This is a continuation of a previous search. Begin with %s using the same search keywords at offset=%d and work forward.",
			$initial_tool,
			$start_offset
		);
	}

	$instructions = "
You are a friendly, conversational assistant embedded in a WordPress site. You help the site owner:

1. **Find content** they've written (posts, pages, comments) by describing it in natural language.
2. **Navigate wp-admin** when they ask where to find something (\"where are the categories?\", \"how do I manage users?\").
3. **Recommend plugins** from the official WordPress.org directory when they need extra functionality.
4. **Check the site's error log** when they're troubleshooting something.
5. **Answer anything else your tools can** — you may have more tools than the ones named here (WordPress and other plugins register their own, e.g. site / user / environment / version info). Your actual tool list is authoritative: whenever a tool can answer the request, call it and summarise the result, even if it isn't named here.
6. **Chat** — only when no tool fits, answer conversationally.

Tone: warm, concise, helpful. First person (\"I found this post…\", \"Here's where you'll find that…\"). Not a search engine tone — no \"Match found\" or robot phrasing.

How to work the tools (your actual tool list is authoritative; use any tool that fits the request):
- Content lookups: a search only returns items that contain every word of `query`, so search for one distinctive word at a time (\"autumn\", not \"autumn spiced recipe\"). When the request offers several candidate words, call the tool once per word in the same turn instead of one after another. Stop once a returned title and excerpt clearly match; if nothing matched, try other words or the next offset before telling the user you found nothing.
- Plugin recommendations: present the best 3-5 as admin_links titled like \"Plugin Name · 5M+ installs · 4.8★\".
- Error logs: summarise the most important errors first (fatal, then warnings, then notices) instead of copying entries.

Choosing which track:
- \"I remember a post/page/comment about X\" → the corresponding search_* tool.
- \"where can I find X?\", \"how do I manage Y?\", \"create/add/new …\", \"take me to …\", \"open …\", \"switch/activate …\", or any navigate/do intent → list_admin_pages, then suggest the 1-3 best destinations as admin_links (answer_type \"navigation\"). You suggest the link; the user opens it — never assume it's opened.
- \"plugin for X\" / \"recommend a plugin\" → search_wporg_plugins → present as admin_links.
- \"any errors?\" / \"check logs\" / troubleshooting → get_php_error_log → summarise in chat.
- Any other factual question about the site (its version, PHP/environment, the current user, or anything one of your other tools covers) → call that tool, then summarise its result with answer_type \"chat\".
- Greeting, unclear, or chit-chat → answer_type \"chat\" with a brief helpful message (no tools needed).

Always return one of three answer_type values in the structured output:
- \"entity\": you identified a single post/page/comment. Fill entity_id + entity_type. admin_links = null.
- \"navigation\": you're recommending admin pages OR plugin install links. Fill admin_links. entity_id + entity_type = null.
- \"chat\": you're answering conversationally — including results summarised from any tool (error logs, environment/version info, other plugins' tools), greetings, and \"nothing found\" answers. entity_id + entity_type + admin_links all null.

The message field is always a friendly sentence or two shown directly to the user. Make it sound like a person, not a log line.
";

	if ( $continuation_note ) {
		$instructions .= $continuation_note;
	}

	$prompt_context = array(
		'query'      => $query,
		'user_id'    => $user_id,
		'request_id' => $request_id,
	);

	$instructions = openstation_ai_compose_instructions(
		$instructions,
		$prompt_context,
		array(
			'text' => $system_prompt_text,
			'mode' => $system_prompt_mode,
		)
	);

	$ability_by_tool = array();
	$builtin_tools   = array();

	foreach ( openstation_ai_search_ability_names() as $ability_name ) {
		$ability = function_exists( 'wp_get_ability' ) ? wp_get_ability( $ability_name ) : null;
		if ( ! $ability instanceof WP_Ability ) {
			continue;
		}

		$tool_name                     = openstation_ai_ability_tool_name( $ability_name );
		$ability_by_tool[ $tool_name ] = $ability_name;
		$valid_tools[]                 = $tool_name;

		$input_schema    = $ability->get_input_schema();
		$builtin_tools[] = array(
			'type'        => 'function',
			'name'        => $tool_name,
			'description' => (string) $ability->get_description(),
			'parameters'  => ! empty( $input_schema )
				? $input_schema
				: array(
					'type'       => 'object',
					'properties' => (object) array(),
				),
		);
	}

	$command_tools_by_name = array();
	$command_defs          = array();

	foreach ( $command_tools_raw as $cmd ) {
		if ( ! is_array( $cmd ) ) {
			continue;
		}
		$slug = isset( $cmd['slug'] ) ? (string) $cmd['slug'] : '';
		if ( '' === $slug || ! preg_match( '/^[a-z0-9_\-]+$/', $slug ) ) {
			continue;
		}

		$allowed = apply_filters(
			'openstation_ai_command_allowed',
			$cmd,
			$slug,
			array(
				'user_id'    => $user_id,
				'request_id' => $request_id,
			)
		);
		if ( false === $allowed || ! is_array( $allowed ) ) {
			continue;
		}
		$label       = isset( $allowed['label'] ) ? (string) $allowed['label'] : $slug;
		$description = isset( $allowed['description'] ) ? (string) $allowed['description'] : '';
		$hint        = isset( $allowed['hint'] ) ? (string) $allowed['hint'] : '';
		$tool_name   = 'command_' . $slug;

		$command_tools_by_name[ $tool_name ] = array( 'slug' => $slug );
		$command_defs[]                      = array(
			'type'        => 'function',
			'name'        => $tool_name,
			'description' => trim( $label . ( '' !== $description ? ' — ' . $description : '' ) ),
			'parameters'  => array(
				'type'                 => 'object',
				'properties'           => array(
					'args' => array(
						'type'        => 'string',
						'description' => '' !== $hint
							? sprintf( 'Arguments for this command. Hint: %s', $hint )
							: 'Arguments for this command. Leave empty when the command takes none.',
					),
				),
				'required'             => array( 'args' ),
				'additionalProperties' => false,
			),
		);
	}

	$command_defs = (array) apply_filters(
		'openstation_ai_command_tools',
		$command_defs,
		array(
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	$tools = array_merge( $builtin_tools, $command_defs );

	$tools = (array) apply_filters(
		'openstation_ai_tools',
		$tools,
		array(
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'query'      => $query,
		)
	);

	foreach ( $tools as $ti => $tool ) {
		if ( is_array( $tool ) && isset( $tool['parameters'] ) ) {
			$tools[ $ti ]['parameters'] = openstation_ai_normalize_tool_schema( $tool['parameters'] );
		}
	}

	foreach ( $command_defs as $def ) {
		if ( isset( $def['name'] ) ) {
			$valid_tools[] = (string) $def['name'];
		}
	}

	$answer_schema = openstation_ai_search_answer_schema();

	$messages = array( openstation_ai_user_text_message( $query ) );

	$generation_context = array(
		'source'     => 'ai-copilot/search',
		'request_id' => $request_id,
	);

	$turn = openstation_ai_client_generate( $user_id, $messages, $tools, $answer_schema, $instructions, $generation_context );

	if ( is_wp_error( $turn ) ) {
		return $turn;
	}

	$last_tool     = $initial_tool ?? 'search_posts';
	$last_offset   = $start_offset;
	$last_has_more = true;
	$iterations    = 0;

	$total_usage  = array(
		'prompt'     => 0,
		'completion' => 0,
		'total'      => 0,
	);
	$last_model   = null;
	$accrue_usage = static function ( $turn ) use ( &$total_usage, &$last_model ) {
		if ( ! is_array( $turn ) ) {
			return;
		}
		if ( isset( $turn['usage'] ) && is_array( $turn['usage'] ) ) {
			$total_usage['prompt']     += (int) ( $turn['usage']['prompt'] ?? 0 );
			$total_usage['completion'] += (int) ( $turn['usage']['completion'] ?? 0 );
			$total_usage['total']      += (int) ( $turn['usage']['total'] ?? 0 );
		}
		if ( isset( $turn['model'] ) && is_array( $turn['model'] ) ) {
			$last_model = $turn['model'];
		}
	};
	$accrue_usage( $turn );

	for ( $i = 0; $i < OPENSTATION_AI_SEARCH_MAX_ITERATIONS; $i++ ) {
		$function_calls = is_array( $turn['function_calls'] ?? null ) ? $turn['function_calls'] : array();

		if ( empty( $function_calls ) ) {

			$text = (string) ( $turn['text'] ?? '' );

			$answer = json_decode( $text, true );
			if ( ! is_array( $answer ) ) {
				return new WP_Error( 'openstation_ai_result_parse', __( 'Could not parse structured search answer.', 'desktop-mode' ) );
			}

			$answer_type = isset( $answer['answer_type'] ) && in_array( $answer['answer_type'], array( 'entity', 'navigation', 'chat' ), true )
				? (string) $answer['answer_type']
				: 'chat';
			$message     = isset( $answer['message'] ) ? (string) $answer['message'] : '';
			$entity_id   = ( isset( $answer['entity_id'] ) && is_int( $answer['entity_id'] ) )
				? $answer['entity_id'] : null;
			$entity_type = ( isset( $answer['entity_type'] ) && is_string( $answer['entity_type'] ) )
				? $answer['entity_type'] : null;
			$admin_links = isset( $answer['admin_links'] ) && is_array( $answer['admin_links'] )
				? $answer['admin_links'] : null;

			$entity = null;
			if ( 'entity' === $answer_type && $entity_id && $entity_type ) {
				$entity = openstation_ai_search_build_entity( $entity_type, $entity_id );
			}

			$final = array(
				'answer_type' => $answer_type,
				'message'     => $message,
				'entity'      => $entity,
				'admin_links' => $admin_links,
				'iterations'  => $iterations + 1,
				'exhausted'   => ! $last_has_more,
				'continue'    => null,
				'request_id'  => $request_id,
			);

			$final = (array) apply_filters(
				'openstation_ai_answer',
				$final,
				array(
					'query'      => $query,
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			do_action(
				'openstation_ai_search_completed',
				array(
					'query'       => $query,
					'user_id'     => $user_id,
					'request_id'  => $request_id,
					'answer_type' => $final['answer_type'] ?? 'chat',
					'iterations'  => $final['iterations'] ?? 0,
					'usage'       => $total_usage,
					'model'       => $last_model,
				)
			);

			return $final;
		}

		$command_tool_call = null;
		foreach ( $function_calls as $fc ) {
			$name = (string) ( $fc['name'] ?? '' );
			if ( isset( $command_tools_by_name[ $name ] ) ) {
				$raw               = json_decode( $fc['arguments'] ?? '{}', true );
				$decoded           = is_array( $raw ) ? $raw : array();
				$command_tool_call = array(
					'slug' => $command_tools_by_name[ $name ]['slug'],
					'args' => isset( $decoded['args'] ) ? (string) $decoded['args'] : '',
				);
				break;
			}
		}
		if ( null !== $command_tool_call ) {
			do_action(
				'openstation_ai_tool_called',
				array(
					'tool_name'  => 'command_' . $command_tool_call['slug'],
					'args'       => array( 'args' => $command_tool_call['args'] ),
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			$final = array(
				'answer_type' => 'tool_call',
				'message'     => '',
				'entity'      => null,
				'admin_links' => null,
				'tool'        => $command_tool_call,
				'iterations'  => $iterations + 1,
				'exhausted'   => false,
				'continue'    => null,
				'request_id'  => $request_id,
			);

			$final = (array) apply_filters(
				'openstation_ai_answer',
				$final,
				array(
					'query'      => $query,
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			do_action(
				'openstation_ai_search_completed',
				array(
					'query'       => $query,
					'user_id'     => $user_id,
					'request_id'  => $request_id,
					'answer_type' => 'tool_call',
					'iterations'  => $final['iterations'] ?? 0,
					'usage'       => $total_usage,
					'model'       => $last_model,
				)
			);

			return $final;
		}

		$tool_outputs = array();
		foreach ( $function_calls as $fc ) {
			$tool_name = $fc['name'] ?? '';
			$call_id   = $fc['call_id'] ?? '';

			if ( ! in_array( $tool_name, $valid_tools, true ) ) {
				$tool_outputs[] = array(
					'call_id'  => $call_id,
					'name'     => $tool_name,
					'response' => array( 'error' => "Unknown tool '{$tool_name}'." ),
				);
				continue;
			}

			$raw    = json_decode( $fc['arguments'] ?? '{}', true );
			$args   = is_array( $raw ) ? $raw : array();
			$offset = max( 0, (int) ( $args['offset'] ?? 0 ) );

			do_action(
				'openstation_ai_tool_called',
				array(
					'tool_name'  => $tool_name,
					'args'       => $args,
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			$ability = isset( $ability_by_tool[ $tool_name ] ) ? wp_get_ability( $ability_by_tool[ $tool_name ] ) : null;
			if ( $ability instanceof WP_Ability ) {

				$input  = empty( $ability->get_input_schema() ) ? null : $args;
				$result = $ability->execute( $input );
			} else {
				$result = new WP_Error( 'openstation_ai_unknown_ability', sprintf( 'Ability for tool "%s" is unavailable.', $tool_name ) );
			}

			if ( is_wp_error( $result ) ) {
				do_action(
					'openstation_ai_search_error',
					array(
						'stage'      => 'tool_execute',
						'tool_name'  => $tool_name,
						'error'      => $result->get_error_code(),
						'message'    => $result->get_error_message(),
						'user_id'    => $user_id,
						'request_id' => $request_id,
					)
				);
				$batch = array(
					'error'      => $result->get_error_message(),
					'error_code' => $result->get_error_code(),
				);
			} else {
				$batch = is_array( $result ) ? $result : array( 'result' => $result );
			}

			$last_tool     = $tool_name;
			$last_offset   = $offset;
			$last_has_more = (bool) ( $batch['has_more'] ?? false );

			$batch = (array) apply_filters(
				'openstation_ai_tool_result',
				$batch,
				$tool_name,
				$args,
				array(
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			$tool_outputs[] = array(
				'call_id'  => $call_id,
				'name'     => $tool_name,
				'response' => $batch,
			);
		}

		++$iterations;

		$messages[] = $turn['message'];
		$messages[] = openstation_ai_tool_result_message( $tool_outputs );

		$turn = openstation_ai_client_generate( $user_id, $messages, $tools, $answer_schema, $instructions, $generation_context );

		if ( is_wp_error( $turn ) ) {
			return $turn;
		}
		$accrue_usage( $turn );
	}

	$continue = null;
	if ( $last_has_more ) {
		$next_offset = $last_offset + OPENSTATION_AI_SEARCH_BATCH_SIZE;

		$resume_tool = 'search_comments_by_post' === $last_tool ? 'search_comments' : $last_tool;
		$continue    = array(
			'tool'        => $resume_tool,
			'entity_type' => rtrim( str_replace( 'search_', '', $resume_tool ), 's' ),
			'offset'      => $next_offset,
			'label'       => openstation_ai_continue_label( $resume_tool, $next_offset + 1 ),
		);
	}

	$final = array(
		'answer_type' => 'chat',
		'message'     => __( 'I searched 100 items without finding a clear match. Want me to keep looking further?', 'desktop-mode' ),
		'entity'      => null,
		'admin_links' => null,
		'iterations'  => OPENSTATION_AI_SEARCH_MAX_ITERATIONS,
		'exhausted'   => ! $last_has_more,
		'continue'    => $continue,
		'request_id'  => $request_id,
	);

	$final = (array) apply_filters(
		'openstation_ai_answer',
		$final,
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	do_action(
		'openstation_ai_search_completed',
		array(
			'query'       => $query,
			'user_id'     => $user_id,
			'request_id'  => $request_id,
			'answer_type' => 'chat',
			'iterations'  => OPENSTATION_AI_SEARCH_MAX_ITERATIONS,
			'usage'       => $total_usage,
			'model'       => $last_model,
		)
	);

	return $final;
}

function openstation_ai_compose_instructions( $core, array $context, array $client = array() ) {
	$instructions = (string) $core;
	$user_id      = isset( $context['user_id'] ) ? (int) $context['user_id'] : 0;

	$client_text = isset( $client['text'] ) && is_string( $client['text'] ) ? $client['text'] : '';
	$client_mode = isset( $client['mode'] ) && in_array( $client['mode'], array( 'append', 'replace' ), true )
		? (string) $client['mode']
		: 'append';

	$ctx_for_filter                    = $context;
	$ctx_for_filter['client_override'] = '' !== $client_text ? $client_mode : null;

	$server_appendix = (string) apply_filters( 'openstation_ai_system_prompt_appendix', '', $ctx_for_filter );
	if ( '' !== $server_appendix ) {
		$instructions .= "\n\n" . $server_appendix;
	}

	if ( '' !== $client_text ) {
		if ( 'replace' === $client_mode ) {

			$required_cap = (string) apply_filters(
				'openstation_ai_system_prompt_replace_capability',
				'manage_options',
				$ctx_for_filter
			);
			if ( '' === $required_cap || ( $user_id > 0 && user_can( $user_id, $required_cap ) ) ) {
				$instructions = $client_text;
			} else {

				$instructions .= "\n\n" . $client_text;
			}
		} else {
			$instructions .= "\n\n" . $client_text;
		}
	}

	return (string) apply_filters( 'openstation_ai_system_prompt', $instructions, $ctx_for_filter );
}

function openstation_ai_run_followup( $query, array $tool, array $outcome, array $extra = array() ) {
	$user_id    = isset( $extra['user_id'] ) ? (int) $extra['user_id'] : get_current_user_id();
	$request_id = isset( $extra['request_id'] ) && is_string( $extra['request_id'] ) && '' !== $extra['request_id']
		? (string) $extra['request_id']
		: ( function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'openstation_ai_', true ) );

	do_action(
		'openstation_ai_search_started',
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'phase'      => 'follow_up',
		)
	);

	$instructions = '
You are the same friendly WordPress assistant that just dispatched a command on behalf of the user. You now have the result of that command.

Write a short reply (one or two sentences, first person, warm and conversational) describing what happened. Match the voice the site owner set in their system prompt — do not restart small talk, just confirm what you did.

Rules:
- If the outcome looks successful, confirm plainly. Example: "Done — your office light is on now."
- If the outcome looks like an error (has an `error` field, a failure message, or obviously negative content), apologise briefly and paraphrase what went wrong. Do not invent details the outcome did not include.
- Suggest a next step only when the outcome itself suggests one.
- Describe the real-world effect, not the tool mechanism ("I called command_turn_light").
';

	$system_prompt_text = isset( $extra['system_prompt_text'] ) && is_string( $extra['system_prompt_text'] ) ? $extra['system_prompt_text'] : '';
	$system_prompt_mode = isset( $extra['system_prompt_mode'] ) && in_array( $extra['system_prompt_mode'], array( 'append', 'replace' ), true )
		? (string) $extra['system_prompt_mode']
		: 'append';

	$instructions = openstation_ai_compose_instructions(
		$instructions,
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'phase'      => 'follow_up',
		),
		array(
			'text' => $system_prompt_text,
			'mode' => $system_prompt_mode,
		)
	);

	$slug         = isset( $tool['slug'] ) ? (string) $tool['slug'] : '';
	$tool_args    = isset( $tool['args'] ) ? (string) $tool['args'] : '';
	$outcome_json = wp_json_encode( $outcome );
	if ( ! is_string( $outcome_json ) ) {
		$outcome_json = '""';
	}

	$max_outcome_len = (int) apply_filters( 'openstation_ai_followup_outcome_max_chars', 4000 );
	if ( $max_outcome_len > 0 ) {
		$has_mbstring = function_exists( 'mb_strlen' ) && function_exists( 'mb_substr' );
		$current_len  = $has_mbstring
			? mb_strlen( $outcome_json, 'UTF-8' )
			: strlen( $outcome_json );
		if ( $current_len > $max_outcome_len ) {
			$outcome_json  = $has_mbstring
				? mb_substr( $outcome_json, 0, $max_outcome_len, 'UTF-8' )
				: substr( $outcome_json, 0, $max_outcome_len );
			$outcome_json .= '…[truncated]';
		}
	}

	$user_message = sprintf(
		"Original user request: %s\n\nYou invoked the command `%s` with args `%s`. It returned:\n\n```json\n%s\n```\n\nWrite your short confirmation / apology now.",
		$query,
		$slug,
		$tool_args,
		$outcome_json
	);

	do_action(
		'openstation_ai_tool_called',
		array(
			'tool_name'  => 'followup_summarise',
			'args'       => array(
				'slug'      => $slug,
				'tool_args' => $tool_args,
			),
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	$turn = openstation_ai_client_generate(
		$user_id,
		array( openstation_ai_user_text_message( $user_message ) ),
		array(),
		null,
		$instructions,
		array(
			'source'     => 'ai-copilot/followup',
			'request_id' => $request_id,
		)
	);

	$empty_answer = is_wp_error( $turn ) && 'openstation_ai_empty_answer' === $turn->get_error_code();

	if ( is_wp_error( $turn ) && ! $empty_answer ) {
		do_action(
			'openstation_ai_search_error',
			array(
				'code'       => $turn->get_error_code(),
				'message'    => $turn->get_error_message(),
				'data'       => $turn->get_error_data(),
				'user_id'    => $user_id,
				'request_id' => $request_id,
				'phase'      => 'follow_up',
			)
		);
		return $turn;
	}

	$text     = $empty_answer ? null : ( $turn['text'] ?? null );
	$fallback = false;
	if ( ! is_string( $text ) || '' === trim( $text ) ) {

		$text     = 'Done.';
		$fallback = true;
	}

	$final = array(
		'answer_type' => 'chat',
		'message'     => trim( $text ),
		'entity'      => null,
		'admin_links' => null,
		'iterations'  => 1,
		'exhausted'   => false,
		'continue'    => null,
		'request_id'  => $request_id,
		'tool'        => array(
			'slug' => $slug,
			'args' => $tool_args,
		),
		'fallback'    => $fallback,
	);

	$final = (array) apply_filters(
		'openstation_ai_answer',
		$final,
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'phase'      => 'follow_up',
		)
	);

	do_action(
		'openstation_ai_search_completed',
		array(
			'query'       => $query,
			'user_id'     => $user_id,
			'request_id'  => $request_id,
			'answer_type' => 'chat',
			'iterations'  => 1,
			'phase'       => 'follow_up',
			'fallback'    => $fallback,
		)
	);

	return $final;
}

function openstation_register_ai_search_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/ai/search',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_ai_search',
			'permission_callback' => 'openstation_rest_ai_search_permission',
			'args'                => array(
				'query'              => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
					'validate_callback' => static function ( $v ) {
						return is_string( $v ) && trim( $v ) !== '';
					},
				),

				'resume_tool'        => array(
					'required'          => false,
					'type'              => array( 'string', 'null' ),
					'default'           => null,
					'sanitize_callback' => static function ( $v ) {
						return in_array( $v, openstation_ai_search_resumable_tools(), true )
							? $v : null;
					},
				),
				'start_offset'       => array(
					'required'          => false,
					'type'              => 'integer',
					'default'           => 0,
					'sanitize_callback' => 'absint',
				),

				'command_tools'      => array(
					'required' => false,
					'type'     => 'array',
					'default'  => array(),
					'items'    => array(
						'type'       => 'object',
						'properties' => array(
							'slug'        => array( 'type' => 'string' ),
							'label'       => array( 'type' => 'string' ),
							'description' => array( 'type' => 'string' ),
							'hint'        => array( 'type' => 'string' ),
						),
					),
				),

				'system_prompt_text' => array(
					'required' => false,
					'type'     => 'string',
					'default'  => '',
				),
				'system_prompt_mode' => array(
					'required'          => false,
					'type'              => 'string',
					'default'           => 'append',
					'sanitize_callback' => static function ( $v ) {
						return in_array( $v, array( 'append', 'replace' ), true ) ? $v : 'append';
					},
				),

				'follow_up'          => array(
					'required' => false,
					'type'     => array( 'object', 'null' ),
					'default'  => null,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_ai_search_rest_route' );

function openstation_rest_ai_search_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'read' ) ) {
		return new WP_Error(
			'openstation_ai_forbidden',
			__( 'You must be logged in to use the AI assistant.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	if ( ! openstation_ai_is_available() ) {
		return new WP_Error(
			'openstation_ai_unavailable',
			__( 'The AI assistant is unavailable on this site.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}
	if ( ! openstation_ai_is_enabled( get_current_user_id() ) ) {

		return new WP_Error(
			'openstation_ai_disabled',
			__(
				'The AI assistant is turned off. Enable it in OpenStation Preferences → Features.',
				'desktop-mode'
			),
			array(
				'status'       => 403,
				'settings_tab' => 'features',
			)
		);
	}
	return true;
}

function openstation_rest_ai_search( WP_REST_Request $request ) {

	@set_time_limit( 120 );

	$user_id      = get_current_user_id();
	$query        = $request->get_param( 'query' );
	$resume_tool  = $request->get_param( 'resume_tool' );
	$start_offset = $request->get_param( 'start_offset' );

	$command_tools = $request->get_param( 'command_tools' );
	if ( ! is_array( $command_tools ) ) {
		$command_tools = array();
	}

	$extra = array(
		'user_id'            => $user_id,
		'request_id'         => function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'openstation_ai_', true ),
		'command_tools'      => $command_tools,
		'system_prompt_text' => (string) $request->get_param( 'system_prompt_text' ),
		'system_prompt_mode' => (string) $request->get_param( 'system_prompt_mode' ),
	);

	$extra = (array) apply_filters(
		'openstation_ai_request',
		$extra,
		array(
			'query'        => $query,
			'resume_tool'  => $resume_tool,
			'start_offset' => $start_offset,
		)
	);

	$follow_up = $request->get_param( 'follow_up' );
	if ( is_array( $follow_up ) && isset( $follow_up['tool'] ) && is_array( $follow_up['tool'] ) ) {
		$tool    = $follow_up['tool'];
		$outcome = isset( $follow_up['result'] )
			? ( is_array( $follow_up['result'] ) ? $follow_up['result'] : array( 'value' => $follow_up['result'] ) )
			: array();
		$result  = openstation_ai_run_followup( $query, $tool, $outcome, $extra );
	} else {
		$result = openstation_ai_run_search( $query, $resume_tool, $start_offset, $extra );
	}

	if ( is_wp_error( $result ) ) {
		$request_id = isset( $extra['request_id'] ) ? (string) $extra['request_id'] : '';
		do_action(
			'openstation_ai_search_error',
			array(
				'code'       => $result->get_error_code(),
				'message'    => $result->get_error_message(),
				'data'       => $result->get_error_data(),
				'user_id'    => $user_id,
				'request_id' => $request_id,
			)
		);
		return $result;
	}

	return rest_ensure_response( $result );
}

function openstation_ai_fetch_wporg_plugins( $query ) {
	$query = trim( (string) $query );
	if ( '' === $query ) {
		return array(
			'tool'    => 'search_wporg_plugins',
			'query'   => '',
			'results' => array(),
			'count'   => 0,
			'error'   => 'No search query provided.',
		);
	}

	$cache_key = 'openstation_ai_plugins_' . md5( strtolower( $query ) );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	if ( ! function_exists( 'plugins_api' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
	}

	$api = plugins_api(
		'query_plugins',
		array(
			'search'   => $query,
			'per_page' => 10,
			'fields'   => array(
				'short_description' => true,
				'description'       => false,
				'sections'          => false,
				'requires'          => true,
				'tested'            => true,
				'rating'            => true,
				'ratings'           => false,
				'downloaded'        => false,
				'downloadlink'      => false,
				'last_updated'      => true,
				'added'             => false,
				'tags'              => false,
				'compatibility'     => false,
				'homepage'          => true,
				'versions'          => false,
				'donate_link'       => false,
				'reviews'           => false,
				'banners'           => false,
				'icons'             => true,
				'active_installs'   => true,
				'group'             => false,
				'contributors'      => false,
			),
		)
	);

	if ( is_wp_error( $api ) ) {
		return array(
			'tool'    => 'search_wporg_plugins',
			'query'   => $query,
			'results' => array(),
			'count'   => 0,
			'error'   => $api->get_error_message(),
		);
	}

	$results = array();
	$plugins = isset( $api->plugins ) && is_array( $api->plugins ) ? $api->plugins : array();
	foreach ( $plugins as $p ) {

		$p = (array) $p;

		$slug = isset( $p['slug'] ) ? (string) $p['slug'] : '';
		if ( '' === $slug ) {
			continue;
		}

		$icon  = '';
		$icons = isset( $p['icons'] ) && is_array( $p['icons'] ) ? $p['icons'] : array();
		if ( isset( $icons['1x'] ) ) {
			$icon = (string) $icons['1x'];
		} elseif ( isset( $icons['default'] ) ) {
			$icon = (string) $icons['default'];
		} elseif ( isset( $icons['svg'] ) ) {
			$icon = (string) $icons['svg'];
		}

		$install_admin_url = admin_url(
			'plugin-install.php?tab=plugin-information&plugin=' . rawurlencode( $slug )
			. '&TB_iframe=true&width=772&height=745'
		);

		$results[] = array(
			'name'              => wp_strip_all_tags( $p['name'] ?? '' ),
			'slug'              => $slug,
			'short_description' => wp_strip_all_tags( $p['short_description'] ?? '' ),
			'version'           => (string) ( $p['version'] ?? '' ),
			'author'            => wp_strip_all_tags( $p['author'] ?? '' ),
			'rating'            => (int) ( $p['rating'] ?? 0 ),
			'stars'             => round( ( (int) ( $p['rating'] ?? 0 ) ) / 20, 1 ),
			'num_ratings'       => (int) ( $p['num_ratings'] ?? 0 ),
			'active_installs'   => (int) ( $p['active_installs'] ?? 0 ),
			'last_updated'      => (string) ( $p['last_updated'] ?? '' ),
			'requires'          => (string) ( $p['requires'] ?? '' ),
			'tested'            => (string) ( $p['tested'] ?? '' ),
			'homepage'          => esc_url_raw( $p['homepage'] ?? '' ),
			'wporg_url'         => 'https://wordpress.org/plugins/' . $slug . '/',
			'install_admin_url' => $install_admin_url,
			'icon'              => esc_url_raw( $icon ),
		);
	}

	$payload = array(
		'tool'    => 'search_wporg_plugins',
		'query'   => $query,
		'results' => $results,
		'count'   => count( $results ),
	);

	set_transient( $cache_key, $payload, 10 * MINUTE_IN_SECONDS );

	return $payload;
}

function openstation_ai_fetch_error_log( $lines = 50 ) {
	$candidates = array();
	if ( defined( 'WP_CONTENT_DIR' ) ) {
		$candidates[] = WP_CONTENT_DIR . '/debug.log';
	}
	$ini_log = (string) ini_get( 'error_log' );
	if ( '' !== $ini_log && 'syslog' !== $ini_log ) {
		$candidates[] = $ini_log;
	}

	$candidates = (array) apply_filters( 'openstation_ai_error_log_candidates', $candidates );

	$log_path = '';
	foreach ( $candidates as $path ) {
		if ( is_string( $path ) && is_file( $path ) && is_readable( $path ) ) {
			$log_path = $path;
			break;
		}
	}

	if ( '' === $log_path ) {
		return array(
			'tool'          => 'get_php_error_log',
			'log_available' => false,
			'message'       => 'No readable error log found. Enable WP_DEBUG_LOG in wp-config.php or set php_value error_log.',
			'checked_paths' => array_values( $candidates ),
			'entries'       => array(),
			'count'         => 0,
		);
	}

	$tail = openstation_ai_tail_file( $log_path, $lines );

	$entries = array();
	foreach ( $tail as $line ) {
		$line = trim( $line );
		if ( '' === $line ) {
			continue;
		}
		$entries[] = openstation_ai_parse_log_line( $line );
	}

	return array(
		'tool'          => 'get_php_error_log',
		'log_available' => true,
		'source'        => $log_path,
		'entries'       => $entries,
		'count'         => count( $entries ),
	);
}

function openstation_ai_parse_log_line( $line ) {

	$line = mb_substr( $line, 0, 600 );

	$entry = array(
		'timestamp' => '',
		'level'     => 'Log',
		'message'   => $line,
	);

	if ( preg_match( '/^\[([^\]]+)\]\s*(.*)$/', $line, $m ) ) {
		$entry['timestamp'] = $m[1];
		$entry['message']   = $m[2];
	}

	if ( preg_match( '/^(PHP (?:Fatal error|Parse error|Warning|Notice|Deprecated|Strict|Recoverable fatal error))/i', $entry['message'], $lm ) ) {
		$entry['level']   = $lm[1];
		$entry['message'] = trim( substr( $entry['message'], strlen( $lm[1] ) ), ":\t " );
	}

	return $entry;
}

function openstation_ai_tail_file( $path, $lines ) {
	if ( ! function_exists( 'WP_Filesystem' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	WP_Filesystem();
	global $wp_filesystem;
	if ( ! $wp_filesystem || ! $wp_filesystem->exists( $path ) ) {
		return array();
	}

	$contents = $wp_filesystem->get_contents( $path );
	if ( false === $contents || '' === $contents ) {
		return array();
	}

	$all = preg_split( '/\r?\n/', $contents );
	if ( ! is_array( $all ) ) {
		return array();
	}

	return array_slice( $all, -1 * ( $lines + 1 ) );
}
