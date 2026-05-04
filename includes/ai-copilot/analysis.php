<?php
/**
 * Desktop Mode — AI Copilot analysis: prompts, schemas, meta storage.
 *
 * This module owns:
 *   - JSON Schema definitions for each entity type (filterable).
 *   - Prompt builders that convert WP entities into chat message arrays.
 *   - Meta read/write helpers so job callbacks never touch meta keys
 *     directly; the key names live in one place.
 *
 * Meta key used for all entity types: `_desktop_mode_ai_analysis` (prefixed
 * underscore → hidden from the Custom Fields UI by default).
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** Meta key used across posts, terms, and comments. */
const DESKTOP_MODE_AI_META_KEY = '_desktop_mode_ai_analysis';

/** Max characters of post content / comment text sent to OpenAI. */
const DESKTOP_MODE_AI_CONTENT_MAX_CHARS = 3000;

// ---------------------------------------------------------------------------
// JSON Schemas
// ---------------------------------------------------------------------------

/**
 * JSON Schema for post/page/term analysis.
 *
 * OpenAI strict mode requires `additionalProperties: false` at every level
 * and all properties listed in `required`.
 *
 * @since 0.14.0
 *
 * @return array
 */
function desktop_mode_ai_schema_content() {
	$schema = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'topic', 'ai_summary' ),
		'properties'           => array(
			'topic'      => array(
				'type'        => 'string',
				'description' => 'A concise topic label (max 10 words) capturing the main subject.',
			),
			'ai_summary' => array(
				'type'        => 'string',
				'description' => 'A 2-3 sentence summary of the content, written in plain language.',
			),
		),
	);

	/**
	 * Filters the JSON Schema used for post/page/term AI analysis.
	 *
	 * Must comply with OpenAI strict JSON Schema rules: every object level
	 * needs `additionalProperties: false` and all property names listed in
	 * `required`. Changing the shape here also requires updating any JS or
	 * PHP code that reads `_desktop_mode_ai_analysis` meta.
	 *
	 * @since 0.14.0
	 *
	 * @param array $schema The JSON Schema array.
	 */
	return (array) apply_filters( 'desktop_mode_ai_schema_content', $schema );
}

/**
 * JSON Schema for comment analysis.
 *
 * Extends the content schema with `harmful` and `spam` booleans.
 *
 * @since 0.14.0
 *
 * @return array
 */
function desktop_mode_ai_schema_comment() {
	$schema = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'topic', 'ai_summary', 'harmful', 'spam' ),
		'properties'           => array(
			'topic'      => array(
				'type'        => 'string',
				'description' => 'A concise topic label (max 10 words) capturing the nature and tone of the comment. Include sentiment cues when relevant — e.g. "hostile criticism of article quality", "enthusiastic praise for travel tips", "spam promotion of hotel deals". This label is used by a search engine to match user queries like "negative comment" or "congratulatory message".',
			),
			'ai_summary' => array(
				'type'        => 'string',
				'description' => 'A 1-2 sentence summary that captures both WHAT the commenter said AND HOW they said it (tone, sentiment, intent). A negative or angry comment should be described as such. Examples: "The commenter aggressively dismisses the article as low quality and insults the author\'s credibility." / "A reader warmly congratulates the author on the new baby." / "A promotional spam comment linking to a hotel deals website with no relevance to the post."',
			),
			'harmful'    => array(
				'type'        => 'boolean',
				'description' => 'True when the comment is hostile, insulting, demeaning, or abusive — regardless of whether it contains explicit language. Set to TRUE for: personal attacks on the author or other commenters ("garbage article", "you clearly have no idea", "embarrassing journalism", "stop writing about X"), aggressive condescension, hate speech, threats, or harassment. Set to FALSE for: polite disagreement, constructive criticism, or promotional spam that is off-topic but not hostile. Note: a comment can be spam=true AND harmful=false (promotional but not hostile), or harmful=true AND spam=false (angry but on-topic).',
			),
			'spam'       => array(
				'type'        => 'boolean',
				'description' => 'True when the comment is promotional, automated, or wholly unrelated to the post content. Clear signals: external links to commercial sites (cheaphotelsnow.biz, etc.), ALL CAPS promotional text, trigger phrases like "CLICK HERE", "BOOK NOW", "AMAZING deals", "LIMITED TIME OFFER", excessive exclamation marks, generic praise unrelated to the post subject. Set to FALSE for comments that are angry, negative, or critical — those belong under `harmful`, not `spam`. A hostile but on-topic comment is NOT spam.',
			),
		),
	);

	/**
	 * Filters the JSON Schema used for comment AI analysis.
	 *
	 * @since 0.14.0
	 *
	 * @param array $schema The JSON Schema array.
	 */
	return (array) apply_filters( 'desktop_mode_ai_schema_comment', $schema );
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Builds the messages array for a post or page.
 *
 * @since 0.14.0
 *
 * @param WP_Post $post
 * @return array Chat messages array.
 */
function desktop_mode_ai_messages_for_post( WP_Post $post ) {
	$type    = ucfirst( $post->post_type );
	$title   = wp_strip_all_tags( $post->post_title );
	$content = wp_strip_all_tags( $post->post_content );
	$content = preg_replace( '/\s+/', ' ', trim( $content ) );
	$content = mb_substr( $content, 0, DESKTOP_MODE_AI_CONTENT_MAX_CHARS );
	$excerpt = wp_strip_all_tags( $post->post_excerpt );

	$user_text  = "Analyze the following WordPress {$type}.\n\n";
	$user_text .= "Title: {$title}\n";
	if ( $excerpt ) {
		$user_text .= "Excerpt: {$excerpt}\n";
	}
	$user_text .= "Content:\n{$content}";

	/**
	 * Filters the user message sent to OpenAI for post/page analysis.
	 *
	 * @since 0.14.0
	 *
	 * @param string  $user_text The composed user message.
	 * @param WP_Post $post      The post being analyzed.
	 */
	$user_text = (string) apply_filters( 'desktop_mode_ai_post_prompt', $user_text, $post );

	return array(
		array(
			'role'    => 'system',
			'content' => 'You are a content analysis assistant for a WordPress site. Analyze the provided content objectively and return structured data exactly matching the required schema.',
		),
		array(
			'role'    => 'user',
			'content' => $user_text,
		),
	);
}

/**
 * Builds the messages array for a taxonomy term (category, tag, etc.).
 *
 * @since 0.14.0
 *
 * @param WP_Term $term
 * @return array Chat messages array.
 */
function desktop_mode_ai_messages_for_term( WP_Term $term ) {
	$taxonomy    = ucwords( str_replace( '_', ' ', $term->taxonomy ) );
	$name        = $term->name;
	$description = wp_strip_all_tags( $term->description );
	$description = mb_substr( preg_replace( '/\s+/', ' ', trim( $description ) ), 0, DESKTOP_MODE_AI_CONTENT_MAX_CHARS );

	$user_text  = "Analyze the following WordPress {$taxonomy} term.\n\n";
	$user_text .= "Name: {$name}\n";
	if ( $description ) {
		$user_text .= "Description: {$description}";
	} else {
		$user_text .= 'No description provided. Base your analysis on the term name alone.';
	}

	/**
	 * Filters the user message sent to OpenAI for term analysis.
	 *
	 * @since 0.14.0
	 *
	 * @param string  $user_text The composed user message.
	 * @param WP_Term $term      The term being analyzed.
	 */
	$user_text = (string) apply_filters( 'desktop_mode_ai_term_prompt', $user_text, $term );

	return array(
		array(
			'role'    => 'system',
			'content' => 'You are a content analysis assistant for a WordPress site. Analyze the provided taxonomy term and return structured data exactly matching the required schema.',
		),
		array(
			'role'    => 'user',
			'content' => $user_text,
		),
	);
}

/**
 * Builds the messages array for a comment.
 *
 * When the parent post has an existing AI analysis, its summary is
 * included so the model can accurately judge `spam` (off-topic detection
 * requires knowing what the post is about).
 *
 * @since 0.14.0
 *
 * @param WP_Comment $comment
 * @return array Chat messages array.
 */
function desktop_mode_ai_messages_for_comment( WP_Comment $comment ) {
	$text = wp_strip_all_tags( $comment->comment_content );
	$text = mb_substr( preg_replace( '/\s+/', ' ', trim( $text ) ), 0, DESKTOP_MODE_AI_CONTENT_MAX_CHARS );

	$user_text = "Analyze the following WordPress comment.\n\n";
	$user_text .= "Comment:\n{$text}\n\n";

	// Give the model post context so it can evaluate relevance (spam).
	$post_id = (int) $comment->comment_post_ID;
	if ( $post_id > 0 ) {
		$post = get_post( $post_id );
		if ( $post instanceof WP_Post ) {
			$user_text .= 'Post title: ' . wp_strip_all_tags( $post->post_title ) . "\n";
		}

		$post_analysis = desktop_mode_ai_get_meta( 'post', $post_id );
		if ( $post_analysis && ! empty( $post_analysis['ai_summary'] ) ) {
			$user_text .= 'Post summary: ' . $post_analysis['ai_summary'] . "\n";
		}
	}

	$user_text .= "\n\nClassification rules:\n";
	$user_text .= "- `harmful = true`: the comment is hostile, insulting, or demeaning — e.g. attacks on the author's competence, aggressive rhetoric, threats, hate speech. Tone matters: an angry rant calling the article \"garbage\" is harmful even without explicit language.\n";
	$user_text .= "- `spam = true`: the comment is promotional or off-topic — e.g. commercial links, ALL CAPS sales copy, \"CLICK HERE\" / \"BOOK NOW\", generic praise unrelated to the post.\n";
	$user_text .= "- These are INDEPENDENT flags. A hostile but on-topic comment is harmful=true, spam=false. A promotional but politely worded comment is spam=true, harmful=false. Both can be true simultaneously.\n";
	$user_text .= "- The `topic` and `ai_summary` fields MUST capture the tone and sentiment so that search queries like \"negative comment\", \"angry reader\", or \"spam\" return the correct results.";

	/**
	 * Filters the user message sent to OpenAI for comment analysis.
	 *
	 * @since 0.14.0
	 *
	 * @param string     $user_text The composed user message.
	 * @param WP_Comment $comment   The comment being analyzed.
	 */
	$user_text = (string) apply_filters( 'desktop_mode_ai_comment_prompt', $user_text, $comment );

	return array(
		array(
			'role'    => 'system',
			'content' => 'You are a content moderation assistant for a WordPress site. Your analysis is used by a semantic search engine, so the topic label and summary must reflect the comment\'s TONE and SENTIMENT — not just its subject matter. An angry, insulting comment must be described as angry and insulting. A promotional spam comment must be described as promotional spam. A warm congratulatory message must be described as warm and positive. Accurate tone labelling is critical for search to work.',
		),
		array(
			'role'    => 'user',
			'content' => $user_text,
		),
	);
}

// ---------------------------------------------------------------------------
// Meta read / write
// ---------------------------------------------------------------------------

/**
 * Saves an AI analysis result as meta for the given entity.
 *
 * @since 0.14.0
 *
 * @param string $entity_type 'post' | 'term' | 'comment'.
 * @param int    $entity_id
 * @param array  $analysis    The structured output array from OpenAI.
 * @return bool
 */
function desktop_mode_ai_save_meta( $entity_type, $entity_id, array $analysis ) {
	$entity_id = (int) $entity_id;
	if ( $entity_id <= 0 ) {
		return false;
	}

	// Stamp when the analysis was performed so consumers can detect staleness.
	$analysis['analyzed_at'] = time();

	switch ( $entity_type ) {
		case 'post':
			return false !== update_post_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, $analysis );

		case 'term':
			return false !== update_term_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, $analysis );

		case 'comment':
			return false !== update_comment_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, $analysis );
	}

	return false;
}

/**
 * Retrieves a previously saved AI analysis, or null if none exists.
 *
 * @since 0.14.0
 *
 * @param string $entity_type 'post' | 'term' | 'comment'.
 * @param int    $entity_id
 * @return array|null
 */
function desktop_mode_ai_get_meta( $entity_type, $entity_id ) {
	$entity_id = (int) $entity_id;
	if ( $entity_id <= 0 ) {
		return null;
	}

	$raw = null;
	switch ( $entity_type ) {
		case 'post':
			$raw = get_post_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, true );
			break;
		case 'term':
			$raw = get_term_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, true );
			break;
		case 'comment':
			$raw = get_comment_meta( $entity_id, DESKTOP_MODE_AI_META_KEY, true );
			break;
	}

	return is_array( $raw ) && ! empty( $raw ) ? $raw : null;
}
