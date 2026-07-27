<?php
/**
 * Desktop Mode — AI Copilot abilities.
 *
 * The Copilot's tools are WordPress Abilities API abilities: the agent loop
 * offers the model every registered read-only ability (see
 * {@see desktop_mode_ai_search_ability_names()}) and runs a chosen one through
 * `wp_get_ability()->execute()` — permission checks and input validation
 * happen inside `WP_Ability::execute()`.
 *
 * Every ability's `execute_callback` delegates to the existing query handlers
 * (via {@see desktop_mode_ai_search_dispatch_tool()} / the comment scorer) so
 * there is a single implementation of each tool. The ability is the source of
 * truth for the model-facing description + input schema.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Ability category slug shared by every Copilot ability.
 */
const DESKTOP_MODE_AI_ABILITY_CATEGORY = 'desktop-mode';

/**
 * Registers the `desktop-mode` ability category.
 *
 * @return void
 */
function desktop_mode_ai_register_ability_category() {
	if ( ! function_exists( 'wp_register_ability_category' ) ) {
		return;
	}

	wp_register_ability_category(
		DESKTOP_MODE_AI_ABILITY_CATEGORY,
		array(
			'label'       => __( 'Desktop Mode', 'desktop-mode' ),
			'description' => __( 'Read-only content search and wp-admin navigation abilities powering the Desktop Mode AI assistant.', 'desktop-mode' ),
		)
	);
}
add_action( 'wp_abilities_api_categories_init', 'desktop_mode_ai_register_ability_category' );

/**
 * The ability names the Copilot offers the model as tools.
 *
 * Every registered ability marked read-only (`meta.annotations.readonly`) is
 * offered — the Copilot's own search/navigation abilities, plus any read-only
 * ability registered by Core or another plugin. No opt-in: register a
 * read-only ability and the assistant can use it; its `permission_callback`
 * still gates execution.
 *
 * Only read-only abilities are advertised on purpose: a search turn can be
 * driven by attacker-controlled content (comment / post text that lands in a
 * tool result), so the model is never handed an ability that could change the
 * site.
 *
 * @return string[] Fully-namespaced ability names.
 */
function desktop_mode_ai_search_ability_names() {
	if ( ! function_exists( 'wp_get_abilities' ) ) {
		return array();
	}

	$names = array();
	foreach ( wp_get_abilities() as $ability ) {
		if ( ! $ability instanceof WP_Ability ) {
			continue;
		}
		$meta        = (array) $ability->get_meta();
		$annotations = isset( $meta['annotations'] ) && is_array( $meta['annotations'] ) ? $meta['annotations'] : array();
		if ( empty( $annotations['readonly'] ) ) {
			continue;
		}
		$names[] = (string) $ability->get_name();
	}

	return $names;
}

/**
 * The model-facing tool name for an ability — the ability name with its
 * namespace stripped and dashes turned into underscores. By design this
 * reproduces the Copilot's historical tool names (`desktop-mode/search-posts`
 * → `search_posts`), so progress labels, the system prompt, and the answer
 * schema keep referring to the same names across the abilities migration.
 *
 * @param string $ability_name Fully-namespaced ability name.
 * @return string
 */
function desktop_mode_ai_ability_tool_name( $ability_name ) {
	$slug = (string) $ability_name;
	$pos  = strpos( $slug, '/' );
	if ( false !== $pos ) {
		$slug = substr( $slug, $pos + 1 );
	}
	// This becomes the model-facing function name; most function-calling
	// providers only accept [a-z0-9_], so normalize anything else (a
	// third-party ability may carry extra slashes or mixed case).
	$slug = strtolower( str_replace( '-', '_', $slug ) );
	$slug = preg_replace( '/[^a-z0-9_]+/', '_', $slug );
	return trim( (string) $slug, '_' );
}

/**
 * Permission callback: any logged-in user who can read the site.
 *
 * Mirrors the read-only search/navigation tools, which were ungated beyond the
 * Copilot's own logged-in requirement.
 *
 * @return bool
 */
function desktop_mode_ai_ability_can_read() {
	return is_user_logged_in() && current_user_can( 'read' );
}

/**
 * A loose object output schema: typed at the top level, permissive on the rest
 * so `WP_Ability::execute()`'s output validation never rejects a valid handler
 * return (the shapes carry optional/nested fields we don't want to freeze).
 *
 * @param array<string,array<string,mixed>> $properties Documented top-level props.
 * @return array<string,mixed>
 */
function desktop_mode_ai_ability_output_schema( array $properties = array() ) {
	return array(
		'type'                 => 'object',
		'additionalProperties' => true,
		// Keep as a plain (associative) array: WordPress's schema validator
		// array-accesses `properties`, and every caller passes at least one
		// property so JSON serialization is still an object. An empty-object
		// `properties` would need a `(object)` cast, but we never emit one.
		'properties'           => $properties,
	);
}

/**
 * Registers every Copilot ability.
 *
 * @return void
 */
function desktop_mode_ai_register_abilities() {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	$query_offset_input = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'query', 'offset' ),
		'properties'           => array(
			'query'  => array(
				'type'        => 'string',
				'description' => 'Keyword search terms matched against the title and content (WordPress native search). Distil the user\'s request to the essential nouns — e.g. for "that post I wrote about making paella" pass "paella". Avoid stop-words and full sentences.',
			),
			'offset' => array(
				'type'        => 'integer',
				'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
			),
		),
	);

	$search_output = desktop_mode_ai_ability_output_schema(
		array(
			'items'    => array( 'type' => 'array', 'description' => 'Matching entities with identity, excerpt, and URLs.' ),
			'count'    => array( 'type' => 'integer', 'description' => 'Number of items in this batch.' ),
			'total'    => array( 'type' => 'integer', 'description' => 'Total matches across all batches.' ),
			'has_more' => array( 'type' => 'boolean', 'description' => 'Whether another batch is available at the next offset.' ),
		)
	);

	$readonly_meta = array(
		'annotations'  => array( 'readonly' => true, 'idempotent' => true ),
		'show_in_rest' => true,
		'mcp'          => array( 'public' => true, 'type' => 'tool' ),
	);

	// Admin-only abilities are still read-only, but must not be exposed to
	// external agents over MCP.
	$readonly_private_meta = array(
		'annotations'  => array( 'readonly' => true, 'idempotent' => true ),
		'show_in_rest' => true,
	);

	wp_register_ability(
		'desktop-mode/search-posts',
		array(
			'label'               => __( 'Search posts', 'desktop-mode' ),
			'description'         => 'Keyword-searches published WordPress blog posts by title and content (WordPress native search). Use this when the user is looking for content they or someone else wrote as a post or article. Pass the key search terms as `query`. Returns up to 10 matching posts with their title, a content excerpt, date, and URLs. If has_more is true, call again with the next offset.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => $query_offset_input,
			'output_schema'       => $search_output,
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'search_posts', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/search-pages',
		array(
			'label'               => __( 'Search pages', 'desktop-mode' ),
			'description'         => 'Keyword-searches published WordPress pages (About, Contact, Services, Portfolio, etc.) by title and content. Use this when the user is looking for a static page, landing page, or informational page on the site. Pass the key search terms as `query`. Returns up to 10 matching pages with their title, a content excerpt, and URLs. If has_more is true, call again with the next offset.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => $query_offset_input,
			'output_schema'       => $search_output,
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'search_pages', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/search-comments',
		array(
			'label'               => __( 'Search comments', 'desktop-mode' ),
			'description'         => 'Keyword-searches approved WordPress comments across ALL posts by their text (WordPress native search). Use this when the user remembers something a reader said but does not know which post it was on. Pass the distinctive words from the comment as `query`. Returns up to 10 matching comments with an excerpt, parent post title, and URLs. If has_more is true, call again with the next offset.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => $query_offset_input,
			'output_schema'       => $search_output,
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'search_comments', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/search-comments-by-post',
		array(
			'label'               => __( 'Search comments on a post', 'desktop-mode' ),
			'description'         => 'Keyword-searches approved comments on a SPECIFIC post by its WordPress ID. Use this when you have already identified a post (via search-posts) and the user\'s query also mentions something a reader said on that post — e.g. "I remember a comment on my Málaga post asking about the Alcazaba at night." Call search-posts first to find the post ID, then call this tool with that ID and the distinctive words as `query`. Much more precise than search-comments when the parent post is known. If has_more is true, call again with the next offset.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'post_id', 'query', 'offset' ),
				'properties'           => array(
					'post_id' => array(
						'type'        => 'integer',
						'description' => 'The WordPress ID of the post whose comments should be searched. Obtain this from a prior search-posts call.',
					),
					'query'   => array(
						'type'        => 'string',
						'description' => 'Keyword search terms matched against the comment text. Pass the distinctive words the user remembers; use an empty string to list the post\'s comments without keyword filtering.',
					),
					'offset'  => array(
						'type'        => 'integer',
						'description' => 'Zero-based starting position. Use 0 for the first batch, 10 for the second, and so on.',
					),
				),
			),
			'output_schema'       => $search_output,
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'search_comments_by_post', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/list-admin-pages',
		array(
			'label'               => __( 'List admin pages', 'desktop-mode' ),
			'description'         => 'Returns the full catalog of WordPress admin (wp-admin) destinations — pages for managing posts, categories, users, plugins, themes, settings, etc. Call this when the user asks "where can I find X?", "how do I get to Y?", "where are the settings for Z?" — any navigational question about the admin UI. Once you have the catalog, select the 1-3 most relevant entries for the user\'s query and include them in your answer under admin_links with answer_type="navigation". The catalog is small and stable so one call is enough.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array(),
				'properties'           => (object) array(),
			),
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array( 'pages' => array( 'type' => 'array', 'description' => 'Admin destinations with title/url/icon/description.' ) )
			),
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'list_admin_pages', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/search-wporg-plugins',
		array(
			'label'               => __( 'Search WordPress.org plugins', 'desktop-mode' ),
			'description'         => 'Searches the official WordPress.org plugin directory. Use this when the user asks for a plugin recommendation — e.g. "is there a plugin for SEO?", "find me a backup plugin", "a caching plugin", "form builder". Returns up to 10 plugins with name, description, rating, active install count, and an admin URL that opens the plugin-info / install screen directly. Present the results as admin_links with answer_type="navigation", titled "Plugin Name · 5M+ installs · 4.8★".',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
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
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'results' => array( 'type' => 'array', 'description' => 'Matching plugins with name, description, rating, installs, and admin URL.' ),
					'count'   => array( 'type' => 'integer' ),
				)
			),
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'search_wporg_plugins', (array) $input );
			},
			'permission_callback' => 'desktop_mode_ai_ability_can_read',
			'meta'                => $readonly_meta,
		)
	);

	wp_register_ability(
		'desktop-mode/get-php-error-log',
		array(
			'label'               => __( 'Read PHP error log', 'desktop-mode' ),
			'description'         => 'Reads the most recent entries from the site\'s PHP error log — typically wp-content/debug.log when WP_DEBUG_LOG is enabled, or the path set by the PHP error_log directive. Use this when the user asks "are there any errors?", "check the logs", "what went wrong?", or is troubleshooting a white screen / 500. Each entry is parsed into { timestamp, level, message } so you can summarise them. Administrators only.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
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
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'log_available' => array( 'type' => 'boolean' ),
					'entries'       => array( 'type' => 'array', 'description' => 'Parsed log lines: { timestamp, level, message }.' ),
				)
			),
			'execute_callback'    => static function ( $input ) {
				return desktop_mode_ai_search_dispatch_tool( 'get_php_error_log', (array) $input );
			},
			// Admin-only — mirrors the previous in-dispatcher manage_options gate.
			'permission_callback' => static function () {
				return current_user_can( 'manage_options' );
			},
			'meta'                => $readonly_private_meta,
		)
	);

	desktop_mode_ai_register_comment_analysis_ability();
}
add_action( 'wp_abilities_api_init', 'desktop_mode_ai_register_abilities' );

/**
 * Registers the comment-spam analysis ability.
 *
 * Not offered to the model during a search turn (see
 * {@see desktop_mode_ai_search_ability_names()}); the moderation pipeline
 * resolves and executes it directly ({@see desktop_mode_ai_analyze_comment_now()}
 * runs through it). Exposed in the abilities catalog for observability + reuse.
 *
 * @return void
 */
function desktop_mode_ai_register_comment_analysis_ability() {
	wp_register_ability(
		'desktop-mode/analyze-comment',
		array(
			'label'               => __( 'Analyze comment for spam', 'desktop-mode' ),
			'description'         => 'Runs the AI spam/harm analysis for a single comment and returns its structured verdict ({ topic, ai_summary, harmful, spam }). Used by comment moderation to score incoming comments.',
			'category'            => DESKTOP_MODE_AI_ABILITY_CATEGORY,
			'input_schema'        => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'comment_id' ),
				'properties'           => array(
					'comment_id' => array(
						'type'        => 'integer',
						'description' => 'The WordPress ID of the comment to analyze.',
					),
				),
			),
			'output_schema'       => desktop_mode_ai_ability_output_schema(
				array(
					'topic'      => array( 'type' => 'string' ),
					'ai_summary' => array( 'type' => 'string' ),
					'harmful'    => array( 'type' => 'boolean' ),
					'spam'       => array( 'type' => 'boolean' ),
				)
			),
			'execute_callback'    => 'desktop_mode_ai_ability_analyze_comment',
			'permission_callback' => static function () {
				return current_user_can( 'moderate_comments' );
			},
			'meta'                => array(
				'annotations'  => array( 'readonly' => true, 'idempotent' => true ),
				'show_in_rest' => true,
			),
		)
	);
}

/**
 * Execute callback for the `desktop-mode/analyze-comment` ability.
 *
 * @param array<string,mixed> $input Validated input (`comment_id`).
 * @return array|WP_Error Structured verdict, or an error.
 */
function desktop_mode_ai_ability_analyze_comment( $input ) {
	$comment_id = isset( $input['comment_id'] ) ? (int) $input['comment_id'] : 0;
	$comment    = $comment_id > 0 ? get_comment( $comment_id ) : null;
	if ( ! $comment instanceof WP_Comment ) {
		return new WP_Error( 'desktop_mode_ai_comment_not_found', __( 'Comment not found.', 'desktop-mode' ) );
	}

	return desktop_mode_ai_analyze_comment_now( $comment, (int) $comment->user_id );
}
