<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_drafts_widget_assets() {
	$suffix  = openstation_asset_suffix();
	$version = defined( 'OPENSTATION_VERSION' ) ? OPENSTATION_VERSION : '0';

	$js_path  = OPENSTATION_DIR . 'assets/js/widget-drafts' . $suffix . '.js';
	$css_path = OPENSTATION_DIR . 'assets/js/widget-drafts' . $suffix . '.css';

	wp_register_style(
		'os-drafts-widget',
		OPENSTATION_URL . 'assets/js/widget-drafts' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'os-drafts-widget',
		OPENSTATION_URL . 'assets/js/widget-drafts' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'openstation_register_drafts_widget_assets', 5 );

function openstation_enqueue_drafts_widget_styles() {
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'os-drafts-widget' );
}
add_action( 'admin_enqueue_scripts', 'openstation_enqueue_drafts_widget_styles', 20 );

function openstation_register_drafts_widget() {
	if ( ! function_exists( 'openstation_register_widget' ) ) {
		return false;
	}
	return openstation_register_widget(
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

			'capabilities'   => array( 'edit_posts' ),
		)
	);
}
add_action( 'init', 'openstation_register_drafts_widget', 6 );

function openstation_register_drafts_ai_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/draft-suggestions',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_draft_suggestions',
			'permission_callback' => 'openstation_rest_draft_suggestions_permission',
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
add_action( 'rest_api_init', 'openstation_register_drafts_ai_routes' );

function openstation_rest_draft_suggestions_permission( WP_REST_Request $request ) {
	$post_id = absint( $request['post_id'] );
	if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to edit this post.', 'desktop-mode' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
	if ( ! function_exists( 'openstation_ai_provider_configured' ) || ! openstation_ai_provider_configured() ) {
		return new WP_Error(
			'openstation_ai_unavailable',
			__( 'No AI provider is configured.', 'desktop-mode' ),
			array( 'status' => 503 )
		);
	}
	return true;
}

function openstation_drafts_ai_instructions( WP_Post $post ) {
	$instructions = 'You are a writing assistant for a WordPress author. Given a draft post\'s current title and content, help them finish and file it. Provide: exactly 3 concise, compelling title options (about 70 characters max each); one 1-2 sentence excerpt suitable as the post summary; 3 to 6 lowercase topical tags; 1 to 2 categories (prefer the site\'s existing categories, listed in the message; propose a new concise name only if none fit); and a readiness check.

The readiness check judges structure and completeness only: does the draft have a clear introduction, enough substance, at least one concrete example or detail, and a conclusion? The "missing" array lists only what is absent from the text you were given. Mention a typo, misspelling or cut-off sentence only together with the exact text, quoted from the draft. When the draft has an introduction, a body with a concrete detail and a conclusion, return an empty "missing" array and say in the summary that it looks ready.

Write everything in the same language as the draft. Do not invent facts that are not supported by the content.';

	return (string) apply_filters( 'openstation_drafts_ai_instructions', $instructions, $post );
}

function openstation_drafts_ai_schema( WP_Post $post ) {
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

	return (array) apply_filters( 'openstation_drafts_ai_schema', $schema, $post );
}

function openstation_drafts_ai_prompt_text( WP_Post $post ) {
	$title   = (string) $post->post_title;
	$content = trim( (string) preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $post->post_content ) ) );

	$limit = (int) apply_filters( 'openstation_drafts_ai_content_limit', 4000, $post );

	if ( $limit > 0 && mb_strlen( $content ) > $limit ) {
		$content = mb_substr( $content, 0, $limit ) . '…';
	}

	$text  = 'Current title: ' . ( '' !== $title ? $title : '(none)' ) . "\n\n";
	$text .= "Draft content:\n" . ( '' !== $content ? $content : '(empty)' );

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

function openstation_rest_draft_suggestions( WP_REST_Request $request ) {
	if ( ! function_exists( 'wp_ai_client_prompt' ) ) {
		return new WP_Error(
			'openstation_ai_unavailable',
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

	try {
		$builder = wp_ai_client_prompt( openstation_drafts_ai_prompt_text( $post ) )
			->using_system_instruction( openstation_drafts_ai_instructions( $post ) )
			->as_json_response( openstation_ai_normalize_response_schema( openstation_drafts_ai_schema( $post ) ) );

		$json = openstation_ai_apply_model_config(
			$builder,
			array(
				'user_id'    => get_current_user_id(),
				'source'     => 'widgets/drafts-suggestions',
				'has_schema' => true,
			)
		)->generate_text();
	} catch ( \Throwable $e ) {
		$json = new WP_Error( 'openstation_ai_failed', $e->getMessage() );
	}

	if ( is_wp_error( $json ) ) {
		return openstation_drafts_ai_failure( $json );
	}

	$data = json_decode( (string) $json, true );
	if ( ! is_array( $data ) ) {
		return new WP_Error(
			'openstation_ai_parse',
			__( 'The AI response could not be parsed.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}

	$readiness = isset( $data['readiness'] ) && is_array( $data['readiness'] ) ? $data['readiness'] : array();

	$suggestions = array(
		'titles'     => openstation_drafts_clean_list( isset( $data['titles'] ) ? $data['titles'] : array(), 5 ),
		'excerpt'    => trim( wp_strip_all_tags( (string) ( isset( $data['excerpt'] ) ? $data['excerpt'] : '' ) ) ),
		'tags'       => openstation_drafts_clean_list( isset( $data['tags'] ) ? $data['tags'] : array(), 8 ),
		'categories' => openstation_drafts_clean_list( isset( $data['categories'] ) ? $data['categories'] : array(), 5 ),
		'readiness'  => array(
			'summary' => trim( wp_strip_all_tags( (string) ( isset( $readiness['summary'] ) ? $readiness['summary'] : '' ) ) ),
			'missing' => openstation_drafts_clean_list( isset( $readiness['missing'] ) ? $readiness['missing'] : array(), 5 ),
		),
	);

	$suggestions = (array) apply_filters( 'openstation_drafts_ai_suggestions', $suggestions, $post );

	return new WP_REST_Response( $suggestions, 200 );
}

function openstation_drafts_ai_failure( WP_Error $error ) {
	$code   = (string) $error->get_error_code();
	$data   = $error->get_error_data();
	$detail = (string) $error->get_error_message();

	$provider_status = null;
	if ( in_array( $code, array( 'prompt_client_error', 'prompt_upstream_server_error' ), true )
		&& is_array( $data ) && isset( $data['status'] ) ) {
		$provider_status = (int) $data['status'];
	}

	if ( 'prompt_network_error' === $code || ( null !== $provider_status && $provider_status >= 500 ) ) {
		$reason  = 'unavailable';
		$message = __( 'The AI provider could not be reached. Try again in a moment.', 'desktop-mode' );
	} elseif ( in_array( $provider_status, array( 402, 429 ), true ) ) {
		$reason  = 'quota';
		$message = __( 'The AI provider has no credits left or is rate limiting this site. Check its plan and billing, or try again later.', 'desktop-mode' );
	} elseif ( in_array( $provider_status, array( 401, 403 ), true ) ) {
		$reason  = 'auth';
		$message = __( 'The AI provider rejected this site’s API key. Check the key in Settings → Connectors.', 'desktop-mode' );
	} elseif ( null === $provider_status && preg_match( '/quota|credits?\b|billing|rate limit/i', $detail ) ) {

		$reason  = 'quota';
		$message = __( 'The AI provider has no credits left or is rate limiting this site. Check its plan and billing, or try again later.', 'desktop-mode' );
	} else {
		$reason  = 'other';
		$message = __( 'The AI provider could not produce suggestions.', 'desktop-mode' );
	}

	return new WP_Error(
		'openstation_ai_failed',
		$message,
		array(
			'status'          => 502,
			'reason'          => $reason,
			'provider_status' => $provider_status,
			'detail'          => $detail,
		)
	);
}

function openstation_drafts_clean_list( $list, $max ) {
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

function openstation_register_drafts_apply_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/draft-apply',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_draft_apply',
			'permission_callback' => 'openstation_rest_draft_apply_permission',
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
add_action( 'rest_api_init', 'openstation_register_drafts_apply_route' );

function openstation_rest_draft_apply_permission( WP_REST_Request $request ) {
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

function openstation_rest_draft_apply( WP_REST_Request $request ) {
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
				'openstation_apply_failed',
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

				$new = wp_insert_term( $cat, 'category' );
				if ( ! is_wp_error( $new ) && isset( $new['term_id'] ) ) {
					$cat_ids[]  = (int) $new['term_id'];
					$assigned[] = $cat;
				}
			}

		}
		if ( ! empty( $cat_ids ) ) {

			wp_set_post_categories( $post_id, $cat_ids, true );
			$applied['categories'] = $assigned;
		}
	}

	do_action( 'openstation_drafts_suggestion_applied', $post_id, $applied, $post );

	return new WP_REST_Response( array( 'applied' => $applied ), 200 );
}
