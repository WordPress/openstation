<?php
/**
 * OpenStation — AI Copilot content search via the provider tool use.
 *
 * Agentic search loop: the user describes something in natural language and
 * the agent calls focused tools, choosing the right one based on query
 * semantics. Built-in tools: four content-search tools — search_posts,
 * search_pages, search_comments, search_comments_by_post — plus
 * list_admin_pages (admin navigation catalog), search_wporg_plugins
 * (WordPress.org plugin directory), and get_php_error_log (error-log
 * tail). Each content-search tool runs WordPress's native search
 * (WP_Query `s=` / get_comments `search=`) for the keywords the model
 * distils from the request, then returns up to 10 matching entities with
 * their real title + content excerpt for the model to compare to the
 * user's description. No AI pre-analysis is required — every published
 * post/page/comment is findable. The built-in tools are WordPress Abilities
 * (see abilities.php); client command tools are advertised alongside them and
 * dispatched by the same loop.
 *
 * Focused tools instead of one routing parameter:
 *   - "I remember a comment where someone said congratulations…" → agent
 *     calls search_comments without needing a routing parameter.
 *   - "I wrote a post about paella in Canarias" → agent calls search_posts.
 *   - "Our About page mentions…" → agent calls search_pages.
 *   - Ambiguous queries → agent tries in priority order (posts → pages →
 *     comments) following the system-prompt guidance.
 *
 * Budget: max OPENSTATION_AI_SEARCH_MAX_ITERATIONS (10) tool-call rounds per
 * request × OPENSTATION_AI_SEARCH_BATCH_SIZE (10) items = up to 100 entities.
 * When the budget is exhausted the response includes a `continue` object
 * the client uses to resume from the exact offset that was last searched.
 *
 * REST endpoint: POST /desktop-mode/v1/ai/search
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Maximum agentic tool-call iterations per search request. */
const OPENSTATION_AI_SEARCH_MAX_ITERATIONS = 10;

/** Entities fetched per tool-call round. */
const OPENSTATION_AI_SEARCH_BATCH_SIZE = 10;

/**
 * Returns the catalog of common WordPress admin destinations.
 *
 * Used by the `list_admin_pages` tool. Each entry has a human title, the
 * wp-admin URL (rendered through admin_url() so it respects the site's
 * real admin path), a short description, and a Dashicons icon class the
 * UI can use when opening the URL in a legacy iframe window.
 *
 * Filterable via `openstation_ai_admin_page_catalog` so third-party
 * plugins can contribute their own admin destinations (e.g. a plugin
 * adding a top-level menu can surface its settings page here).
 *
 * @return array[]
 */
function openstation_ai_get_admin_page_catalog() {
	$catalog = array(
		array(
			'title'       => 'Dashboard',
			'url'         => admin_url( 'index.php' ),
			'icon'        => 'dashicons-dashboard',
			'description' => 'The main admin dashboard — activity, drafts, site overview.',
		),
		array(
			'title'       => 'All Posts',
			'url'         => admin_url( 'edit.php' ),
			'icon'        => 'dashicons-admin-post',
			'description' => 'List, edit, bulk-manage blog posts.',
		),
		array(
			'title'       => 'Add New Post',
			'url'         => admin_url( 'post-new.php' ),
			'icon'        => 'dashicons-plus',
			'description' => 'Create a new blog post.',
		),
		array(
			'title'       => 'Categories',
			'url'         => admin_url( 'edit-tags.php?taxonomy=category' ),
			'icon'        => 'dashicons-category',
			'description' => 'Manage post categories — add, rename, merge.',
		),
		array(
			'title'       => 'Tags',
			'url'         => admin_url( 'edit-tags.php?taxonomy=post_tag' ),
			'icon'        => 'dashicons-tag',
			'description' => 'Manage post tags.',
		),
		array(
			'title'       => 'All Pages',
			'url'         => admin_url( 'edit.php?post_type=page' ),
			'icon'        => 'dashicons-admin-page',
			'description' => 'List and edit static pages (About, Contact, etc.).',
		),
		array(
			'title'       => 'Add New Page',
			'url'         => admin_url( 'post-new.php?post_type=page' ),
			'icon'        => 'dashicons-plus',
			'description' => 'Create a new page.',
		),
		array(
			'title'       => 'Media Library',
			'url'         => admin_url( 'upload.php' ),
			'icon'        => 'dashicons-admin-media',
			'description' => 'Browse, upload, and manage images, files, videos.',
		),
		array(
			'title'       => 'Comments',
			'url'         => admin_url( 'edit-comments.php' ),
			'icon'        => 'dashicons-admin-comments',
			'description' => 'Moderate and reply to comments on posts and pages.',
		),
		array(
			'title'       => 'Themes',
			'url'         => admin_url( 'themes.php' ),
			'icon'        => 'dashicons-admin-appearance',
			'description' => 'Change, install, or customize the active theme.',
		),
		array(
			'title'       => 'Customize',
			'url'         => admin_url( 'customize.php' ),
			'icon'        => 'dashicons-admin-customizer',
			'description' => 'Live-preview theme customisation — colors, fonts, layout.',
		),
		array(
			'title'       => 'Widgets',
			'url'         => admin_url( 'widgets.php' ),
			'icon'        => 'dashicons-screenoptions',
			'description' => 'Manage sidebar and footer widgets.',
		),
		array(
			'title'       => 'Menus',
			'url'         => admin_url( 'nav-menus.php' ),
			'icon'        => 'dashicons-menu',
			'description' => 'Create and edit navigation menus.',
		),
		array(
			'title'       => 'Plugins',
			'url'         => admin_url( 'plugins.php' ),
			'icon'        => 'dashicons-admin-plugins',
			'description' => 'Activate, deactivate, update or delete plugins.',
		),
		array(
			'title'       => 'Add New Plugin',
			'url'         => admin_url( 'plugin-install.php' ),
			'icon'        => 'dashicons-plus',
			'description' => 'Search and install new plugins from the directory.',
		),
		array(
			'title'       => 'Users',
			'url'         => admin_url( 'users.php' ),
			'icon'        => 'dashicons-admin-users',
			'description' => 'Manage user accounts and roles.',
		),
		array(
			'title'       => 'Add New User',
			'url'         => admin_url( 'user-new.php' ),
			'icon'        => 'dashicons-plus',
			'description' => 'Create a new user account.',
		),
		array(
			'title'       => 'Your Profile',
			'url'         => admin_url( 'profile.php' ),
			'icon'        => 'dashicons-id',
			'description' => 'Edit your own profile, password, admin colour scheme.',
		),
		array(
			'title'       => 'General Settings',
			'url'         => admin_url( 'options-general.php' ),
			'icon'        => 'dashicons-admin-settings',
			'description' => 'Site title, tagline, URL, timezone, language.',
		),
		array(
			'title'       => 'Writing Settings',
			'url'         => admin_url( 'options-writing.php' ),
			'icon'        => 'dashicons-edit',
			'description' => 'Default post category, post format, remote publishing.',
		),
		array(
			'title'       => 'Reading Settings',
			'url'         => admin_url( 'options-reading.php' ),
			'icon'        => 'dashicons-book',
			'description' => 'Homepage, blog posts per page, search-engine visibility.',
		),
		array(
			'title'       => 'Discussion Settings',
			'url'         => admin_url( 'options-discussion.php' ),
			'icon'        => 'dashicons-format-chat',
			'description' => 'Comment moderation, avatars, email notifications.',
		),
		array(
			'title'       => 'Media Settings',
			'url'         => admin_url( 'options-media.php' ),
			'icon'        => 'dashicons-format-image',
			'description' => 'Image size settings for thumbnail / medium / large.',
		),
		array(
			'title'       => 'Permalinks',
			'url'         => admin_url( 'options-permalink.php' ),
			'icon'        => 'dashicons-admin-links',
			'description' => 'URL structure for posts, pages, categories, tags.',
		),
		array(
			'title'       => 'Privacy',
			'url'         => admin_url( 'options-privacy.php' ),
			'icon'        => 'dashicons-privacy',
			'description' => 'Privacy policy page selection and preview.',
		),
		array(
			'title'       => 'Tools',
			'url'         => admin_url( 'tools.php' ),
			'icon'        => 'dashicons-admin-tools',
			'description' => 'Built-in site tools.',
		),
		array(
			'title'       => 'Import',
			'url'         => admin_url( 'import.php' ),
			'icon'        => 'dashicons-download',
			'description' => 'Import content from other platforms (WP, Tumblr, RSS, etc.).',
		),
		array(
			'title'       => 'Export',
			'url'         => admin_url( 'export.php' ),
			'icon'        => 'dashicons-upload',
			'description' => 'Export all site content as XML.',
		),
		array(
			'title'       => 'Site Health',
			'url'         => admin_url( 'site-health.php' ),
			'icon'        => 'dashicons-heart',
			'description' => 'Performance and security recommendations for the site.',
		),
		array(
			'title'       => 'Updates',
			'url'         => admin_url( 'update-core.php' ),
			'icon'        => 'dashicons-update',
			'description' => 'WordPress, theme, and plugin updates.',
		),
	);

	/**
	 * Filters the wp-admin page catalog surfaced by the AI assistant.
	 *
	 * @param array[] $catalog Array of entries, each with title/url/icon/description.
	 */
	return (array) apply_filters( 'openstation_ai_admin_page_catalog', $catalog );
}

// ---------------------------------------------------------------------------
// Final-answer JSON Schema
// ---------------------------------------------------------------------------

/**
 * JSON Schema for the agent's final structured answer.
 *
 * @return array
 */
function openstation_ai_search_answer_schema() {
	return array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'answer_type', 'message', 'entity_id', 'entity_type', 'admin_links' ),
		'properties'           => array(
			'answer_type' => array(
				'type'        => 'string',
				'enum'        => array( 'entity', 'navigation', 'chat' ),
				'description' => 'Classification of the answer: "entity" when you identified a specific post/page/comment the user was asking about. "navigation" when the user asked where to find something in wp-admin and you are returning admin_links. "chat" for conversational responses that don\'t involve finding content or navigation (e.g. greetings, clarifications, "I couldn\'t find anything").',
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

// ---------------------------------------------------------------------------
// DB queries — tool execution
// ---------------------------------------------------------------------------

/**
 * Routes a tool call to the correct DB query by function name.
 *
 * The content-search tools (`search_posts`, `search_pages`,
 * `search_comments`, `search_comments_by_post`) take a keyword `query`
 * matched with WordPress's native search; `search_comments_by_post`
 * needs an additional `post_id`. The caller passes the full decoded
 * arguments array so this function can extract whatever it needs.
 *
 * @param string $tool_name Tool function name.
 * @param array  $args      Decoded arguments from the model's tool call.
 * @return array Tool result payload.
 */
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

/**
 * Keyword-searches published posts or pages with WordPress's native search
 * (`WP_Query` `s=`), returning data rich enough for the agent to compare
 * AND for the UI to render links.
 *
 * No AI analysis is required — every published post/page is searchable.
 *
 * @param string $post_type 'post' | 'page'.
 * @param string $query     Keyword search terms (may be empty to list newest).
 * @param int    $offset
 * @return array
 */
function openstation_ai_search_fetch_posts( $post_type, $query, $offset ) {
	$wp_query = new WP_Query(
		array(
			'post_type'              => $post_type,
			'post_status'            => 'publish',
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
			// Identity — used to build the final entity detail.
			'id'       => $post->ID,
			'type'     => $post->post_type,
			// Comparison data for the model — real title + content excerpt.
			'title'    => wp_strip_all_tags( $post->post_title ),
			'excerpt'  => openstation_ai_search_excerpt( $post->post_content ),
			'date'     => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',
			// Links — passed through so the UI can link to the entity
			// once the agent identifies a match.
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

/**
 * Trims raw post/comment content into a plain-text excerpt for the model.
 *
 * @param string $content Raw post/comment content.
 * @return string
 */
function openstation_ai_search_excerpt( $content ) {
	$text = wp_strip_all_tags( (string) $content );
	$text = preg_replace( '/\s+/', ' ', trim( $text ) );
	return (string) mb_substr( $text, 0, 300 );
}

/**
 * Keyword-searches approved comments across all posts with WordPress's
 * native comment search (`get_comments` `search=`).
 *
 * No AI analysis is required — every approved comment is searchable.
 *
 * @param string $query Keyword search terms (may be empty to list newest).
 * @param int    $offset
 * @return array
 */
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

	// Prime the parent posts in a single query so the per-comment
	// get_post() calls below are cache hits, not N+1 round-trips.
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

	$items = array();
	foreach ( $comments as $comment ) {
		$parent_post  = get_post( $comment->comment_post_ID );
		$parent_title = $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '';

		$items[] = array(
			'id'         => (int) $comment->comment_ID,
			'type'       => 'comment',
			// Comparison data — real comment text + parent post title.
			'post_title' => $parent_title,
			'excerpt'    => openstation_ai_search_excerpt( $comment->comment_content ),
			// Links.
			'url'        => (string) get_comment_link( $comment ),
			'edit_url'   => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
			'post_id'    => (int) $comment->comment_post_ID,
			'post_url'   => $parent_post ? (string) get_permalink( $parent_post ) : '',
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

// ---------------------------------------------------------------------------
// Entity detail builder — final REST response
// ---------------------------------------------------------------------------

/**
 * Keyword-searches approved comments on a specific post.
 *
 * Used by the `search_comments_by_post` tool — the model calls this after
 * identifying a post via `search_posts`, giving it a scoped, precise set of
 * comments to compare against the user's description. An empty `$query`
 * lists the post's comments without keyword filtering.
 *
 * @param int    $post_id The WordPress post ID.
 * @param string $query   Keyword search terms (may be empty).
 * @param int    $offset
 * @return array Tool result payload.
 */
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
	$parent_title = $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '';

	$items = array();
	foreach ( $comments as $comment ) {
		$items[] = array(
			'id'         => (int) $comment->comment_ID,
			'type'       => 'comment',
			'post_id'    => $post_id,
			'post_title' => $parent_title,
			'excerpt'    => openstation_ai_search_excerpt( $comment->comment_content ),
			'url'        => (string) get_comment_link( $comment ),
			'edit_url'   => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
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

// ---------------------------------------------------------------------------
// Entity detail builder — final REST response
// ---------------------------------------------------------------------------

/**
 * Returns the full entity record used in the `entity` field of the REST
 * response. All URLs are included so the UI can render direct links.
 *
 * Built entirely from core post/comment fields — no AI analysis meta is
 * required. Comments opportunistically surface the `spam` / `harmful`
 * verdict when the comment-moderation analysis happens to have run, but
 * its absence never blocks the entity from being returned.
 *
 * @param string $entity_type 'post' | 'page' | 'comment'.
 * @param int    $entity_id
 * @return array|null
 */
function openstation_ai_search_build_entity( $entity_type, $entity_id ) {
	$entity_id = (int) $entity_id;

	if ( in_array( $entity_type, array( 'post', 'page' ), true ) ) {
		$post = get_post( $entity_id );
		if ( ! $post instanceof WP_Post ) {
			return null;
		}
		return array(
			'id'       => $entity_id,
			'type'     => $post->post_type,
			'title'    => wp_strip_all_tags( $post->post_title ),
			'status'   => $post->post_status,
			'date'     => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',
			'url'      => (string) get_permalink( $post ),
			'edit_url' => (string) get_edit_post_link( $entity_id, 'raw' ),
			'excerpt'  => openstation_ai_search_excerpt( $post->post_content ),
		);
	}

	if ( 'comment' === $entity_type ) {
		$comment = get_comment( $entity_id );
		if ( ! $comment instanceof WP_Comment ) {
			return null;
		}
		$meta        = openstation_ai_get_meta( 'comment', $entity_id );
		$parent_post = get_post( $comment->comment_post_ID );
		return array(
			'id'         => $entity_id,
			'type'       => 'comment',
			'excerpt'    => openstation_ai_search_excerpt( $comment->comment_content ),
			'post_id'    => (int) $comment->comment_post_ID,
			'post_title' => $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '',
			'post_url'   => $parent_post ? (string) get_permalink( $parent_post ) : '',
			'url'        => (string) get_comment_link( $comment ),
			'edit_url'   => admin_url( 'comment.php?action=editcomment&c=' . $entity_id ),
			'harmful'    => $meta ? (bool) ( $meta['harmful'] ?? false ) : false,
			'spam'       => $meta ? (bool) ( $meta['spam'] ?? false ) : false,
		);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Agentic search loop
// ---------------------------------------------------------------------------

/**
 * Returns a friendly progress message for a tool name — surfaced to the
 * client via SSE so the user sees "Looking through your posts…" rather
 * than the raw tool call.
 *
 * @param string $tool_name
 * @return string
 */
function openstation_ai_progress_message( $tool_name ) {
	switch ( $tool_name ) {
		case 'search_posts':
			return 'Looking through your posts…';
		case 'search_pages':
			return 'Checking your pages…';
		case 'search_comments':
			return 'Reading through comments…';
		case 'search_comments_by_post':
			return 'Scanning comments on that post…';
		case 'list_admin_pages':
			return 'Finding the right admin page…';
		case 'search_wporg_plugins':
			return 'Searching the WordPress.org plugin directory…';
		case 'get_php_error_log':
			return 'Tailing the PHP error log…';
	}
	return 'Thinking…';
}

/**
 * Returns the tools a client may resume an exhausted search from.
 *
 * Single source of truth for every `resume_tool` allowlist — the REST
 * arg sanitizer, the SSE handler, and the `$initial_tool` validation
 * inside `openstation_ai_run_search()`. `search_comments_by_post` is
 * deliberately absent: the `continue` payload carries no `post_id`, so
 * it cannot truly resume — exhausted runs map it to `search_comments`
 * when building the `continue` object.
 *
 * @return string[] Tool names.
 */
function openstation_ai_search_resumable_tools() {
	return array( 'search_posts', 'search_pages', 'search_comments' );
}

/**
 * Projects a tool's `parameters` schema onto the provider-supported subset.
 *
 * The Abilities API (and plugin-supplied tools) may use the full breadth of JSON
 * Schema, but the provider's tool-schema validator does not — and it rejects the
 * whole request, not just the offending tool, so ONE tool with a
 * legal-but-unsupported schema makes the entire assistant return a 400 before the
 * model runs. Three shapes that are valid JSON Schema, but rejected here, have
 * been seen in the wild (see the linked issue):
 *
 *   1. `type` as an array, e.g. ['object','null'] — an ability's GET/null
 *      run-path. The provider wants the literal string "object" at the top level.
 *   2. A top-level `oneOf` / `anyOf` / `allOf`, e.g. "post_id OR slug". Rejected
 *      with "does not support oneOf, allOf, or anyOf at the top level".
 *   3. `properties` as an empty PHP array, which encodes to JSON as `[]` where an
 *      object schema needs `{}`.
 *
 * This reshapes only the copy advertised to the model. The ability itself is
 * untouched: `WP_Ability::execute()` still validates arguments against the real
 * schema and `permission_callback` still gates execution, so nothing loses
 * enforcement — the model is simply told the constraint in prose (the tool
 * description) instead of in a schema construct the provider can't parse. Only
 * the TOP level is constrained; a combinator nested inside a property is a real
 * constraint the provider accepts, so it is left intact.
 *
 * @param mixed $schema A tool parameters schema (array), or empty/non-array.
 * @return array A provider-safe object schema for a tool `parameters` block.
 */
function openstation_ai_normalize_tool_schema( $schema ) {
	if ( ! is_array( $schema ) || empty( $schema ) ) {
		return array(
			'type'       => 'object',
			'properties' => (object) array(),
		);
	}

	// Recursively drop the WordPress-only arg-schema keys
	// (`sanitize_callback` / `validate_callback` / `arg_options`) —
	// see the helper's docblock for why this must run at every depth.
	$schema = openstation_ai_strip_wp_schema_keys( $schema );

	// Top-level tool parameters must be the literal "object", never a union.
	$schema['type'] = 'object';

	// Strip top-level combinators — the provider rejects them outright, and one
	// such tool 400s the whole request. Nested combinators are left alone.
	unset( $schema['oneOf'], $schema['allOf'], $schema['anyOf'] );

	// An empty PHP array encodes as `[]`; an object schema's properties need `{}`.
	// A schema with no `properties` at all (e.g. one whose only content was a
	// stripped top-level combinator) gets an empty object for the same reason.
	if ( ! isset( $schema['properties'] ) || array() === $schema['properties'] ) {
		$schema['properties'] = (object) array();
	}

	return $schema;
}

/**
 * Recursively removes the WordPress-only arg-schema keys from a tool schema.
 *
 * WordPress arg schemas legally extend JSON Schema with PHP-callable keys —
 * `sanitize_callback`, `validate_callback`, and (on meta args) `arg_options`.
 * Abilities registered from REST arg definitions carry them at every property
 * level, and providers that validate tool schemas strictly reject any unknown
 * field ("Invalid JSON payload received. Unknown name \"sanitize_callback\""),
 * 400-ing the whole request over one property.
 *
 * The walk is structure-aware, not a blind key sweep: maps under `properties` /
 * `patternProperties` are keyed by PROPERTY NAME, so a property that happens to
 * be called `sanitize_callback` is preserved — only its schema value is
 * cleaned. Recursion covers every position a subschema can occupy: property
 * values, `items` (single schema or tuple list), array-shaped
 * `additionalProperties`, and nested `oneOf` / `allOf` / `anyOf` branches
 * (which are kept — only the TOP level of the tool schema strips combinators).
 *
 * @param array $schema A tool parameters (sub)schema.
 * @return array The schema without WP-only keys, at any depth.
 */
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
			// Tuple form — a list of schemas.
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

/**
 * Runs the agentic content-search loop.
 *
 * The model receives focused tools — search_posts, search_pages,
 * search_comments, search_comments_by_post — and a system prompt that
 * guides it to choose the right one based on query semantics and pass the
 * distilled keywords as `query`. "Someone said congratulations" → it calls
 * search_comments. "I wrote about paella" → it calls search_posts. No
 * entity_type routing from the caller is needed for a fresh search.
 *
 * For continuation runs ($initial_tool + $start_offset > 0), the system
 * message primes the agent to resume from the last searched position with
 * the same keywords.
 *
 * @param string        $query        User's natural-language search.
 * @param string|null   $initial_tool Tool name to resume from, or null for fresh search.
 * @param int           $start_offset Offset to resume from (0 for fresh).
 * @param callable|null $on_progress Optional progress emitter for SSE ticks.
 * @param array         $extra        Extensibility context (command tools, prompt overrides, …).
 * @return array|WP_Error
 */
function openstation_ai_run_search( $query, $initial_tool = null, $start_offset = 0, $on_progress = null, array $extra = array() ) {
	/**
	 * Progress emitter — sends a tick to the caller if they provided a
	 * callable; no-op otherwise. Callers use this to render real-time
	 * status to the user via SSE.
	 */
	$emit         = static function ( array $event ) use ( $on_progress ) {
		if ( is_callable( $on_progress ) ) {
			$on_progress( $event );
		}
	};
	$start_offset = max( 0, (int) $start_offset );
	$search_tools = array( 'search_posts', 'search_pages', 'search_comments', 'search_comments_by_post' );
	$valid_tools  = array_merge(
		$search_tools,
		array( 'list_admin_pages', 'search_wporg_plugins', 'get_php_error_log' )
	);

	// -----------------------------------------------------------------------
	// Extensibility context — command tools from the client, PHP-registered
	// tools from the server-side registry, system-prompt overrides, and a
	// per-call request_id for observability fanout.
	// -----------------------------------------------------------------------
	$user_id            = isset( $extra['user_id'] ) ? (int) $extra['user_id'] : get_current_user_id();
	$request_id         = isset( $extra['request_id'] ) && is_string( $extra['request_id'] ) && '' !== $extra['request_id']
		? (string) $extra['request_id']
		: ( function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'openstation_ai_', true ) );
	$command_tools_raw  = isset( $extra['command_tools'] ) && is_array( $extra['command_tools'] ) ? $extra['command_tools'] : array();
	$system_prompt_text = isset( $extra['system_prompt_text'] ) && is_string( $extra['system_prompt_text'] ) ? $extra['system_prompt_text'] : '';
	$system_prompt_mode = isset( $extra['system_prompt_mode'] ) && in_array( $extra['system_prompt_mode'], array( 'append', 'replace' ), true )
		? (string) $extra['system_prompt_mode']
		: 'append';

	/**
	 * Fires once per `/ai/search` invocation, after validation and
	 * before any the provider call. First anchor in the observability trio
	 * (`openstation_ai_search_started` / `openstation_ai_tool_called`
	 * / `openstation_ai_search_completed`).
	 *
	 * @param array $context {
	 *     @type string $query      User query.
	 *     @type int    $user_id
	 *     @type string $request_id UUID correlating the whole run.
	 * }
	 */
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

	// When resuming a previous exhausted run, prime the model with the
	// starting position so it doesn't waste iterations on already-searched
	// content.
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
5. **Answer anything else your tools can** — you may have more tools than the ones described below (WordPress and other plugins register their own, e.g. site / user / environment / version info). Your actual tool list is authoritative: whenever a tool can answer the request, call it and summarise the result, even if it isn't in the list below.
6. **Chat** — only when no tool fits, answer conversationally.

Tone: warm, concise, helpful. First person (\"I found this post…\", \"Here's where you'll find that…\"). Not a search engine tone — no \"Match found\" or robot phrasing.

Tools (your actual tool list may include more than these — use any that fit the request):
- search_posts / search_pages / search_comments / search_comments_by_post(post_id, query, offset): keyword content-lookup tools backed by WordPress's native search. Distil the user's description into the essential search keywords and pass them as `query` (e.g. \"that long post about making paella\" → query \"paella\"). Inspect the returned title + excerpt and stop once you find a good match. If has_more is true and nothing matched, call the same tool with next_offset (reuse the same query), or try different keywords. When the query mentions BOTH a post and a comment on that post, call search_posts first to identify the post, THEN search_comments_by_post with the ID. If keyword search returns nothing, broaden or simplify the keywords before giving up.
- list_admin_pages: returns the full catalog of wp-admin destinations. Call once per navigation query, then select the 1-3 most relevant entries.
- search_wporg_plugins(query): searches the official WordPress.org plugin directory. Use when the user asks for a plugin recommendation (\"a plugin for X\", \"is there a plugin that does Y?\"). Returns up to 10 plugins with ratings, install counts, and admin install URLs. Present the best 3-5 as admin_links with titles like \"Plugin Name · 5M+ installs · 4.8★\" (rating is 0-100, divide by 20 to get stars).
- get_php_error_log(lines): reads the tail of the site's PHP error log. Admin-only (the tool itself checks). Use when the user asks \"any errors?\", \"check the logs\", \"what's broken?\", troubleshooting. Each entry has { timestamp, level, message }. Summarise the most important errors (Fatal > Warning > Notice) in your message; don't copy-paste everything.

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

	// -----------------------------------------------------------------------
	// System-prompt extensibility. All three layers — appendix filter,
	// client override (append/replace with capability gate), and final
	// transform — live in `openstation_ai_compose_instructions()` so the
	// primary run and the follow-up leg stay in lockstep. See the
	// helper for the order of application; the filter docblocks at its
	// `apply_filters()` call sites carry the public contract on each
	// extension point.
	// -----------------------------------------------------------------------
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

	// -----------------------------------------------------------------------
	// Tool assembly — built-in search/navigation abilities + client-supplied
	// command tools.
	//
	// Built-in tools are WordPress Abilities API abilities. Each is advertised
	// to the model as a function declaration named after the ability (namespace
	// stripped), and $ability_by_tool maps that name back to the ability so the
	// agent loop can resolve + execute() it (permission + input/output
	// validation happen inside execute()).
	// -----------------------------------------------------------------------
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

	// Command tools — namespaced as `command_<slug>` on the server so
	// they can't collide with built-in tool names. Each takes a single
	// optional `args` string arg (matches the slash-command contract
	// where args are a single string the plugin's `run()` parses).
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
		/**
		 * Per-tool filter on the client-supplied command list. Return
		 * `false` to drop a command entirely before it reaches the
		 * model — the right hook for per-role / per-command gating.
		 *
		 * @param bool|array $allowed Either the (possibly mutated) command
		 *                            tool entry, or `false` to drop it.
		 * @param string     $slug    Command slug.
		 * @param array      $context { user_id, request_id }.
		 */
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

	/**
	 * Transform the command-tool subset before merging with the
	 * built-in + registered tools. Useful for bulk gating, renaming,
	 * or injecting synthetic command tools.
	 *
	 * @param array $command_defs Command tool definitions.
	 * @param array $context      { user_id, request_id }.
	 */
	$command_defs = (array) apply_filters(
		'openstation_ai_command_tools',
		$command_defs,
		array(
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	$tools = array_merge( $builtin_tools, $command_defs );

	/**
	 * Transform the full tool list (built-in abilities + command tools) just
	 * before it goes to the provider. Fires once per run — changes apply to
	 * every iteration in the agent loop.
	 *
	 * @param array $tools   Full the provider tool definitions array.
	 * @param array $context { user_id, request_id, query }.
	 */
	$tools = (array) apply_filters(
		'openstation_ai_tools',
		$tools,
		array(
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'query'      => $query,
		)
	);

	// Normalize every tool's schema onto the provider-supported subset, AFTER the
	// filter so it covers the complete list the provider will receive — built-in
	// abilities, command tools, and anything a plugin injected. One tool with a
	// legal-but-unsupported schema otherwise 400s the entire request, not just its
	// own tool. Only the model-facing copy is reshaped; abilities still validate
	// arguments against their real schema in execute(). Idempotent, so a plugin
	// that already normalizes on the filter above is unaffected.
	foreach ( $tools as $ti => $tool ) {
		if ( is_array( $tool ) && isset( $tool['parameters'] ) ) {
			$tools[ $ti ]['parameters'] = openstation_ai_normalize_tool_schema( $tool['parameters'] );
		}
	}

	// Widen the permitted-tools list with the command tools — the agent loop
	// rejects any `function_call` whose name isn't in here (built-in ability
	// names were added above).
	foreach ( $command_defs as $def ) {
		if ( isset( $def['name'] ) ) {
			$valid_tools[] = (string) $def['name'];
		}
	}

	$answer_schema = openstation_ai_search_answer_schema();

	$emit(
		array(
			'phase'   => 'start',
			'message' => 'Thinking about your question…',
		)
	);

	// -----------------------------------------------------------------------
	// First call — user query as the sole message, instructions as system
	// guidance. Generation routes through the WordPress AI Client; the tools
	// are advertised as function declarations and dispatched by this loop.
	// The full ordered conversation is rebuilt and re-sent each turn.
	// -----------------------------------------------------------------------
	$messages = array( openstation_ai_user_text_message( $query ) );

	$turn = openstation_ai_client_generate( $user_id, $messages, $tools, $answer_schema, $instructions );

	if ( is_wp_error( $turn ) ) {
		return $turn;
	}

	$last_tool     = $initial_tool ?? 'search_posts';
	$last_offset   = $start_offset;
	$last_has_more = true;
	$iterations    = 0;

	// Accumulate token usage across every turn and remember the last model the
	// AI Client resolved, for the `openstation_ai_search_completed` payload.
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

	// -----------------------------------------------------------------------
	// Agentic loop — each iteration either executes tool calls or returns
	// the final answer. The full ordered conversation (user query, assistant
	// turns, tool results) is accumulated in $messages and re-sent each turn.
	// -----------------------------------------------------------------------
	for ( $i = 0; $i < OPENSTATION_AI_SEARCH_MAX_ITERATIONS; $i++ ) {
		$function_calls = is_array( $turn['function_calls'] ?? null ) ? $turn['function_calls'] : array();

		// No tool calls in this response → final answer.
		if ( empty( $function_calls ) ) {
			$emit(
				array(
					'phase'   => 'composing',
					'message' => 'Putting together your answer…',
				)
			);
			// A toolless turn with no extractable text never reaches here:
			// openstation_ai_client_generate() returns
			// `openstation_ai_empty_answer` for that case, handled with the
			// other generation errors above.
			$text = (string) ( $turn['text'] ?? '' );

			$answer = json_decode( $text, true );
			if ( ! is_array( $answer ) ) {
				return new WP_Error( 'openstation_ai_result_parse', 'Could not parse structured search answer.' );
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

			/**
			 * Final transform hook — fires right before the HTTP
			 * response is returned. Plugins can rewrite `message`,
			 * inject `admin_links`, coerce `answer_type`, etc.
			 *
			 * @param array $answer  Final answer payload.
			 * @param array $context { query, user_id, request_id }.
			 */
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

		// -------------------------------------------------------------------
		// Command-tool short-circuit.
		//
		// If the model emitted `command_<slug>`, we return immediately with
		// `answer_type: 'tool_call'` — the client owns the command's `run()`
		// function (lives in plugin JS) and executes it locally. We do NOT
		// send anything else back to the provider this turn — would burn tokens
		// for a no-op second response.
		// -------------------------------------------------------------------
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

		// Execute each tool call and collect results as
		// `{ call_id, name, response }` — turned into FunctionResponse parts
		// for the next turn by openstation_ai_tool_result_message().
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

			$emit(
				array(
					'phase'   => 'tool_call',
					'tool'    => $tool_name,
					'message' => openstation_ai_progress_message( $tool_name ),
				)
			);

			do_action(
				'openstation_ai_tool_called',
				array(
					'tool_name'  => $tool_name,
					'args'       => $args,
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			// Resolve + run the ability. execute() runs the permission_callback
			// and validates input/output; a denial or bad input comes back as a
			// WP_Error, which we surface to the model as a clean tool error
			// (never a fatal) and report on the observability channel.
			$ability = isset( $ability_by_tool[ $tool_name ] ) ? wp_get_ability( $ability_by_tool[ $tool_name ] ) : null;
			if ( $ability instanceof WP_Ability ) {
				// Abilities that declare no input schema (e.g. Core's
				// get-*-info) reject any non-null input, so pass null when
				// there's no schema; otherwise hand over the decoded args.
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

			/**
			 * Transform a tool result before it goes back to the model.
			 * Fires for every ability-dispatched tool (including error
			 * envelopes from a failed execute()).
			 *
			 * @param array  $batch     Tool result payload.
			 * @param string $tool_name Tool function name.
			 * @param array  $args      Decoded args from the call.
			 * @param array  $context   { user_id, request_id }.
			 */
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

		// Next turn — append the assistant's tool-call turn and our tool
		// results to the conversation, then regenerate with the full history.
		$messages[] = $turn['message'];
		$messages[] = openstation_ai_tool_result_message( $tool_outputs );

		$turn = openstation_ai_client_generate( $user_id, $messages, $tools, $answer_schema, $instructions );

		if ( is_wp_error( $turn ) ) {
			return $turn;
		}
		$accrue_usage( $turn );
	}

	// -----------------------------------------------------------------------
	// Budget exhausted before a final answer.
	// -----------------------------------------------------------------------
	$continue = null;
	if ( $last_has_more ) {
		$next_offset = $last_offset + OPENSTATION_AI_SEARCH_BATCH_SIZE;
		// `search_comments_by_post` cannot resume — the continue payload
		// carries no post_id — so fall back to plain comment search,
		// keeping `tool` inside openstation_ai_search_resumable_tools().
		$resume_tool = 'search_comments_by_post' === $last_tool ? 'search_comments' : $last_tool;
		$type_label  = str_replace( 'search_', '', $resume_tool ) . 's';
		$continue    = array(
			'tool'        => $resume_tool,
			'entity_type' => rtrim( str_replace( 'search_', '', $resume_tool ), 's' ),
			'offset'      => $next_offset,
			'label'       => sprintf( 'Continue searching in %s (from item %d)', $type_label, $next_offset + 1 ),
		);
	}

	$final = array(
		'answer_type' => 'chat',
		'message'     => 'I searched 100 items without finding a clear match. Want me to keep looking further?',
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

/**
 * Compose the final system-prompt string for an `/ai/search` call.
 *
 * One code path used by both the primary run and the follow-up leg —
 * keeps the voice consistent across legs and removes a class of drift
 * bug where the two paths's prompt-assembly drifts apart.
 *
 * Applies three layers in order:
 *   1. `openstation_ai_system_prompt_appendix` — stacking filter;
 *      every plugin's return is concatenated.
 *   2. Client override — `system_prompt_text` + `system_prompt_mode`.
 *      `append` always allowed; `replace` gated on
 *      `openstation_ai_system_prompt_replace_capability`. Non-permitted
 *      `replace` downgrades to `append` so the caller's text is
 *      preserved rather than dropped.
 *   3. `openstation_ai_system_prompt` — final transform pass.
 *
 * @internal
 *
 * @param string $core    Built-in instructions for this phase
 *                        (agent loop / follow-up summariser).
 * @param array  $context { query, user_id, request_id, phase? }.
 * @param array  $client  { text, mode } client override; either field
 *                        empty means no override.
 * @return string Composed system prompt.
 */
function openstation_ai_compose_instructions( $core, array $context, array $client = array() ) {
	$instructions = (string) $core;
	$user_id      = isset( $context['user_id'] ) ? (int) $context['user_id'] : 0;

	$client_text = isset( $client['text'] ) && is_string( $client['text'] ) ? $client['text'] : '';
	$client_mode = isset( $client['mode'] ) && in_array( $client['mode'], array( 'append', 'replace' ), true )
		? (string) $client['mode']
		: 'append';

	$ctx_for_filter                    = $context;
	$ctx_for_filter['client_override'] = '' !== $client_text ? $client_mode : null;

	/**
	 * Short-circuit extension — appended to the built-in instructions
	 * verbatim. Use this when a plugin just wants to add domain
	 * context (room list, product catalogue, company jargon) without
	 * restructuring the core rules. Fires for both the primary
	 * `/ai/search` run and the follow-up composed-reply leg.
	 *
	 * @param string $appendix Accumulated appendix. Default empty.
	 * @param array  $context  { query, user_id, request_id, client_override, phase? }.
	 */
	$server_appendix = (string) apply_filters( 'openstation_ai_system_prompt_appendix', '', $ctx_for_filter );
	if ( '' !== $server_appendix ) {
		$instructions .= "\n\n" . $server_appendix;
	}

	if ( '' !== $client_text ) {
		if ( 'replace' === $client_mode ) {
			/**
			 * Capability required for a client to send
			 * `system_prompt: { mode: 'replace' }`. Defaults to `manage_options`
			 * — replacing the whole prompt can effectively hijack the
			 * assistant, so it's admin-only out of the box.
			 *
			 * @param string $capability Default `manage_options`.
			 * @param array  $context
			 */
			$required_cap = (string) apply_filters(
				'openstation_ai_system_prompt_replace_capability',
				'manage_options',
				$ctx_for_filter
			);
			if ( '' === $required_cap || ( $user_id > 0 && user_can( $user_id, $required_cap ) ) ) {
				$instructions = $client_text;
			} else {
				// Silently downgrade to append — preserves the caller's
				// text rather than dropping it when the cap check fails.
				$instructions .= "\n\n" . $client_text;
			}
		} else {
			$instructions .= "\n\n" . $client_text;
		}
	}

	/**
	 * Final transform pass. Fires after the built-in instructions,
	 * server appendix, and client override have all been composed.
	 *
	 * @param string $instructions Composed system prompt.
	 * @param array  $context
	 */
	return (string) apply_filters( 'openstation_ai_system_prompt', $instructions, $ctx_for_filter );
}

/**
 * Compose a natural-language reply describing the outcome of a
 * client-dispatched command invocation.
 *
 * Called by the REST endpoint when the client sends `follow_up` —
 * the second leg of the opt-in agentic flow triggered by
 * `wp.os.ai.ask( q, { tools: 'aiCallable', followUp: true } )`.
 *
 * Single-turn, no tools, no structured-output schema — the model
 * sees the original query + a summary of what happened and writes a
 * one/two-sentence reply in the voice of the system prompt. We reuse
 * the same system-prompt pipeline as the main search so plugins
 * appending instructions via `openstation_ai_system_prompt_appendix`
 * see consistent voice across the two legs.
 *
 * @param string $query     Original user query.
 * @param array  $tool      { slug, args } — what ran.
 * @param array  $outcome   Tool result payload. Opaque — JSON-encoded
 *                          into the model's context so it can reason
 *                          about whatever shape the plugin returned.
 * @param array  $extra     Same shape as `openstation_ai_run_search`'s
 *                          `$extra` — carries user_id, request_id,
 *                          system-prompt overrides.
 * @return array|WP_Error   `{ answer_type: 'chat', message, … }` or error.
 */
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

	// Mirror the main search's system-prompt layering so voice stays
	// consistent between the two legs. We build a simpler core-
	// instructions block — no tool guidance, since this run has none.
	$instructions = '
You are the same friendly WordPress assistant that just dispatched a command on behalf of the user. You now have the result of that command.

Write a SHORT reply (one or two sentences, first person, warm and conversational) describing what happened. Match the voice the site owner set in their system prompt — do not restart small talk, just confirm what you did.

Rules:
- If the outcome looks successful, confirm plainly. Example: "Done — your office light is on now."
- If the outcome looks like an error (has an `error` field, a failure message, or obviously negative content), apologise briefly and paraphrase what went wrong. Do not invent details the outcome did not include.
- Do NOT recommend the user try something else unless the outcome explicitly suggests it.
- Do NOT describe the tool mechanism ("I called command_turn_light") — the user only cares about the real-world effect.
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

	// Bound the outcome payload so a malicious or buggy plugin that
	// returns a 5MB blob can't inflate the provider token usage without
	// bound. 4 KB is enough for a status string, a small result list,
	// or a short error envelope — anything bigger gets truncated with
	// a marker so the model knows the tail was dropped.
	//
	// `mb_*` variants so truncation on a multibyte boundary
	// (Japanese / emoji / accented UTF-8) can't produce invalid JSON
	// that the provider would reject. Falls back to byte-level substr when
	// mbstring is unavailable (rare but possible on minimal PHP
	// builds).
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
		array(), // no tools — we want a plain reply
		null,    // no JSON schema — free-form text
		$instructions
	);

	// `openstation_ai_empty_answer` is the one generation error this path
	// deliberately absorbs: the command DID run, so a text-less summary turn
	// degrades to the generic confirmation below instead of surfacing as a
	// failure of the command itself.
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
		// Graceful degrade — if the provider returned nothing usable, fall
		// back to a generic confirmation so the caller always has a
		// message to show. Better than returning an error and losing
		// the fact that the command *did* run. We flag the degrade so
		// observability subscribers can distinguish a deliberate
		// "Done." from a silently-degraded one.
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

// ---------------------------------------------------------------------------
// REST endpoint
// ---------------------------------------------------------------------------

/**
 * Registers the AI search REST route.
 */
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
				// `resume_tool` + `start_offset` are only set when the
				// client is continuing a previous search from the `continue`
				// object returned by an exhausted run. Fresh searches leave
				// both unset — the agent picks tools from query semantics.
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
				// Client-harvested slash-commands the user's plugins have
				// opted in as AI tools. Each entry: { slug, label, description?, hint? }.
				// The slug is namespaced server-side as `command_<slug>`
				// and any tool_call the model emits with that name short-
				// circuits back to the client for local dispatch.
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
				// Free-form system-prompt override.
				// mode: 'append' → concatenated onto the built-in prompt (safe for everyone)
				// mode: 'replace' → replaces the built-in prompt entirely, gated on
				// `openstation_ai_system_prompt_replace_capability`
				// (default `manage_options`).
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
				// Follow-up leg of the agentic command-dispatch flow.
				// When present, the endpoint SKIPS the agent loop entirely
				// and runs a single-turn "summarise this outcome" call
				// through the provider instead. The client sends this on the
				// second leg of `ask( q, { tools: 'aiCallable', followUp: true } )`.
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

/**
 * Permission callback.
 *
 * @return bool|WP_Error
 */
function openstation_rest_ai_search_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'read' ) ) {
		return new WP_Error(
			'openstation_ai_forbidden',
			'You must be logged in to use the AI assistant.',
			array( 'status' => 403 )
		);
	}
	if ( ! openstation_ai_is_available() ) {
		return new WP_Error(
			'openstation_ai_unavailable',
			'The AI assistant is unavailable on this site.',
			array( 'status' => 503 )
		);
	}
	if ( ! openstation_ai_is_enabled( get_current_user_id() ) ) {
		return new WP_Error(
			'openstation_ai_disabled',
			'The AI assistant is turned off. Enable it in OpenStation Preferences → Features.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * POST /desktop-mode/v1/ai/search
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function openstation_rest_ai_search( WP_REST_Request $request ) {
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

	/**
	 * Last-mile filter on the whole `/ai/search` request bundle.
	 * Plugins get one hook to rewrite query, swap tools, or inject
	 * metadata before the agent loop starts.
	 *
	 * @param array $extra Extended context (mutable).
	 * @param array $core  Core request params { query, resume_tool, start_offset }.
	 */
	$extra = (array) apply_filters(
		'openstation_ai_request',
		$extra,
		array(
			'query'        => $query,
			'resume_tool'  => $resume_tool,
			'start_offset' => $start_offset,
		)
	);

	// Follow-up leg — skip the agent loop, summarise the tool outcome.
	$follow_up = $request->get_param( 'follow_up' );
	if ( is_array( $follow_up ) && isset( $follow_up['tool'] ) && is_array( $follow_up['tool'] ) ) {
		$tool    = $follow_up['tool'];
		$outcome = isset( $follow_up['result'] )
			? ( is_array( $follow_up['result'] ) ? $follow_up['result'] : array( 'value' => $follow_up['result'] ) )
			: array();
		$result  = openstation_ai_run_followup( $query, $tool, $outcome, $extra );
	} else {
		$result = openstation_ai_run_search( $query, $resume_tool, $start_offset, null, $extra );
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

// ---------------------------------------------------------------------------
// Tool: search_wporg_plugins — uses core's plugins_api() which queries
// the official WordPress.org repository. Results are cached in a
// 10-minute transient per query so repeated asks don't hammer w.org.
// ---------------------------------------------------------------------------

/**
 * Search the WordPress.org plugin directory.
 *
 * @param string $query Search terms.
 * @return array Tool result payload ready for the model.
 */
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

	// Transient cache to protect the w.org API from repeated queries
	// within the same conversation.
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
		// Normalise — plugins_api sometimes returns arrays, sometimes objects.
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

		// Admin URL that opens the plugin-information thickbox. Includes
		// both &plugin=slug and the TB_iframe params so clicking it in
		// wp-admin behaves like a native "More details" link.
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
			'rating'            => (int) ( $p['rating'] ?? 0 ),         // 0-100
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

// ---------------------------------------------------------------------------
// Tool: get_php_error_log — reads the tail of the site's error log.
// Admin-only; the capability check is performed in the dispatcher
// BEFORE this function runs, so by the time we get here the caller is
// known to hold manage_options.
// ---------------------------------------------------------------------------

/**
 * Read and parse the tail of the site's PHP error log.
 *
 * Tries WP_CONTENT_DIR/debug.log first (populated by WP_DEBUG_LOG), then
 * falls back to the PHP ini `error_log` directive. If neither points at
 * a readable file the tool reports log_available=false rather than
 * throwing.
 *
 * @param int $lines Number of lines to return (clamped 1-500 by caller).
 * @return array
 */
function openstation_ai_fetch_error_log( $lines = 50 ) {
	$candidates = array();
	if ( defined( 'WP_CONTENT_DIR' ) ) {
		$candidates[] = WP_CONTENT_DIR . '/debug.log';
	}
	$ini_log = (string) ini_get( 'error_log' );
	if ( '' !== $ini_log && 'syslog' !== $ini_log ) {
		$candidates[] = $ini_log;
	}

	/**
	 * Filter the list of log-file paths to probe in order. Plugins that
	 * redirect errors somewhere non-standard can add their path here.
	 *
	 * @param string[] $candidates File paths, in probe order.
	 */
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

/**
 * Parse a PHP error_log line into { timestamp, level, message }.
 *
 * PHP's default format is `[<date>] <prefix>: <message>` where the
 * prefix is usually "PHP Fatal error", "PHP Warning", etc. Falls back
 * to a raw line when the format doesn't match.
 *
 * @param string $line
 * @return array
 */
function openstation_ai_parse_log_line( $line ) {
	// Cap individual messages so a runaway stack trace doesn't balloon
	// the payload sent to the provider.
	$line = mb_substr( $line, 0, 600 );

	$entry = array(
		'timestamp' => '',
		'level'     => 'Log',
		'message'   => $line,
	);

	// [21-Apr-2026 10:30:22 UTC] PHP Fatal error:  Uncaught Error: …
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

/**
 * Return the last $lines of a file. Loads the file via WP_Filesystem
 * (the only file-read API allowed for wp.org-hosted plugins) and
 * slices off the trailing N+1 entries. Realistic error logs sit
 * in the kilobyte range when admins look at them; if a site routinely
 * lets logs grow into tens of MB, that's the symptom, not this read.
 *
 * @param string $path Absolute path to the file.
 * @param int    $lines
 * @return string[] Lines in original order (oldest first).
 */
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

// ---------------------------------------------------------------------------
// Streaming endpoint (Server-Sent Events)
//
// EventSource can't send POST or custom headers, so we ride admin-ajax.php
// which handles cookie-based auth natively. The nonce goes in the URL.
// Output buffering is forcibly disabled and every emit is flushed so the
// browser receives progress ticks in real time.
// ---------------------------------------------------------------------------

/**
 * Admin-ajax handler for the streaming search endpoint.
 *
 * URL: /wp-admin/admin-ajax.php?action=openstation_ai_search_stream
 *   &nonce=<rest_nonce>
 *   &query=<user question>
 *   &resume_tool=<search_posts|…>   (optional)
 *   &start_offset=<int>             (optional)
 *
 * Emits SSE events:
 *   data: { "event": "progress", "phase": "tool_call", "message": "…" }
 *   data: { "event": "done",     "result": { … } }
 *   data: { "event": "error",    "message": "…" }
 */
function openstation_ai_ajax_search_stream() {
	$nonce = isset( $_GET['nonce'] ) ? sanitize_text_field( wp_unslash( $_GET['nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
		status_header( 403 );
		exit;
	}
	if ( ! is_user_logged_in() || ! current_user_can( 'read' ) ) {
		status_header( 403 );
		exit;
	}
	$user_id = get_current_user_id();
	if ( ! openstation_ai_is_available() ) {
		status_header( 503 );
		exit;
	}
	if ( ! openstation_ai_is_enabled( $user_id ) ) {
		status_header( 403 );
		exit;
	}

	$query = isset( $_GET['query'] ) ? sanitize_text_field( wp_unslash( $_GET['query'] ) ) : ''; // phpcs:ignore WordPress.Security
	if ( trim( $query ) === '' ) {
		status_header( 400 );
		exit;
	}

	$resume_tool  = isset( $_GET['resume_tool'] ) ? sanitize_key( wp_unslash( $_GET['resume_tool'] ) ) : null; // phpcs:ignore WordPress.Security
	$start_offset = isset( $_GET['start_offset'] ) ? absint( $_GET['start_offset'] ) : 0; // phpcs:ignore WordPress.Security
	if ( null !== $resume_tool && ! in_array( $resume_tool, openstation_ai_search_resumable_tools(), true ) ) {
		$resume_tool = null;
	}

	// SSE headers — tell nginx to stop buffering, tell the browser this is
	// a persistent event stream.
	header( 'Content-Type: text/event-stream; charset=utf-8' );
	header( 'Cache-Control: no-cache, no-store, must-revalidate' );
	header( 'X-Accel-Buffering: no' );
	header( 'Connection: keep-alive' );

	// Let other requests from this user proceed (release session lock).
	if ( session_status() === PHP_SESSION_ACTIVE ) {
		session_write_close();
	}

	// Kill any output buffers PHP set up, otherwise nothing flushes until
	// the request ends — which defeats the whole point of streaming.
	while ( ob_get_level() > 0 ) {
		@ob_end_flush(); // phpcs:ignore
	}
	@ini_set( 'output_buffering', 'off' ); // phpcs:ignore
	@ini_set( 'zlib.output_compression', 'off' ); // phpcs:ignore
	@set_time_limit( 120 ); // phpcs:ignore

	$emit = static function ( array $payload ) {
		echo 'data: ' . wp_json_encode( $payload ) . "\n\n";
		@ob_flush(); // phpcs:ignore
		flush();
	};

	// Initial tick so the EventSource opens immediately and the JS can
	// start showing "Thinking…" without waiting for the first model call.
	$emit( array( 'event' => 'open' ) );

	$result = openstation_ai_run_search(
		$query,
		$resume_tool,
		$start_offset,
		function ( $progress ) use ( $emit ) {
			$emit( array_merge( array( 'event' => 'progress' ), $progress ) );
		}
	);

	if ( is_wp_error( $result ) ) {
		$emit(
			array(
				'event'   => 'error',
				'message' => $result->get_error_message(),
				'code'    => $result->get_error_code(),
			)
		);
	} else {
		$emit(
			array(
				'event'  => 'done',
				'result' => $result,
			)
		);
	}

	exit;
}
add_action( 'wp_ajax_openstation_ai_search_stream', 'openstation_ai_ajax_search_stream' );
