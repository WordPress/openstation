<?php
/**
 * Desktop Mode — AI Copilot content search via OpenAI tool use.
 *
 * Agentic search loop: the user describes something in natural language and
 * the OpenAI agent calls focused tools — search_posts, search_pages,
 * search_comments — choosing the right one based on query semantics. Each
 * tool fetches 10 entities with their _desktop_mode_ai_analysis meta so the model
 * can compare AI-generated summaries to the user's description.
 *
 * Three tools instead of one parameter:
 *   - "I remember a comment where someone said congratulations…" → agent
 *     calls search_comments without needing a routing parameter.
 *   - "I wrote a post about paella in Canarias" → agent calls search_posts.
 *   - "Our About page mentions…" → agent calls search_pages.
 *   - Ambiguous queries → agent tries in priority order (posts → pages →
 *     comments) following the system-prompt guidance.
 *
 * Budget: max DESKTOP_MODE_AI_SEARCH_MAX_ITERATIONS (10) tool-call rounds per
 * request × DESKTOP_MODE_AI_SEARCH_BATCH_SIZE (10) items = up to 100 entities.
 * When the budget is exhausted the response includes a `continue` object
 * the client uses to resume from the exact offset that was last searched.
 *
 * REST endpoint: POST /desktop-mode/v1/ai/search
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Maximum agentic tool-call iterations per search request. */
const DESKTOP_MODE_AI_SEARCH_MAX_ITERATIONS = 10;

/** Entities fetched per tool-call round. */
const DESKTOP_MODE_AI_SEARCH_BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Tool definitions — one per entity type so the model picks semantically
// ---------------------------------------------------------------------------

/**
 * Returns all three search tools as an array ready for the OpenAI `tools`
 * field. Providing three focused tools (rather than one with an entity_type
 * parameter) lets the model reason about the query — "someone said X" →
 * search_comments; "I published a post about Y" → search_posts — without
 * needing an explicit routing hint from the user or the system prompt.
 *
 * Each tool schema uses `strict: true` with a single `offset` parameter so
 * the model can never hallucinate extra arguments.
 *
 * @since 0.14.0
 *
 * @return array[]
 */
function desktop_mode_ai_search_tool_definitions() {
	// Responses API tool definitions are FLAT — no nested `function` wrapper.
	// The `type`, `name`, `description`, and `parameters` sit at the top level.
	$offset_param = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'offset' ),
		'properties'           => array(
			'offset' => array(
				'type'        => 'integer',
				'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
			),
		),
	);

	return array(
		array(
			'type'        => 'function',
			'name'        => 'search_posts',
			'description' => 'Searches published WordPress blog posts that have been analyzed by the AI. Use this when the user is looking for content they or someone else wrote as a post or article. Returns up to 10 posts with their topic label, AI summary, title, date, and URLs. If has_more is true, call again with the next offset.',
			'parameters'  => $offset_param,
		),
		array(
			'type'        => 'function',
			'name'        => 'search_pages',
			'description' => 'Searches published WordPress pages (About, Contact, Services, Portfolio, etc.) that have been analyzed by the AI. Use this when the user is looking for a static page, landing page, or informational page on the site. Returns up to 10 pages with their topic label, AI summary, title, and URLs. If has_more is true, call again with the next offset.',
			'parameters'  => $offset_param,
		),
		array(
			'type'        => 'function',
			'name'        => 'search_comments',
			'description' => 'Searches approved WordPress comments across ALL posts that have been analyzed by the AI. Use this when the user remembers something a reader said but does not know which post it was on. Returns up to 10 comments with their topic, AI summary, excerpt, parent post title, and URLs. If has_more is true, call again with the next offset.',
			'parameters'  => $offset_param,
		),
		array(
			'type'        => 'function',
			'name'        => 'search_comments_by_post',
			'description' => 'Searches approved comments on a SPECIFIC post by its WordPress ID. Use this when you have already identified a post (via search_posts) and the user\'s query also mentions something a reader said on that post — e.g. "I remember a comment on my Málaga post asking about the Alcazaba at night." Call search_posts first to find the post ID, then call this tool with that ID. Much more precise than search_comments when the parent post is known. If has_more is true, call again with the next offset.',
			'parameters'  => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id', 'offset' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => 'The WordPress ID of the post whose comments should be searched. Obtain this from a prior search_posts call.',
					),
					'offset'  => array(
						'type'        => 'integer',
						'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
					),
				),
			),
		),
		array(
			'type'        => 'function',
			'name'        => 'list_admin_pages',
			'description' => 'Returns the full catalog of WordPress admin (wp-admin) destinations — pages for managing posts, categories, users, plugins, themes, settings, etc. Call this when the user asks "where can I find X?", "how do I get to Y?", "where are the settings for Z?" — any navigational question about the admin UI. Once you have the catalog, select the 1-3 most relevant entries for the user\'s query and include them in your answer under admin_links with answer_type="navigation". The catalog is small and stable so one call is enough.',
			'parameters'  => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array(),
				'properties'           => new stdClass(),
			),
		),
		array(
			'type'        => 'function',
			'name'        => 'search_wporg_plugins',
			'description' => 'Searches the official WordPress.org plugin directory. Use this when the user asks for a plugin recommendation — e.g. "is there a plugin for SEO?", "find me a backup plugin", "a caching plugin", "form builder". Returns up to 10 plugins with name, description, rating, active install count, and an admin URL that opens the plugin-info / install screen directly. Present the results as admin_links with answer_type="navigation", titled "Plugin Name · 5M+ installs · 4.8★".',
			'parameters'  => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'query' ),
				'properties'           => array(
					'query' => array(
						'type'        => 'string',
						'description' => 'Plain-language search terms — e.g. "seo", "backup", "caching", "woocommerce", "contact form".',
					),
				),
			),
		),
		array(
			'type'        => 'function',
			'name'        => 'get_php_error_log',
			'description' => 'Reads the most recent entries from the site\'s PHP error log — typically wp-content/debug.log when WP_DEBUG_LOG is enabled, or the path set by the PHP error_log directive. Use this when the user asks "are there any errors?", "check the logs", "what went wrong?", or is troubleshooting a white screen / 500. Each entry is parsed into { timestamp, level, message } so you can summarise them. Administrators only — the tool returns an error for non-admins.',
			'parameters'  => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'lines' ),
				'properties'           => array(
					'lines' => array(
						'type'        => 'integer',
						'description' => 'How many recent log lines to return (1-500). Use 20-50 for a quick look, 100-200 for wider context.',
					),
				),
			),
		),
	);
}

/**
 * Returns the catalog of common WordPress admin destinations.
 *
 * Used by the `list_admin_pages` tool. Each entry has a human title, the
 * wp-admin URL (rendered through admin_url() so it respects the site's
 * real admin path), a short description, and a Dashicons icon class the
 * UI can use when opening the URL in a legacy iframe window.
 *
 * Filterable via `desktop_mode_ai_admin_page_catalog` so third-party
 * plugins can contribute their own admin destinations (e.g. a plugin
 * adding a top-level menu can surface its settings page here).
 *
 * @since 0.14.0
 *
 * @return array[]
 */
function desktop_mode_ai_get_admin_page_catalog() {
	$catalog = array(
		array( 'title' => 'Dashboard',          'url' => admin_url( 'index.php' ),                             'icon' => 'dashicons-dashboard',        'description' => 'The main admin dashboard — activity, drafts, site overview.' ),
		array( 'title' => 'All Posts',          'url' => admin_url( 'edit.php' ),                              'icon' => 'dashicons-admin-post',       'description' => 'List, edit, bulk-manage blog posts.' ),
		array( 'title' => 'Add New Post',       'url' => admin_url( 'post-new.php' ),                          'icon' => 'dashicons-plus',             'description' => 'Create a new blog post.' ),
		array( 'title' => 'Categories',         'url' => admin_url( 'edit-tags.php?taxonomy=category' ),       'icon' => 'dashicons-category',         'description' => 'Manage post categories — add, rename, merge.' ),
		array( 'title' => 'Tags',               'url' => admin_url( 'edit-tags.php?taxonomy=post_tag' ),       'icon' => 'dashicons-tag',              'description' => 'Manage post tags.' ),
		array( 'title' => 'All Pages',          'url' => admin_url( 'edit.php?post_type=page' ),               'icon' => 'dashicons-admin-page',       'description' => 'List and edit static pages (About, Contact, etc.).' ),
		array( 'title' => 'Add New Page',       'url' => admin_url( 'post-new.php?post_type=page' ),           'icon' => 'dashicons-plus',             'description' => 'Create a new page.' ),
		array( 'title' => 'Media Library',      'url' => admin_url( 'upload.php' ),                            'icon' => 'dashicons-admin-media',      'description' => 'Browse, upload, and manage images, files, videos.' ),
		array( 'title' => 'Comments',           'url' => admin_url( 'edit-comments.php' ),                     'icon' => 'dashicons-admin-comments',   'description' => 'Moderate and reply to comments on posts and pages.' ),
		array( 'title' => 'Themes',             'url' => admin_url( 'themes.php' ),                            'icon' => 'dashicons-admin-appearance', 'description' => 'Change, install, or customize the active theme.' ),
		array( 'title' => 'Customize',          'url' => admin_url( 'customize.php' ),                         'icon' => 'dashicons-admin-customizer', 'description' => 'Live-preview theme customisation — colors, fonts, layout.' ),
		array( 'title' => 'Widgets',            'url' => admin_url( 'widgets.php' ),                           'icon' => 'dashicons-screenoptions',    'description' => 'Manage sidebar and footer widgets.' ),
		array( 'title' => 'Menus',              'url' => admin_url( 'nav-menus.php' ),                         'icon' => 'dashicons-menu',             'description' => 'Create and edit navigation menus.' ),
		array( 'title' => 'Plugins',            'url' => admin_url( 'plugins.php' ),                           'icon' => 'dashicons-admin-plugins',    'description' => 'Activate, deactivate, update or delete plugins.' ),
		array( 'title' => 'Add New Plugin',     'url' => admin_url( 'plugin-install.php' ),                    'icon' => 'dashicons-plus',             'description' => 'Search and install new plugins from the directory.' ),
		array( 'title' => 'Users',              'url' => admin_url( 'users.php' ),                             'icon' => 'dashicons-admin-users',      'description' => 'Manage user accounts and roles.' ),
		array( 'title' => 'Add New User',       'url' => admin_url( 'user-new.php' ),                          'icon' => 'dashicons-plus',             'description' => 'Create a new user account.' ),
		array( 'title' => 'Your Profile',       'url' => admin_url( 'profile.php' ),                           'icon' => 'dashicons-id',               'description' => 'Edit your own profile, password, admin colour scheme.' ),
		array( 'title' => 'General Settings',   'url' => admin_url( 'options-general.php' ),                   'icon' => 'dashicons-admin-settings',   'description' => 'Site title, tagline, URL, timezone, language.' ),
		array( 'title' => 'Writing Settings',   'url' => admin_url( 'options-writing.php' ),                   'icon' => 'dashicons-edit',             'description' => 'Default post category, post format, remote publishing.' ),
		array( 'title' => 'Reading Settings',   'url' => admin_url( 'options-reading.php' ),                   'icon' => 'dashicons-book',             'description' => 'Homepage, blog posts per page, search-engine visibility.' ),
		array( 'title' => 'Discussion Settings','url' => admin_url( 'options-discussion.php' ),                'icon' => 'dashicons-format-chat',      'description' => 'Comment moderation, avatars, email notifications.' ),
		array( 'title' => 'Media Settings',     'url' => admin_url( 'options-media.php' ),                     'icon' => 'dashicons-format-image',     'description' => 'Image size settings for thumbnail / medium / large.' ),
		array( 'title' => 'Permalinks',         'url' => admin_url( 'options-permalink.php' ),                 'icon' => 'dashicons-admin-links',      'description' => 'URL structure for posts, pages, categories, tags.' ),
		array( 'title' => 'Privacy',            'url' => admin_url( 'options-privacy.php' ),                   'icon' => 'dashicons-privacy',          'description' => 'Privacy policy page selection and preview.' ),
		array( 'title' => 'Tools',              'url' => admin_url( 'tools.php' ),                             'icon' => 'dashicons-admin-tools',      'description' => 'Built-in site tools.' ),
		array( 'title' => 'Import',             'url' => admin_url( 'import.php' ),                            'icon' => 'dashicons-download',         'description' => 'Import content from other platforms (WP, Tumblr, RSS, etc.).' ),
		array( 'title' => 'Export',             'url' => admin_url( 'export.php' ),                            'icon' => 'dashicons-upload',           'description' => 'Export all site content as XML.' ),
		array( 'title' => 'Site Health',        'url' => admin_url( 'site-health.php' ),                       'icon' => 'dashicons-heart',            'description' => 'Performance and security recommendations for the site.' ),
		array( 'title' => 'Updates',            'url' => admin_url( 'update-core.php' ),                       'icon' => 'dashicons-update',           'description' => 'WordPress, theme, and plugin updates.' ),
	);

	/**
	 * Filters the wp-admin page catalog surfaced by the AI assistant.
	 *
	 * @since 0.14.0
	 *
	 * @param array[] $catalog Array of entries, each with title/url/icon/description.
	 */
	return (array) apply_filters( 'desktop_mode_ai_admin_page_catalog', $catalog );
}

// ---------------------------------------------------------------------------
// Final-answer JSON Schema
// ---------------------------------------------------------------------------

/**
 * JSON Schema for the agent's final structured answer.
 *
 * @since 0.14.0
 *
 * @return array
 */
function desktop_mode_ai_search_answer_schema() {
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
					array( 'type' => 'string', 'enum' => array( 'post', 'page', 'comment' ) ),
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
 * @since 0.14.0
 *
 * @param string $tool_name 'search_posts' | 'search_pages' | 'search_comments'.
 * @param int    $offset
 * @return array Tool result payload.
 */
/**
 * Routes a tool call to the correct DB query by function name.
 *
 * `search_comments_by_post` requires an additional `post_id` arg; all
 * other tools only need `offset`. The caller passes the full decoded
 * arguments array so this function can extract whatever it needs.
 *
 * @since 0.14.0
 *
 * @param string $tool_name Tool function name.
 * @param array  $args      Decoded arguments from the model's tool call.
 * @return array Tool result payload.
 */
function desktop_mode_ai_search_dispatch_tool( $tool_name, array $args ) {
	$offset  = max( 0, (int) ( $args['offset'] ?? 0 ) );

	switch ( $tool_name ) {
		case 'search_posts':
			return desktop_mode_ai_search_fetch_posts( 'post', $offset );
		case 'search_pages':
			return desktop_mode_ai_search_fetch_posts( 'page', $offset );
		case 'search_comments':
			return desktop_mode_ai_search_fetch_comments( $offset );
		case 'search_comments_by_post':
			$post_id = max( 0, (int) ( $args['post_id'] ?? 0 ) );
			return desktop_mode_ai_search_fetch_comments_by_post( $post_id, $offset );
		case 'list_admin_pages':
			return array(
				'tool'  => 'list_admin_pages',
				'pages' => desktop_mode_ai_get_admin_page_catalog(),
			);
		case 'search_wporg_plugins':
			$q = isset( $args['query'] ) ? sanitize_text_field( (string) $args['query'] ) : '';
			return desktop_mode_ai_fetch_wporg_plugins( $q );
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
			return desktop_mode_ai_fetch_error_log( $lines );
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
 * Fetches a batch of posts or pages with AI analysis, returning data
 * rich enough for the agent to compare AND for the UI to render links.
 *
 * @since 0.14.0
 *
 * @param string $post_type 'post' | 'page'.
 * @param int    $offset
 * @return array
 */
function desktop_mode_ai_search_fetch_posts( $post_type, $offset ) {
	$query = new WP_Query(
		array(
			'post_type'              => $post_type,
			'post_status'            => 'publish',
			'posts_per_page'         => DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
			'offset'                 => $offset,
			'no_found_rows'          => false,
			'update_post_term_cache' => false,
			'update_post_meta_cache' => true,
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- AI search batch fetch; targets only the small subset of posts that already have an AI summary stamped, single EXISTS clause against an indexed key.
			'meta_query'             => array(
				array(
					'key'     => DESKTOP_MODE_AI_META_KEY,
					'compare' => 'EXISTS',
				),
			),
		)
	);

	$items = array();
	foreach ( $query->posts as $post ) {
		$meta = desktop_mode_ai_get_meta( 'post', $post->ID );
		if ( ! $meta ) {
			continue;
		}
		$items[] = array(
			// Identity — used to build the final entity detail.
			'id'         => $post->ID,
			'type'       => $post->post_type,
			// Comparison data for the model.
			'title'      => wp_strip_all_tags( $post->post_title ),
			'topic'      => isset( $meta['topic'] ) ? (string) $meta['topic'] : '',
			'ai_summary' => isset( $meta['ai_summary'] ) ? (string) $meta['ai_summary'] : '',
			'date'       => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',
			// Links — passed through so the UI can link to the entity
			// once the agent identifies a match.
			'url'        => (string) get_permalink( $post ),
			'edit_url'   => (string) get_edit_post_link( $post->ID, 'raw' ),
		);
	}

	$total = (int) $query->found_posts;

	return array(
		'tool'       => 'search_' . $post_type . 's',
		'offset'     => $offset,
		'items'      => $items,
		'count'      => count( $items ),
		'total'      => $total,
		'has_more'   => ( $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
	);
}

/**
 * Fetches a batch of approved comments with AI analysis.
 *
 * @since 0.14.0
 *
 * @param int $offset
 * @return array
 */
function desktop_mode_ai_search_fetch_comments( $offset ) {
	$base_args = array(
		'status'     => 'approve',
		'type'       => 'comment',
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- AI search batch fetch for comments; targets only AI-summarised entries via single EXISTS clause.
		'meta_query' => array(
			array(
				'key'     => DESKTOP_MODE_AI_META_KEY,
				'compare' => 'EXISTS',
			),
		),
	);

	$comments = get_comments( array_merge( $base_args, array(
		'number' => DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
		'offset' => $offset,
		'count'  => false,
	) ) );

	$total = (int) get_comments( array_merge( $base_args, array( 'count' => true ) ) );

	$items = array();
	foreach ( $comments as $comment ) {
		$meta = desktop_mode_ai_get_meta( 'comment', $comment->comment_ID );
		if ( ! $meta ) {
			continue;
		}
		$parent_post  = get_post( $comment->comment_post_ID );
		$parent_title = $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '';

		$items[] = array(
			'id'           => (int) $comment->comment_ID,
			'type'         => 'comment',
			// Comparison data.
			'post_title'   => $parent_title,
			'excerpt'      => mb_substr( wp_strip_all_tags( $comment->comment_content ), 0, 250 ),
			'topic'        => isset( $meta['topic'] ) ? (string) $meta['topic'] : '',
			'ai_summary'   => isset( $meta['ai_summary'] ) ? (string) $meta['ai_summary'] : '',
			'harmful'      => isset( $meta['harmful'] ) ? (bool) $meta['harmful'] : false,
			'spam'         => isset( $meta['spam'] ) ? (bool) $meta['spam'] : false,
			// Links.
			'url'          => (string) get_comment_link( $comment ),
			'edit_url'     => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
			'post_id'      => (int) $comment->comment_post_ID,
			'post_url'     => $parent_post ? (string) get_permalink( $parent_post ) : '',
		);
	}

	return array(
		'tool'        => 'search_comments',
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
	);
}

// ---------------------------------------------------------------------------
// Entity detail builder — final REST response
// ---------------------------------------------------------------------------

/**
 * Returns the full entity record used in the `entity` field of the REST
 * response. All URLs are included so the UI can render direct links.
 *
/**
 * Fetches a batch of approved comments on a specific post.
 *
 * Used by the `search_comments_by_post` tool — the model calls this after
 * identifying a post via `search_posts`, giving it a scoped, precise set of
 * comments to compare against the user's description.
 *
 * @since 0.14.0
 *
 * @param int $post_id The WordPress post ID.
 * @param int $offset
 * @return array Tool result payload.
 */
function desktop_mode_ai_search_fetch_comments_by_post( $post_id, $offset ) {
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
		'post_id'    => $post_id,
		'status'     => 'approve',
		'type'       => 'comment',
		// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- comments-by-post AI search; further narrowed by post_id + EXISTS on the AI summary key.
		'meta_query' => array(
			array(
				'key'     => DESKTOP_MODE_AI_META_KEY,
				'compare' => 'EXISTS',
			),
		),
	);

	$comments = get_comments( array_merge( $base_args, array(
		'number' => DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
		'offset' => $offset,
		'count'  => false,
	) ) );

	$total = (int) get_comments( array_merge( $base_args, array( 'count' => true ) ) );

	$parent_post  = get_post( $post_id );
	$parent_title = $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '';

	$items = array();
	foreach ( $comments as $comment ) {
		$meta = desktop_mode_ai_get_meta( 'comment', $comment->comment_ID );
		if ( ! $meta ) {
			continue;
		}
		$items[] = array(
			'id'         => (int) $comment->comment_ID,
			'type'       => 'comment',
			'post_id'    => $post_id,
			'post_title' => $parent_title,
			'excerpt'    => mb_substr( wp_strip_all_tags( $comment->comment_content ), 0, 250 ),
			'topic'      => isset( $meta['topic'] ) ? (string) $meta['topic'] : '',
			'ai_summary' => isset( $meta['ai_summary'] ) ? (string) $meta['ai_summary'] : '',
			'harmful'    => isset( $meta['harmful'] ) ? (bool) $meta['harmful'] : false,
			'spam'       => isset( $meta['spam'] ) ? (bool) $meta['spam'] : false,
			'url'        => (string) get_comment_link( $comment ),
			'edit_url'   => admin_url( 'comment.php?action=editcomment&c=' . (int) $comment->comment_ID ),
		);
	}

	return array(
		'tool'        => 'search_comments_by_post',
		'post_id'     => $post_id,
		'post_title'  => $parent_title,
		'offset'      => $offset,
		'items'       => $items,
		'count'       => count( $items ),
		'total'       => $total,
		'has_more'    => ( $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE ) < $total,
		'next_offset' => $offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE,
	);
}

// ---------------------------------------------------------------------------
// Entity detail builder — final REST response
// ---------------------------------------------------------------------------

/**
 * @since 0.14.0
 *
 * @param string $entity_type 'post' | 'page' | 'comment'.
 * @param int    $entity_id
 * @return array|null
 */
function desktop_mode_ai_search_build_entity( $entity_type, $entity_id ) {
	$entity_id = (int) $entity_id;

	if ( in_array( $entity_type, array( 'post', 'page' ), true ) ) {
		$post = get_post( $entity_id );
		if ( ! $post instanceof WP_Post ) {
			return null;
		}
		$meta = desktop_mode_ai_get_meta( 'post', $entity_id );
		return array(
			'id'         => $entity_id,
			'type'       => $post->post_type,
			'title'      => wp_strip_all_tags( $post->post_title ),
			'status'     => $post->post_status,
			'date'       => $post->post_date ? substr( $post->post_date, 0, 10 ) : '',
			'url'        => (string) get_permalink( $post ),
			'edit_url'   => (string) get_edit_post_link( $entity_id, 'raw' ),
			'topic'      => $meta ? (string) ( $meta['topic'] ?? '' ) : '',
			'ai_summary' => $meta ? (string) ( $meta['ai_summary'] ?? '' ) : '',
		);
	}

	if ( 'comment' === $entity_type ) {
		$comment = get_comment( $entity_id );
		if ( ! $comment instanceof WP_Comment ) {
			return null;
		}
		$meta        = desktop_mode_ai_get_meta( 'comment', $entity_id );
		$parent_post = get_post( $comment->comment_post_ID );
		return array(
			'id'          => $entity_id,
			'type'        => 'comment',
			'excerpt'     => mb_substr( wp_strip_all_tags( $comment->comment_content ), 0, 300 ),
			'post_id'     => (int) $comment->comment_post_ID,
			'post_title'  => $parent_post ? wp_strip_all_tags( $parent_post->post_title ) : '',
			'post_url'    => $parent_post ? (string) get_permalink( $parent_post ) : '',
			'url'         => (string) get_comment_link( $comment ),
			'edit_url'    => admin_url( 'comment.php?action=editcomment&c=' . $entity_id ),
			'topic'       => $meta ? (string) ( $meta['topic'] ?? '' ) : '',
			'ai_summary'  => $meta ? (string) ( $meta['ai_summary'] ?? '' ) : '',
			'harmful'     => $meta ? (bool) ( $meta['harmful'] ?? false ) : false,
			'spam'        => $meta ? (bool) ( $meta['spam'] ?? false ) : false,
		);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Agentic search loop
// ---------------------------------------------------------------------------

/**
 * Runs the agentic content-search loop.
 *
 * The model receives three focused tools — search_posts, search_pages,
 * search_comments — and a system prompt that guides it to choose the right
 * tool based on query semantics. "Someone said congratulations" → it calls
 * search_comments. "I wrote about paella" → it calls search_posts. No
 * entity_type routing from the caller is needed for a fresh search.
 *
 * For continuation runs ($initial_tool + $start_offset > 0), the system
 * message primes the agent to resume from the last searched position.
 *
 * @since 0.14.0
 *
 * @param string      $api_key      OpenAI API key.
 * @param string      $query        User's natural-language search.
 * @param string|null $initial_tool Tool name to resume from, or null for fresh search.
 * @param int         $start_offset Offset to resume from (0 for fresh).
 * @return array|WP_Error
 */
/**
 * Returns a friendly progress message for a tool name — surfaced to the
 * client via SSE so the user sees "Looking through your posts…" rather
 * than the raw tool call.
 *
 * @since 0.14.0
 *
 * @param string $tool_name
 * @return string
 */
function desktop_mode_ai_progress_message( $tool_name ) {
	switch ( $tool_name ) {
		case 'search_posts':            return 'Looking through your posts…';
		case 'search_pages':            return 'Checking your pages…';
		case 'search_comments':         return 'Reading through comments…';
		case 'search_comments_by_post': return 'Scanning comments on that post…';
		case 'list_admin_pages':        return 'Finding the right admin page…';
		case 'search_wporg_plugins':    return 'Searching the WordPress.org plugin directory…';
		case 'get_php_error_log':       return 'Tailing the PHP error log…';
	}
	return 'Thinking…';
}

function desktop_mode_ai_run_search( $api_key, $query, $initial_tool = null, $start_offset = 0, $on_progress = null, array $extra = array() ) {
	/**
	 * Progress emitter — sends a tick to the caller if they provided a
	 * callable; no-op otherwise. Callers use this to render real-time
	 * status to the user via SSE.
	 */
	$emit = static function ( array $event ) use ( $on_progress ) {
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
	$request_id         = isset( $extra['request_id'] ) && is_string( $extra['request_id'] ) && $extra['request_id'] !== ''
		? (string) $extra['request_id']
		: ( function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'desktop_mode_ai_', true ) );
	$command_tools_raw  = isset( $extra['command_tools'] ) && is_array( $extra['command_tools'] ) ? $extra['command_tools'] : array();
	$system_prompt_text = isset( $extra['system_prompt_text'] ) && is_string( $extra['system_prompt_text'] ) ? $extra['system_prompt_text'] : '';
	$system_prompt_mode = isset( $extra['system_prompt_mode'] ) && in_array( $extra['system_prompt_mode'], array( 'append', 'replace' ), true )
		? (string) $extra['system_prompt_mode']
		: 'append';

	/**
	 * Fires once per `/ai/search` invocation, after validation and
	 * before any OpenAI call. First anchor in the observability trio
	 * (`desktop_mode_ai_search_started` / `desktop_mode_ai_tool_called`
	 * / `desktop_mode_ai_search_completed`).
	 *
	 * @since 0.17.0
	 *
	 * @param array $context {
	 *     @type string $query      User query.
	 *     @type int    $user_id
	 *     @type string $request_id UUID correlating the whole run.
	 * }
	 */
	do_action(
		'desktop_mode_ai_search_started',
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	if ( $initial_tool !== null && ! in_array( $initial_tool, $search_tools, true ) ) {
		$initial_tool = null;
	}

	// When resuming a previous exhausted run, prime the model with the
	// starting position so it doesn't waste iterations on already-searched
	// content.
	$continuation_note = '';
	if ( $initial_tool !== null && ( $start_offset > 0 || $initial_tool !== 'search_posts' ) ) {
		$continuation_note = sprintf(
			"\n\nNote: This is a continuation of a previous search. Begin with %s(offset=%d) and work forward.",
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
5. **Chat** — if the request doesn't fit the above, just answer conversationally.

Tone: warm, concise, helpful. First person (\"I found this post…\", \"Here's where you'll find that…\"). Not a search engine tone — no \"Match found\" or robot phrasing.

Tools:
- search_posts / search_pages / search_comments / search_comments_by_post(post_id, offset): content-lookup tools. Compare each item's topic + ai_summary to the user's description. Stop once you find a good match. Use the same tool with next_offset if has_more is true and no match yet. When the query mentions BOTH a post and a comment on that post, call search_posts first to identify the post, THEN search_comments_by_post with the ID.
- list_admin_pages: returns the full catalog of wp-admin destinations. Call once per navigation query, then select the 1-3 most relevant entries.
- search_wporg_plugins(query): searches the official WordPress.org plugin directory. Use when the user asks for a plugin recommendation (\"a plugin for X\", \"is there a plugin that does Y?\"). Returns up to 10 plugins with ratings, install counts, and admin install URLs. Present the best 3-5 as admin_links with titles like \"Plugin Name · 5M+ installs · 4.8★\" (rating is 0-100, divide by 20 to get stars).
- get_php_error_log(lines): reads the tail of the site's PHP error log. Admin-only (the tool itself checks). Use when the user asks \"any errors?\", \"check the logs\", \"what's broken?\", troubleshooting. Each entry has { timestamp, level, message }. Summarise the most important errors (Fatal > Warning > Notice) in your message; don't copy-paste everything.

Choosing which track:
- \"I remember a post/page/comment about X\" → the corresponding search_* tool.
- \"where can I find X?\" / \"how do I manage Y?\" → list_admin_pages.
- \"plugin for X\" / \"recommend a plugin\" → search_wporg_plugins → present as admin_links.
- \"any errors?\" / \"check logs\" / troubleshooting → get_php_error_log → summarise in chat.
- Greeting, unclear, or chit-chat → answer_type \"chat\" with a brief helpful message (no tools needed).

Always return one of three answer_type values in the structured output:
- \"entity\": you identified a single post/page/comment. Fill entity_id + entity_type. admin_links = null.
- \"navigation\": you're recommending admin pages OR plugin install links. Fill admin_links. entity_id + entity_type = null.
- \"chat\": you're answering conversationally — including log summaries, greetings, \"nothing found\" answers. entity_id + entity_type + admin_links all null.

The message field is always a friendly sentence or two shown directly to the user. Make it sound like a person, not a log line.
";

	if ( $continuation_note ) {
		$instructions .= $continuation_note;
	}

	// -----------------------------------------------------------------------
	// System-prompt extensibility. All three layers — appendix filter,
	// client override (append/replace with capability gate), and final
	// transform — live in `desktop_mode_ai_compose_instructions()` so the
	// primary run and the follow-up leg stay in lockstep. See the
	// helper for the order of application; see the filter docblocks
	// below for the public contract on each extension point.
	// -----------------------------------------------------------------------
	$prompt_context = array(
		'query'      => $query,
		'user_id'    => $user_id,
		'request_id' => $request_id,
	);

	/**
	 * Short-circuit extension — appended to the built-in instructions
	 * verbatim. Use this when a plugin just wants to add domain
	 * context (room list, product catalogue, company jargon) without
	 * restructuring the core rules. Fires for both the primary
	 * `/ai/search` run and the follow-up composed-reply leg.
	 *
	 * @since 0.17.0
	 *
	 * @param string $appendix Accumulated appendix. Default empty.
	 * @param array  $context  { query, user_id, request_id, client_override, phase? }.
	 */

	/**
	 * Capability required for a client to send
	 * `system_prompt: { mode: 'replace' }`. Defaults to `manage_options`
	 * — replacing the whole prompt can effectively hijack the
	 * assistant, so it's admin-only out of the box.
	 *
	 * @since 0.17.0
	 *
	 * @param string $capability Default `manage_options`.
	 * @param array  $context
	 */

	/**
	 * Final transform pass. Fires after the built-in instructions,
	 * server appendix, and client override have all been composed.
	 *
	 * @since 0.17.0
	 *
	 * @param string $instructions Composed system prompt.
	 * @param array  $context
	 */
	$instructions = desktop_mode_ai_compose_instructions(
		$instructions,
		$prompt_context,
		array( 'text' => $system_prompt_text, 'mode' => $system_prompt_mode )
	);

	// -----------------------------------------------------------------------
	// Tool assembly — built-in search/navigation + PHP-registered +
	// client-supplied command tools.
	// -----------------------------------------------------------------------
	$builtin_tools = desktop_mode_ai_search_tool_definitions();

	// PHP-registered tools (capability-filtered for the current user).
	$registered_entries = function_exists( 'desktop_mode_get_registered_ai_tools_for_user' )
		? desktop_mode_get_registered_ai_tools_for_user( $user_id )
		: array();

	// Track registered + command tool maps so the agent loop can
	// dispatch without re-walking the registry on every iteration.
	$registered_by_name = array();
	foreach ( $registered_entries as $entry ) {
		$registered_by_name[ (string) $entry['name'] ] = $entry;
	}

	$registered_defs = array_map( 'desktop_mode_ai_tool_entry_to_definition', $registered_entries );

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
		if ( $slug === '' || ! preg_match( '/^[a-z0-9_\-]+$/', $slug ) ) {
			continue;
		}
		/**
		 * Per-tool filter on the client-supplied command list. Return
		 * `false` to drop a command entirely before it reaches the
		 * model — the right hook for per-role / per-command gating.
		 *
		 * @since 0.17.0
		 *
		 * @param bool|array $allowed Either the (possibly mutated) command
		 *                            tool entry, or `false` to drop it.
		 * @param string     $slug    Command slug.
		 * @param array      $context { user_id, request_id }.
		 */
		$allowed = apply_filters(
			'desktop_mode_ai_command_allowed',
			$cmd,
			$slug,
			array( 'user_id' => $user_id, 'request_id' => $request_id )
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
				'type'       => 'object',
				'properties' => array(
					'args' => array(
						'type'        => 'string',
						'description' => $hint !== ''
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
	 * @since 0.17.0
	 *
	 * @param array $command_defs Command tool definitions.
	 * @param array $context      { user_id, request_id }.
	 */
	$command_defs = (array) apply_filters(
		'desktop_mode_ai_command_tools',
		$command_defs,
		array( 'user_id' => $user_id, 'request_id' => $request_id )
	);

	$tools = array_merge( $builtin_tools, $registered_defs, $command_defs );

	/**
	 * Transform the full tool list (built-in + PHP-registered + command)
	 * just before it goes to OpenAI. Fires once per run — changes apply
	 * to every iteration in the agent loop.
	 *
	 * @since 0.17.0
	 *
	 * @param array $tools   Full OpenAI tool definitions array.
	 * @param array $context { user_id, request_id, query }.
	 */
	$tools = (array) apply_filters(
		'desktop_mode_ai_tools',
		$tools,
		array( 'user_id' => $user_id, 'request_id' => $request_id, 'query' => $query )
	);

	// Widen the permitted-tools list to include everything we just
	// assembled — the agent loop rejects any `function_call` whose
	// name isn't in here.
	foreach ( $registered_defs as $def ) {
		if ( isset( $def['name'] ) ) {
			$valid_tools[] = (string) $def['name'];
		}
	}
	foreach ( $command_defs as $def ) {
		if ( isset( $def['name'] ) ) {
			$valid_tools[] = (string) $def['name'];
		}
	}

	$text_format = array(
		'type'   => 'json_schema',
		'name'   => 'search_answer',
		'strict' => true,
		'schema' => desktop_mode_ai_search_answer_schema(),
	);

	$emit( array( 'phase' => 'start', 'message' => 'Thinking about your question…' ) );

	// -----------------------------------------------------------------------
	// First call — user query as input, instructions as system guidance.
	// Dispatched through the active provider (default: OpenAI). State is
	// opaque to the loop — providers stash whatever continuation token
	// they need (OpenAI: previous_response_id; others may use nothing).
	// -----------------------------------------------------------------------
	$turn_input = desktop_mode_ai_provider_make_turn_input( $user_id, 'user_message', $query );
	if ( is_wp_error( $turn_input ) ) {
		return $turn_input;
	}

	$turn = desktop_mode_ai_provider_agentic_call(
		$user_id,
		$api_key,
		$turn_input,
		$tools,
		$text_format,
		$instructions,
		null
	);

	if ( is_wp_error( $turn ) ) {
		return $turn;
	}

	$state         = $turn['next_state'];
	$last_tool     = $initial_tool ?? 'search_posts';
	$last_offset   = $start_offset;
	$last_has_more = true;
	$iterations    = 0;

	// -----------------------------------------------------------------------
	// Agentic loop — each iteration either executes tool calls or returns
	// the final answer. We use `previous_response_id` so OpenAI manages the
	// conversation state; we only send what's new each turn.
	// -----------------------------------------------------------------------
	for ( $i = 0; $i < DESKTOP_MODE_AI_SEARCH_MAX_ITERATIONS; $i++ ) {
		$function_calls = is_array( $turn['function_calls'] ?? null ) ? $turn['function_calls'] : array();

		// No tool calls in this response → final answer.
		if ( empty( $function_calls ) ) {
			$emit( array( 'phase' => 'composing', 'message' => 'Putting together your answer…' ) );
			$text = $turn['text'] ?? null;
			if ( ! is_string( $text ) ) {
				// Log the raw output so mismatches in the provider response
				// shape are visible without having to re-run with a debugger.
				$raw = is_array( $turn['raw'] ?? null ) ? $turn['raw'] : array();
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( '[WP Desktop Mode AI] Unexpected output shape: ' . wp_json_encode( $raw ) );
				return new WP_Error(
					'desktop_mode_ai_empty',
					'AI provider returned no text in the final turn.',
					array( 'raw' => $raw )
				);
			}

			$answer = json_decode( $text, true );
			if ( ! is_array( $answer ) ) {
				return new WP_Error( 'desktop_mode_ai_result_parse', 'Could not parse structured search answer.' );
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
				$entity = desktop_mode_ai_search_build_entity( $entity_type, $entity_id );
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
			 * @since 0.17.0
			 *
			 * @param array $answer  Final answer payload.
			 * @param array $context { query, user_id, request_id }.
			 */
			$final = (array) apply_filters(
				'desktop_mode_ai_answer',
				$final,
				array( 'query' => $query, 'user_id' => $user_id, 'request_id' => $request_id )
			);

			do_action(
				'desktop_mode_ai_search_completed',
				array(
					'query'       => $query,
					'user_id'     => $user_id,
					'request_id'  => $request_id,
					'answer_type' => $final['answer_type'] ?? 'chat',
					'iterations'  => $final['iterations'] ?? 0,
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
		// send anything else back to OpenAI this turn — would burn tokens
		// for a no-op second response.
		// -------------------------------------------------------------------
		$command_tool_call = null;
		foreach ( $function_calls as $fc ) {
			$name = (string) ( $fc['name'] ?? '' );
			if ( isset( $command_tools_by_name[ $name ] ) ) {
				$decoded = is_array( json_decode( $fc['arguments'] ?? '{}', true ) )
					? json_decode( $fc['arguments'], true )
					: array();
				$command_tool_call = array(
					'slug' => $command_tools_by_name[ $name ]['slug'],
					'args' => isset( $decoded['args'] ) ? (string) $decoded['args'] : '',
				);
				break;
			}
		}
		if ( $command_tool_call !== null ) {
			do_action(
				'desktop_mode_ai_tool_called',
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
				'desktop_mode_ai_answer',
				$final,
				array( 'query' => $query, 'user_id' => $user_id, 'request_id' => $request_id )
			);

			do_action(
				'desktop_mode_ai_search_completed',
				array(
					'query'       => $query,
					'user_id'     => $user_id,
					'request_id'  => $request_id,
					'answer_type' => 'tool_call',
					'iterations'  => $final['iterations'] ?? 0,
				)
			);

			return $final;
		}

		// Execute each tool call and collect results in the registry's
		// normalized shape — `{ call_id, output (json string) }`. The
		// provider's `make_turn_input('tool_results', …)` reshapes them
		// for the underlying API.
		$tool_outputs = array();
		foreach ( $function_calls as $fc ) {
			$tool_name = $fc['name'] ?? '';
			$call_id   = $fc['call_id'] ?? '';

			if ( ! in_array( $tool_name, $valid_tools, true ) ) {
				$tool_outputs[] = array(
					'call_id' => $call_id,
					'output'  => wp_json_encode( array( 'error' => "Unknown tool '{$tool_name}'." ) ),
				);
				continue;
			}

			$args   = is_array( json_decode( $fc['arguments'] ?? '{}', true ) )
				? json_decode( $fc['arguments'], true )
				: array();
			$offset = max( 0, (int) ( $args['offset'] ?? 0 ) );

			// Registered PHP-dispatched tool — handler lives in the
			// plugin's `desktop_mode_register_ai_tool()` entry. Capability
			// was already checked at list-assembly time.
			$is_registered = isset( $registered_by_name[ $tool_name ] );

			$progress_msg = $is_registered
				? ( (string) ( $registered_by_name[ $tool_name ]['progress_message'] ?? '' ) ?: 'Working…' )
				: desktop_mode_ai_progress_message( $tool_name );

			$emit( array(
				'phase'   => 'tool_call',
				'tool'    => $tool_name,
				'message' => $progress_msg,
			) );

			do_action(
				'desktop_mode_ai_tool_called',
				array(
					'tool_name'  => $tool_name,
					'args'       => $args,
					'user_id'    => $user_id,
					'request_id' => $request_id,
				)
			);

			if ( $is_registered ) {
				$batch = desktop_mode_ai_invoke_registered_tool(
					$registered_by_name[ $tool_name ],
					$args,
					$user_id
				);
			} else {
				$batch = desktop_mode_ai_search_dispatch_tool( $tool_name, $args );
				$last_tool     = $tool_name;
				$last_offset   = $offset;
				$last_has_more = (bool) ( $batch['has_more'] ?? false );
			}

			/**
			 * Transform a tool result before it goes back to the
			 * model. Fires for every tool, built-in and registered.
			 *
			 * @since 0.17.0
			 *
			 * @param array  $batch     Tool result payload.
			 * @param string $tool_name Tool function name.
			 * @param array  $args      Decoded args from the call.
			 * @param array  $context   { user_id, request_id }.
			 */
			$batch = (array) apply_filters(
				'desktop_mode_ai_tool_result',
				$batch,
				$tool_name,
				$args,
				array( 'user_id' => $user_id, 'request_id' => $request_id )
			);

			$tool_outputs[] = array(
				'call_id' => $call_id,
				'output'  => wp_json_encode( $batch ),
			);
		}

		$iterations++;

		// Next turn — only send the tool results. Providers that support
		// server-side context chaining (OpenAI's previous_response_id)
		// use the opaque $state we threaded through; others can read
		// the tool results and append them to whatever history they keep.
		$turn_input = desktop_mode_ai_provider_make_turn_input( $user_id, 'tool_results', $tool_outputs );
		if ( is_wp_error( $turn_input ) ) {
			return $turn_input;
		}

		$turn = desktop_mode_ai_provider_agentic_call(
			$user_id,
			$api_key,
			$turn_input,
			$tools,
			$text_format,
			'',
			$state
		);

		if ( is_wp_error( $turn ) ) {
			return $turn;
		}

		$state = $turn['next_state'] ?? $state;
	}

	// -----------------------------------------------------------------------
	// Budget exhausted before a final answer.
	// -----------------------------------------------------------------------
	$continue = null;
	if ( $last_has_more ) {
		$next_offset = $last_offset + DESKTOP_MODE_AI_SEARCH_BATCH_SIZE;
		$type_label  = str_replace( 'search_', '', $last_tool ) . 's';
		$continue    = array(
			'tool'        => $last_tool,
			'entity_type' => rtrim( str_replace( 'search_', '', $last_tool ), 's' ),
			'offset'      => $next_offset,
			'label'       => sprintf( 'Continue searching in %s (from item %d)', $type_label, $next_offset + 1 ),
		);
	}

	$final = array(
		'answer_type' => 'chat',
		'message'     => 'I searched 100 items without finding a clear match. Want me to keep looking further?',
		'entity'      => null,
		'admin_links' => null,
		'iterations'  => DESKTOP_MODE_AI_SEARCH_MAX_ITERATIONS,
		'exhausted'   => ! $last_has_more,
		'continue'    => $continue,
		'request_id'  => $request_id,
	);

	$final = (array) apply_filters(
		'desktop_mode_ai_answer',
		$final,
		array( 'query' => $query, 'user_id' => $user_id, 'request_id' => $request_id )
	);

	do_action(
		'desktop_mode_ai_search_completed',
		array(
			'query'       => $query,
			'user_id'     => $user_id,
			'request_id'  => $request_id,
			'answer_type' => 'chat',
			'iterations'  => DESKTOP_MODE_AI_SEARCH_MAX_ITERATIONS,
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
 *   1. `desktop_mode_ai_system_prompt_appendix` — stacking filter;
 *      every plugin's return is concatenated.
 *   2. Client override — `system_prompt_text` + `system_prompt_mode`.
 *      `append` always allowed; `replace` gated on
 *      `desktop_mode_ai_system_prompt_replace_capability`. Non-permitted
 *      `replace` downgrades to `append` so the caller's text is
 *      preserved rather than dropped.
 *   3. `desktop_mode_ai_system_prompt` — final transform pass.
 *
 * @since 0.17.0
 * @internal
 *
 * @param string $core    Built-in instructions for this phase
 *                        (agent loop / follow-up summariser).
 * @param array  $context { query, user_id, request_id, phase? }.
 * @param array  $client  { text, mode } client override; either field
 *                        empty means no override.
 * @return string Composed system prompt.
 */
function desktop_mode_ai_compose_instructions( $core, array $context, array $client = array() ) {
	$instructions = (string) $core;
	$user_id      = isset( $context['user_id'] ) ? (int) $context['user_id'] : 0;

	$client_text = isset( $client['text'] ) && is_string( $client['text'] ) ? $client['text'] : '';
	$client_mode = isset( $client['mode'] ) && in_array( $client['mode'], array( 'append', 'replace' ), true )
		? (string) $client['mode']
		: 'append';

	$ctx_for_filter = $context;
	$ctx_for_filter['client_override'] = '' !== $client_text ? $client_mode : null;

	/** @see desktop_mode_ai_system_prompt_appendix — documented at primary call site. */
	$server_appendix = (string) apply_filters( 'desktop_mode_ai_system_prompt_appendix', '', $ctx_for_filter );
	if ( '' !== $server_appendix ) {
		$instructions .= "\n\n" . $server_appendix;
	}

	if ( '' !== $client_text ) {
		if ( 'replace' === $client_mode ) {
			/** @see desktop_mode_ai_system_prompt_replace_capability — documented at primary call site. */
			$required_cap = (string) apply_filters(
				'desktop_mode_ai_system_prompt_replace_capability',
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

	/** @see desktop_mode_ai_system_prompt — documented at primary call site. */
	return (string) apply_filters( 'desktop_mode_ai_system_prompt', $instructions, $ctx_for_filter );
}

/**
 * Compose a natural-language reply describing the outcome of a
 * client-dispatched command invocation.
 *
 * Called by the REST endpoint when the client sends `follow_up` —
 * the second leg of the opt-in agentic flow triggered by
 * `wp.desktop.ai.ask( q, { tools: 'aiCallable', followUp: true } )`.
 *
 * Single-turn, no tools, no structured-output schema — the model
 * sees the original query + a summary of what happened and writes a
 * one/two-sentence reply in the voice of the system prompt. We reuse
 * the same system-prompt pipeline as the main search so plugins
 * appending instructions via `desktop_mode_ai_system_prompt_appendix`
 * see consistent voice across the two legs.
 *
 * @since 0.17.0
 *
 * @param string $api_key   OpenAI API key.
 * @param string $query     Original user query.
 * @param array  $tool      { slug, args } — what ran.
 * @param array  $outcome   Tool result payload. Opaque — JSON-encoded
 *                          into the model's context so it can reason
 *                          about whatever shape the plugin returned.
 * @param array  $extra     Same shape as `desktop_mode_ai_run_search`'s
 *                          `$extra` — carries user_id, request_id,
 *                          system-prompt overrides.
 * @return array|WP_Error   `{ answer_type: 'chat', message, … }` or error.
 */
function desktop_mode_ai_run_followup( $api_key, $query, array $tool, array $outcome, array $extra = array() ) {
	$user_id    = isset( $extra['user_id'] ) ? (int) $extra['user_id'] : get_current_user_id();
	$request_id = isset( $extra['request_id'] ) && is_string( $extra['request_id'] ) && $extra['request_id'] !== ''
		? (string) $extra['request_id']
		: ( function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'desktop_mode_ai_', true ) );

	do_action(
		'desktop_mode_ai_search_started',
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
	$instructions = "
You are the same friendly WordPress assistant that just dispatched a command on behalf of the user. You now have the result of that command.

Write a SHORT reply (one or two sentences, first person, warm and conversational) describing what happened. Match the voice the site owner set in their system prompt — do not restart small talk, just confirm what you did.

Rules:
- If the outcome looks successful, confirm plainly. Example: \"Done — your office light is on now.\"
- If the outcome looks like an error (has an `error` field, a failure message, or obviously negative content), apologise briefly and paraphrase what went wrong. Do not invent details the outcome did not include.
- Do NOT recommend the user try something else unless the outcome explicitly suggests it.
- Do NOT describe the tool mechanism (\"I called command_turn_light\") — the user only cares about the real-world effect.
";

	$system_prompt_text = isset( $extra['system_prompt_text'] ) && is_string( $extra['system_prompt_text'] ) ? $extra['system_prompt_text'] : '';
	$system_prompt_mode = isset( $extra['system_prompt_mode'] ) && in_array( $extra['system_prompt_mode'], array( 'append', 'replace' ), true )
		? (string) $extra['system_prompt_mode']
		: 'append';

	$instructions = desktop_mode_ai_compose_instructions(
		$instructions,
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'phase'      => 'follow_up',
		),
		array( 'text' => $system_prompt_text, 'mode' => $system_prompt_mode )
	);

	$slug         = isset( $tool['slug'] ) ? (string) $tool['slug'] : '';
	$tool_args    = isset( $tool['args'] ) ? (string) $tool['args'] : '';
	$outcome_json = wp_json_encode( $outcome );
	if ( ! is_string( $outcome_json ) ) {
		$outcome_json = '""';
	}

	// Bound the outcome payload so a malicious or buggy plugin that
	// returns a 5MB blob can't inflate OpenAI token usage without
	// bound. 4 KB is enough for a status string, a small result list,
	// or a short error envelope — anything bigger gets truncated with
	// a marker so the model knows the tail was dropped.
	//
	// `mb_*` variants so truncation on a multibyte boundary
	// (Japanese / emoji / accented UTF-8) can't produce invalid JSON
	// that OpenAI would reject. Falls back to byte-level substr when
	// mbstring is unavailable (rare but possible on minimal PHP
	// builds).
	$max_outcome_len = (int) apply_filters( 'desktop_mode_ai_followup_outcome_max_chars', 4000 );
	if ( $max_outcome_len > 0 ) {
		$has_mbstring = function_exists( 'mb_strlen' ) && function_exists( 'mb_substr' );
		$current_len  = $has_mbstring
			? mb_strlen( $outcome_json, 'UTF-8' )
			: strlen( $outcome_json );
		if ( $current_len > $max_outcome_len ) {
			$outcome_json = $has_mbstring
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
		'desktop_mode_ai_tool_called',
		array(
			'tool_name'  => 'followup_summarise',
			'args'       => array( 'slug' => $slug, 'tool_args' => $tool_args ),
			'user_id'    => $user_id,
			'request_id' => $request_id,
		)
	);

	$turn_input = desktop_mode_ai_provider_make_turn_input( $user_id, 'user_message', $user_message );
	if ( is_wp_error( $turn_input ) ) {
		return $turn_input;
	}

	$turn = desktop_mode_ai_provider_agentic_call(
		$user_id,
		$api_key,
		$turn_input,
		array(),  // no tools — we want a plain reply
		null,     // no JSON schema — free-form text
		$instructions,
		null
	);

	if ( is_wp_error( $turn ) ) {
		do_action(
			'desktop_mode_ai_search_error',
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

	$text     = $turn['text'] ?? null;
	$fallback = false;
	if ( ! is_string( $text ) || '' === trim( $text ) ) {
		// Graceful degrade — if OpenAI returned nothing usable, fall
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
		'tool'        => array( 'slug' => $slug, 'args' => $tool_args ),
		'fallback'    => $fallback,
	);

	$final = (array) apply_filters(
		'desktop_mode_ai_answer',
		$final,
		array(
			'query'      => $query,
			'user_id'    => $user_id,
			'request_id' => $request_id,
			'phase'      => 'follow_up',
		)
	);

	do_action(
		'desktop_mode_ai_search_completed',
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
 *
 * @since 0.14.0
 */
function desktop_mode_register_ai_search_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/ai/search',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_rest_ai_search',
			'permission_callback' => 'desktop_mode_rest_ai_search_permission',
			'args'                => array(
				'query'        => array(
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
				'resume_tool'  => array(
					'required'          => false,
					'type'              => array( 'string', 'null' ),
					'default'           => null,
					'sanitize_callback' => static function ( $v ) {
						return in_array( $v, array( 'search_posts', 'search_pages', 'search_comments' ), true )
							? $v : null;
				},
				),
				'start_offset' => array(
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
				'command_tools' => array(
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
				//   mode: 'append' → concatenated onto the built-in prompt (safe for everyone)
				//   mode: 'replace' → replaces the built-in prompt entirely, gated on
				//                     `desktop_mode_ai_system_prompt_replace_capability`
				//                     (default `manage_options`).
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
				// through OpenAI instead. The client sends this on the
				// second leg of `ask( q, { tools: 'aiCallable', followUp: true } )`.
				'follow_up' => array(
					'required' => false,
					'type'     => array( 'object', 'null' ),
					'default'  => null,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_ai_search_rest_route' );

/**
 * Permission callback.
 *
 * @since 0.14.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_rest_ai_search_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'read' ) ) {
		return new WP_Error(
			'desktop_mode_ai_forbidden',
			'You must be logged in to use the AI search.',
			array( 'status' => 403 )
		);
	}
	if ( ! desktop_mode_ai_is_enabled( get_current_user_id() ) ) {
		return new WP_Error(
			'desktop_mode_ai_disabled',
			'AI features are not enabled. Enable them in OS Settings → AI Settings.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * POST /desktop-mode/v1/ai/search
 *
 * @since 0.14.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function desktop_mode_rest_ai_search( WP_REST_Request $request ) {
	$user_id      = get_current_user_id();
	$api_key      = desktop_mode_ai_get_api_key( $user_id );
	$query        = $request->get_param( 'query' );
	$resume_tool  = $request->get_param( 'resume_tool' );
	$start_offset = $request->get_param( 'start_offset' );

	$command_tools = $request->get_param( 'command_tools' );
	if ( ! is_array( $command_tools ) ) {
		$command_tools = array();
	}

	$extra = array(
		'user_id'            => $user_id,
		'request_id'         => function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : uniqid( 'desktop_mode_ai_', true ),
		'command_tools'      => $command_tools,
		'system_prompt_text' => (string) $request->get_param( 'system_prompt_text' ),
		'system_prompt_mode' => (string) $request->get_param( 'system_prompt_mode' ),
	);

	/**
	 * Last-mile filter on the whole `/ai/search` request bundle.
	 * Plugins get one hook to rewrite query, swap tools, or inject
	 * metadata before the agent loop starts.
	 *
	 * @since 0.17.0
	 *
	 * @param array $extra Extended context (mutable).
	 * @param array $core  Core request params { query, resume_tool, start_offset }.
	 */
	$extra = (array) apply_filters(
		'desktop_mode_ai_request',
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
		$result = desktop_mode_ai_run_followup( $api_key, $query, $tool, $outcome, $extra );
	} else {
		$result = desktop_mode_ai_run_search( $api_key, $query, $resume_tool, $start_offset, null, $extra );
	}

	if ( is_wp_error( $result ) ) {
		$request_id = isset( $extra['request_id'] ) ? (string) $extra['request_id'] : '';
		do_action(
			'desktop_mode_ai_search_error',
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
 * @since 0.14.0
 *
 * @param string $query Search terms.
 * @return array Tool result payload ready for the model.
 */
function desktop_mode_ai_fetch_wporg_plugins( $query ) {
	$query = trim( (string) $query );
	if ( $query === '' ) {
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
	$cache_key = 'desktop_mode_ai_plugins_' . md5( strtolower( $query ) );
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
		if ( $slug === '' ) {
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
 * @since 0.14.0
 *
 * @param int $lines Number of lines to return (clamped 1-500 by caller).
 * @return array
 */
function desktop_mode_ai_fetch_error_log( $lines = 50 ) {
	$candidates = array();
	if ( defined( 'WP_CONTENT_DIR' ) ) {
		$candidates[] = WP_CONTENT_DIR . '/debug.log';
	}
	$ini_log = (string) ini_get( 'error_log' );
	if ( $ini_log !== '' && 'syslog' !== $ini_log ) {
		$candidates[] = $ini_log;
	}

	/**
	 * Filter the list of log-file paths to probe in order. Plugins that
	 * redirect errors somewhere non-standard can add their path here.
	 *
	 * @since 0.14.0
	 *
	 * @param string[] $candidates File paths, in probe order.
	 */
	$candidates = (array) apply_filters( 'desktop_mode_ai_error_log_candidates', $candidates );

	$log_path = '';
	foreach ( $candidates as $path ) {
		if ( is_string( $path ) && is_file( $path ) && is_readable( $path ) ) {
			$log_path = $path;
			break;
		}
	}

	if ( $log_path === '' ) {
		return array(
			'tool'          => 'get_php_error_log',
			'log_available' => false,
			'message'       => 'No readable error log found. Enable WP_DEBUG_LOG in wp-config.php or set php_value error_log.',
			'checked_paths' => array_values( $candidates ),
			'entries'       => array(),
			'count'         => 0,
		);
	}

	$tail = desktop_mode_ai_tail_file( $log_path, $lines );

	$entries = array();
	foreach ( $tail as $line ) {
		$line = trim( $line );
		if ( $line === '' ) {
			continue;
		}
		$entries[] = desktop_mode_ai_parse_log_line( $line );
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
 * @since 0.14.0
 *
 * @param string $line
 * @return array
 */
function desktop_mode_ai_parse_log_line( $line ) {
	// Cap individual messages so a runaway stack trace doesn't balloon
	// the payload sent to OpenAI.
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
 * @since 0.14.0
 *
 * @param string $path Absolute path to the file.
 * @param int    $lines
 * @return string[] Lines in original order (oldest first).
 */
function desktop_mode_ai_tail_file( $path, $lines ) {
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
 * admin-ajax handler for the streaming search endpoint.
 *
 * URL: /wp-admin/admin-ajax.php?action=desktop_mode_ai_search_stream
 *   &nonce=<rest_nonce>
 *   &query=<user question>
 *   &resume_tool=<search_posts|…>   (optional)
 *   &start_offset=<int>             (optional)
 *
 * Emits SSE events:
 *   data: { "event": "progress", "phase": "tool_call", "message": "…" }
 *   data: { "event": "done",     "result": { … } }
 *   data: { "event": "error",    "message": "…" }
 *
 * @since 0.14.0
 */
function desktop_mode_ai_ajax_search_stream() {
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
	if ( ! desktop_mode_ai_is_enabled( $user_id ) ) {
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
	if ( $resume_tool !== null && ! in_array( $resume_tool, array( 'search_posts', 'search_pages', 'search_comments', 'search_comments_by_post' ), true ) ) {
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
	// start showing "Thinking…" without waiting for the first OpenAI call.
	$emit( array( 'event' => 'open' ) );

	$api_key = desktop_mode_ai_get_api_key( $user_id );

	$result = desktop_mode_ai_run_search(
		$api_key,
		$query,
		$resume_tool,
		$start_offset,
		function ( $progress ) use ( $emit ) {
			$emit( array_merge( array( 'event' => 'progress' ), $progress ) );
		}
	);

	if ( is_wp_error( $result ) ) {
		$emit( array(
			'event'   => 'error',
			'message' => $result->get_error_message(),
			'code'    => $result->get_error_code(),
		) );
	} else {
		$emit( array(
			'event'  => 'done',
			'result' => $result,
		) );
	}

	exit;
}
add_action( 'wp_ajax_desktop_mode_ai_search_stream', 'desktop_mode_ai_ajax_search_stream' );
