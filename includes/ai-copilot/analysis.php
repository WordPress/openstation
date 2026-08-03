<?php
/**
 * OpenStation — AI Copilot analysis: prompts, schemas, meta storage.
 *
 * This module owns:
 *   - The JSON Schema for comment analysis (filterable).
 *   - The prompt builder that converts a comment into a chat message array.
 *   - Meta read/write helpers so the job callback never touches meta keys
 *     directly; the key name lives in one place.
 *
 * Comment analysis is the only auto-analysis the copilot performs (it feeds
 * the comments-window spam score). Posts, pages, and terms are not analyzed.
 *
 * Meta key: `_desktop_mode_ai_analysis` (prefixed underscore → hidden from
 * the Custom Fields UI by default).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Meta key used to store the per-comment AI analysis.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_AI_META_KEY = '_desktop_mode_ai_analysis';

/** Max characters of comment text sent to the provider. */
const OPENSTATION_AI_CONTENT_MAX_CHARS = 3000;

// ---------------------------------------------------------------------------
// JSON Schemas
// ---------------------------------------------------------------------------

/**
 * JSON Schema for comment analysis.
 *
 * Captures a topic label and summary plus the `harmful` and `spam`
 * booleans that drive the comments-window spam score.
 *
 * @return array
 */
function openstation_ai_schema_comment() {
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
	 * @param array $schema The JSON Schema array.
	 */
	return (array) apply_filters( 'openstation_ai_schema_comment', $schema );
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Builds the messages array for a comment.
 *
 * The parent post's title is included so the model can judge `spam`
 * (off-topic detection requires knowing what the post is about).
 *
 * @param WP_Comment $comment
 * @return array Chat messages array.
 */
function openstation_ai_messages_for_comment( WP_Comment $comment ) {
	$text = wp_strip_all_tags( $comment->comment_content );
	$text = mb_substr( preg_replace( '/\s+/', ' ', trim( $text ) ), 0, OPENSTATION_AI_CONTENT_MAX_CHARS );

	$user_text = "Analyze the following WordPress comment.\n\n";
	$user_text .= "Comment:\n{$text}\n\n";

	// Give the model post context so it can evaluate relevance (spam).
	$post_id = (int) $comment->comment_post_ID;
	if ( $post_id > 0 ) {
		$post = get_post( $post_id );
		if ( $post instanceof WP_Post ) {
			$user_text .= 'Post title: ' . wp_strip_all_tags( $post->post_title ) . "\n";
		}
	}

	$user_text .= "\n\nClassification rules:\n";
	$user_text .= "- `harmful = true`: the comment is hostile, insulting, or demeaning — e.g. attacks on the author's competence, aggressive rhetoric, threats, hate speech. Tone matters: an angry rant calling the article \"garbage\" is harmful even without explicit language.\n";
	$user_text .= "- `spam = true`: the comment is promotional or off-topic — e.g. commercial links, ALL CAPS sales copy, \"CLICK HERE\" / \"BOOK NOW\", generic praise unrelated to the post.\n";
	$user_text .= "- These are INDEPENDENT flags. A hostile but on-topic comment is harmful=true, spam=false. A promotional but politely worded comment is spam=true, harmful=false. Both can be true simultaneously.\n";
	$user_text .= "- The `topic` and `ai_summary` fields MUST capture the tone and sentiment so that search queries like \"negative comment\", \"angry reader\", or \"spam\" return the correct results.";

	/**
	 * Filters the user message sent to the provider for comment analysis.
	 *
	 * @param string     $user_text The composed user message.
	 * @param WP_Comment $comment   The comment being analyzed.
	 */
	$user_text = (string) apply_filters( 'openstation_ai_comment_prompt', $user_text, $comment );

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
 * Saves an AI analysis result as comment meta.
 *
 * Comments are the only entity the copilot analyzes. The `$entity_type`
 * parameter is retained for call-site/signature stability but only
 * `'comment'` is supported — any other value is a no-op that returns false.
 *
 * @param string $entity_type Only `'comment'` is supported.
 * @param int    $entity_id   Comment ID.
 * @param array  $analysis    The structured output array from the provider.
 * @return bool
 */
function openstation_ai_save_meta( $entity_type, $entity_id, array $analysis ) {
	$entity_id = (int) $entity_id;
	if ( $entity_id <= 0 || 'comment' !== $entity_type ) {
		return false;
	}

	// Stamp when the analysis was performed so consumers can detect staleness.
	$analysis['analyzed_at'] = time();

	return false !== update_comment_meta( $entity_id, OPENSTATION_AI_META_KEY, $analysis );
}

/**
 * Retrieves a previously saved comment AI analysis, or null if none exists.
 *
 * Only `'comment'` is supported (see {@see openstation_ai_save_meta}); any
 * other `$entity_type` returns null.
 *
 * @param string $entity_type Only `'comment'` is supported.
 * @param int    $entity_id   Comment ID.
 * @return array|null
 */
function openstation_ai_get_meta( $entity_type, $entity_id ) {
	$entity_id = (int) $entity_id;
	if ( $entity_id <= 0 || 'comment' !== $entity_type ) {
		return null;
	}

	$raw = get_comment_meta( $entity_id, OPENSTATION_AI_META_KEY, true );

	return is_array( $raw ) && ! empty( $raw ) ? $raw : null;
}
