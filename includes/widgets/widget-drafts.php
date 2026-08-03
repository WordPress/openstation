<?php
/**
 * OpenStation — Drafts Widget.
 *
 * A quick list of the current user's most recently edited draft posts,
 * each a click away from reopening in the editor (the shell's admin-link
 * interceptor turns the row into a native window).
 *
 * Data source: WordPress REST API  /wp/v2/posts?status=draft  (edit
 * context, scoped to the viewer with `author` — without it an editor
 * or admin would see every draft on the site, not their own).
 * Refresh: every 60 seconds while the tab is visible, plus an
 * immediate refresh when a window closes or blurs.
 * Requires: OpenStation 0.18.0+ (open_station_register_widget).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS + CSS assets.
 */
function open_station_register_drafts_widget_assets() {
	$suffix  = open_station_asset_suffix();
	$version = defined( 'OPEN_STATION_VERSION' ) ? OPEN_STATION_VERSION : '0';

	$js_path  = OPEN_STATION_DIR . 'assets/js/widget-drafts' . $suffix . '.js';
	$css_path = OPEN_STATION_DIR . 'assets/js/widget-drafts' . $suffix . '.css';

	wp_register_style(
		'os-drafts-widget',
		OPEN_STATION_URL . 'assets/js/widget-drafts' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-drafts-widget',
		OPEN_STATION_URL . 'assets/js/widget-drafts' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'open_station_register_drafts_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages so there is no flash of
 * unstyled content while the lazy JS bundle loads.
 */
function open_station_enqueue_drafts_widget_styles() {
	if ( function_exists( 'open_station_is_enabled' ) && ! open_station_is_enabled() ) {
		return;
	}
	if ( function_exists( 'open_station_is_chromeless_request' ) && open_station_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-drafts-widget' );
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_drafts_widget_styles', 20 );

/**
 * Register the widget definition.
 *
 * @return true|WP_Error True on success, `WP_Error` when the registry
 *                       rejects the entry (e.g. the viewer lacks
 *                       `edit_posts`), false if the registry is absent.
 */
function open_station_register_drafts_widget() {
	if ( ! function_exists( 'open_station_register_widget' ) ) {
		return false;
	}
	return open_station_register_widget(
		'desktop-mode/drafts',
		array(
			'label'          => __( 'Drafts', 'desktop-mode' ),
			'description'    => __( 'Your unfinished posts — click to reopen in the editor.', 'desktop-mode' ),
			'icon'           => 'dashicons-edit',
			'script'         => 'os-drafts-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 240,
			'min_height'     => 180,
			'default_width'  => 300,
			'default_height' => 320,
			// The REST query behind the widget needs `edit_posts`. Without
			// the gate a subscriber can add it from the picker and only
			// ever sees the error state.
			'capabilities'   => array( 'edit_posts' ),
		)
	);
}
add_action( 'init', 'open_station_register_drafts_widget', 6 );


/**
 * Register the AI writing-suggestions REST route.
 *
 * POST desktop-mode/v1/draft-suggestions { post_id }
 *   → { titles, excerpt, tags, categories, readiness: { summary, missing } }
 *
 * Read-only: it reads the draft and returns AI suggestions; it never writes
 * back to the post. Writing an accepted suggestion is a separate, explicit
 * call to `/draft-apply` below.
 *
 * Gated on the user being able to edit the post AND an AI provider being
 * configured (Settings → Connectors). The capability check runs first so an
 * unauthorized caller can't probe whether the site has AI set up. The 💡
 * button that calls this is hidden unless AI is available, so the provider
 * gate here is defence in depth.
 *
 * @return void
 */
function open_station_register_drafts_ai_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/draft-suggestions',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'open_station_rest_draft_suggestions',
			'permission_callback' => 'open_station_rest_draft_suggestions_permission',
			'args'                => array(
				'post_id' => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'open_station_register_drafts_ai_routes' );

/**
 * Permission gate: the user can edit the target post, and AI is configured.
 *
 * Capability first, provider second — an unauthorized caller gets the same
 * 403 whether or not the site has a provider, so the response can't be used
 * to fingerprint the site's AI setup.
 *
 * @param WP_REST_Request $request Request.
 * @return true|WP_Error
 */
function open_station_rest_draft_suggestions_permission( WP_REST_Request $request ) {
	$post_id = absint( $request['post_id'] );
	if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	if ( ! function_exists( 'open_station_ai_provider_configured' ) || ! open_station_ai_provider_configured() ) {
		return new WP_Error(
			'open_station_ai_unavailable',
			__( 'No AI provider is configured.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}
	return true;
}

/**
 * The system instruction used for draft suggestions.
 *
 * Split out so the prompt is filterable without copying the whole route.
 *
 * @param WP_Post $post The draft being described.
 * @return string
 */
function open_station_drafts_ai_instructions( WP_Post $post ) {
	$instructions = 'You are a writing assistant for a WordPress author. Given a draft post\'s current title and content, help them finish and file it. Provide: exactly 3 concise, compelling title options (about 70 characters max each); one 1-2 sentence excerpt suitable as the post summary; 3 to 6 lowercase topical tags; 1 to 2 categories (strongly prefer the site\'s existing categories listed above — only propose a new concise name if none fit); and a readiness check.

The readiness check MUST be strict and evidence-based. Judge only STRUCTURE and COMPLETENESS: does the draft have a clear introduction, enough substance/depth, at least one concrete example or detail, and a conclusion? The "missing" array lists only what is GENUINELY ABSENT from the text you were given. CRITICAL: never invent, guess, or hallucinate problems. Do NOT claim there are typos, misspellings, or cut-off/incomplete sentences unless you can quote the exact offending text verbatim from the draft — if you are not quoting real text, do not mention it. If the draft already has an intro, body with a concrete detail, and a conclusion and reads as complete, return an EMPTY "missing" array and say it looks ready in the summary.

Write everything in the same language as the draft. Do not invent facts that are not supported by the content.';

	/**
	 * Filters the system instruction sent with a draft-suggestions request.
	 *
	 * @param string  $instructions System instruction text.
	 * @param WP_Post $post         The draft being described.
	 */
	return (string) apply_filters( 'open_station_drafts_ai_instructions', $instructions, $post );
}

/**
 * JSON schema the model must answer in for draft suggestions.
 *
 * @param WP_Post $post The draft being described.
 * @return array
 */
function open_station_drafts_ai_schema( WP_Post $post ) {
	$schema = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'titles', 'excerpt', 'tags', 'categories', 'readiness' ),
		'properties'           => array(
			'titles'     => array(
				'type'        => 'array',
				'items'       => array( 'type' => 'string' ),
				'description' => 'Exactly 3 alternative title suggestions, each about 70 characters or fewer.',
			),
			'excerpt'    => array(
				'type'        => 'string',
				'description' => 'A single 1-2 sentence excerpt/summary for the post.',
			),
			'tags'       => array(
				'type'        => 'array',
				'items'       => array( 'type' => 'string' ),
				'description' => '3 to 6 lowercase topical tags.',
			),
			'categories' => array(
				'type'        => 'array',
				'items'       => array( 'type' => 'string' ),
				'description' => '1 to 2 category names. Strongly prefer the existing site categories listed in the prompt; only propose a new concise name if none fit.',
			),
			'readiness'  => array(
				'type'                 => 'object',
				'additionalProperties' => false,
				'required'             => array( 'summary', 'missing' ),
				'properties'           => array(
					'summary' => array(
						'type'        => 'string',
						'description' => 'One short sentence on how close the draft is to being publishable, including a rough sense of its length/completeness.',
					),
					'missing' => array(
						'type'        => 'array',
						'items'       => array( 'type' => 'string' ),
						'description' => '0 to 4 short, concrete things the draft genuinely still needs, judged only on structure/completeness (e.g. "a conclusion", "a clearer intro", "at least one concrete example", "more depth on X"). Only list what is truly absent from the provided text. Never invent typos or cut-off sentences; any wording problem you cite must be an exact verbatim quote from the draft. Return an empty array when the draft already reads as complete.',
					),
				),
			),
		),
	);

	/**
	 * Filters the JSON schema the model answers draft-suggestion requests in.
	 *
	 * Changing the shape here changes the REST response shape too — the route
	 * only normalizes the keys it knows about.
	 *
	 * @param array   $schema JSON schema.
	 * @param WP_Post $post   The draft being described.
	 */
	return (array) apply_filters( 'open_station_drafts_ai_schema', $schema, $post );
}

/**
 * Build the user-facing prompt body: title, trimmed content, existing terms.
 *
 * @param WP_Post $post The draft being described.
 * @return string
 */
function open_station_drafts_ai_prompt_text( WP_Post $post ) {
	$title   = (string) $post->post_title;
	$content = trim( (string) preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $post->post_content ) ) );

	/**
	 * Filters how many characters of the draft are sent to the model.
	 *
	 * @param int     $limit Character limit.
	 * @param WP_Post $post  The draft being described.
	 */
	$limit = (int) apply_filters( 'open_station_drafts_ai_content_limit', 4000, $post );

	// mb_substr so a long draft isn't cut mid-multibyte-character.
	if ( $limit > 0 && mb_strlen( $content ) > $limit ) {
		$content = mb_substr( $content, 0, $limit ) . '…';
	}

	$text  = 'Current title: ' . ( '' !== $title ? $title : '(none)' ) . "\n\n";
	$text .= "Draft content:\n" . ( '' !== $content ? $content : '(empty)' );

	// Give the model the site's existing categories so it classifies into
	// them rather than inventing a fresh taxonomy.
	$existing_cats = get_terms(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'number'     => 40,
			'fields'     => 'names',
		)
	);
	if ( is_array( $existing_cats ) && ! empty( $existing_cats ) ) {
		$text .= "\n\nExisting categories on this site: " . implode( ', ', $existing_cats ) . '.';
	}

	return $text;
}

/**
 * Generate title / excerpt / tag / category suggestions for a draft.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_rest_draft_suggestions( WP_REST_Request $request ) {
	if ( ! function_exists( 'wp_ai_client_prompt' ) ) {
		return new WP_Error(
			'open_station_ai_unavailable',
			__( 'AI is not available on this site.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}

	$post = get_post( absint( $request['post_id'] ) );
	if ( ! $post instanceof WP_Post ) {
		return new WP_Error(
			'rest_post_invalid',
			__( 'Post not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	// `generate_text()` with a JSON schema — same call shape the comment
	// scorer uses. The SDK can throw as well as return a WP_Error, so both
	// paths land on the same 502.
	try {
		$json = wp_ai_client_prompt( open_station_drafts_ai_prompt_text( $post ) )
			->using_system_instruction( open_station_drafts_ai_instructions( $post ) )
			->as_json_response( open_station_ai_normalize_response_schema( open_station_drafts_ai_schema( $post ) ) )
			->generate_text();
	} catch ( \Throwable $e ) {
		$json = new WP_Error( 'open_station_ai_failed', $e->getMessage() );
	}

	if ( is_wp_error( $json ) ) {
		return new WP_Error(
			'open_station_ai_failed',
			$json->get_error_message(),
			array( 'status' => 502 )
		);
	}

	$data = json_decode( (string) $json, true );
	if ( ! is_array( $data ) ) {
		return new WP_Error(
			'open_station_ai_parse',
			__( 'The AI response could not be parsed.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}

	$readiness = isset( $data['readiness'] ) && is_array( $data['readiness'] ) ? $data['readiness'] : array();

	$suggestions = array(
		'titles'     => open_station_drafts_clean_list( isset( $data['titles'] ) ? $data['titles'] : array(), 5 ),
		'excerpt'    => trim( wp_strip_all_tags( (string) ( isset( $data['excerpt'] ) ? $data['excerpt'] : '' ) ) ),
		'tags'       => open_station_drafts_clean_list( isset( $data['tags'] ) ? $data['tags'] : array(), 8 ),
		'categories' => open_station_drafts_clean_list( isset( $data['categories'] ) ? $data['categories'] : array(), 5 ),
		'readiness'  => array(
			'summary' => trim( wp_strip_all_tags( (string) ( isset( $readiness['summary'] ) ? $readiness['summary'] : '' ) ) ),
			'missing' => open_station_drafts_clean_list( isset( $readiness['missing'] ) ? $readiness['missing'] : array(), 5 ),
		),
	);

	/**
	 * Filters the normalized suggestions before they reach the widget.
	 *
	 * Runs after tag-stripping and truncation, so a listener can drop,
	 * reorder or append entries without re-sanitizing.
	 *
	 * @param array   $suggestions { titles, excerpt, tags, categories, readiness }.
	 * @param WP_Post $post        The draft the suggestions describe.
	 */
	$suggestions = (array) apply_filters( 'open_station_drafts_ai_suggestions', $suggestions, $post );

	return new WP_REST_Response( $suggestions, 200 );
}

/**
 * Trim, tag-strip and cap a list of model-supplied strings.
 *
 * @param mixed $list Raw list from the model.
 * @param int   $max  Maximum entries to keep.
 * @return string[]
 */
function open_station_drafts_clean_list( $list, $max ) {
	$out = array();
	foreach ( (array) $list as $item ) {
		if ( ! is_scalar( $item ) ) {
			continue;
		}
		$item = trim( wp_strip_all_tags( (string) $item ) );
		if ( '' !== $item ) {
			$out[] = $item;
		}
	}
	return array_slice( $out, 0, (int) $max );
}

/**
 * Register the "apply a suggestion to the draft" REST route.
 *
 * POST desktop-mode/v1/draft-apply { post_id, title?, excerpt?, tags?, categories? }
 * writes the chosen suggestion straight onto the draft, so the user can
 * accept a title / excerpt / tag / category from the widget without
 * opening the editor. New categories are only created for users who can
 * manage categories; otherwise unknown categories are skipped. Not
 * AI-gated — this is a plain edit of the user's own draft.
 *
 * @return void
 */
function open_station_register_drafts_apply_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/draft-apply',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'open_station_rest_draft_apply',
			'permission_callback' => 'open_station_rest_draft_apply_permission',
			'args'                => array(
				'post_id'    => array(
					'required'          => true,
					'type'              => 'integer',
					'sanitize_callback' => 'absint',
				),
				'title'      => array( 'type' => 'string' ),
				'excerpt'    => array( 'type' => 'string' ),
				'tags'       => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
				),
				'categories' => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'open_station_register_drafts_apply_route' );

/**
 * Permission gate: the user can edit the target post.
 *
 * @param WP_REST_Request $request Request.
 * @return true|WP_Error
 */
function open_station_rest_draft_apply_permission( WP_REST_Request $request ) {
	$post_id = absint( $request['post_id'] );
	if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	return true;
}

/**
 * Apply a title / excerpt / tag / category suggestion to a draft.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function open_station_rest_draft_apply( WP_REST_Request $request ) {
	$post_id = absint( $request['post_id'] );
	$post    = get_post( $post_id );
	if ( ! $post instanceof WP_Post ) {
		return new WP_Error(
			'rest_post_invalid',
			__( 'Post not found.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	$applied = array();
	$update  = array( 'ID' => $post_id );

	if ( $request->has_param( 'title' ) ) {
		$title = sanitize_text_field( (string) $request['title'] );
		if ( '' !== $title ) {
			$update['post_title'] = $title;
			$applied['title']     = $title;
		}
	}
	if ( $request->has_param( 'excerpt' ) ) {
		$excerpt                = sanitize_textarea_field( (string) $request['excerpt'] );
		$update['post_excerpt'] = $excerpt;
		$applied['excerpt']     = $excerpt;
	}

	if ( count( $update ) > 1 ) {
		$result = wp_update_post( $update, true );
		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				'open_station_apply_failed',
				$result->get_error_message(),
				array( 'status' => 500 )
			);
		}
	}

	$tags = $request['tags'];
	if ( is_array( $tags ) && ! empty( $tags ) ) {
		$clean = array();
		foreach ( $tags as $tag ) {
			$tag = sanitize_text_field( (string) $tag );
			if ( '' !== $tag ) {
				$clean[] = $tag;
			}
		}
		if ( ! empty( $clean ) ) {
			// Append (true) — never clobber existing tags. Creates terms as needed.
			wp_set_post_tags( $post_id, $clean, true );
			$applied['tags'] = $clean;
		}
	}

	$categories = $request['categories'];
	if ( is_array( $categories ) && ! empty( $categories ) ) {
		$cat_ids    = array();
		$assigned   = array();
		$can_create = current_user_can( 'manage_categories' );
		foreach ( $categories as $cat ) {
			$cat = sanitize_text_field( (string) $cat );
			if ( '' === $cat ) {
				continue;
			}
			$term = get_term_by( 'name', $cat, 'category' );
			if ( $term instanceof WP_Term ) {
				$cat_ids[]  = (int) $term->term_id;
				$assigned[] = $cat;
			} elseif ( $can_create ) {
				// Only users who can manage categories may create new ones —
				// mirrors Core, where Authors can assign but not create.
				$new = wp_insert_term( $cat, 'category' );
				if ( ! is_wp_error( $new ) && isset( $new['term_id'] ) ) {
					$cat_ids[]  = (int) $new['term_id'];
					$assigned[] = $cat;
				}
			}
			// Otherwise the category doesn't exist and the user can't create
			// it — skip it silently rather than assigning nothing.
		}
		if ( ! empty( $cat_ids ) ) {
			// Append (true) — keep any categories already on the post.
			wp_set_post_categories( $post_id, $cat_ids, true );
			$applied['categories'] = $assigned;
		}
	}

	/**
	 * Fires after a draft suggestion has been written onto a post.
	 *
	 * `$applied` holds only the fields that actually changed — an empty
	 * array means the request was a no-op (e.g. an unknown category the
	 * user could not create).
	 *
	 * @param int     $post_id Post that was updated.
	 * @param array   $applied Fields written: { title?, excerpt?, tags?, categories? }.
	 * @param WP_Post $post    The post as it was before the update.
	 */
	do_action( 'open_station_drafts_suggestion_applied', $post_id, $applied, $post );

	return new WP_REST_Response( array( 'applied' => $applied ), 200 );
}
