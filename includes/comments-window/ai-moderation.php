<?php
/**
 * Desktop Mode — Native Comments Window: AI moderation.
 *
 * Lives on its own toggle ("Use AI to score new comments", surfaced
 * in OS Settings → Features for users with `manage_options`). Off by
 * default; when on, every new comment posted to the site is queued
 * for AI analysis through the AI Copilot's existing
 * `desktop_mode_ai_analyze_comment` job. The structured verdict
 * (`{ harmful, spam, topic, ai_summary }`) lands in comment meta via
 * `desktop_mode_ai_save_meta()`; the Comments window reads it back
 * through the `desktop_mode_comments_window_spam_score` filter to
 * bump the per-row chip, and surfaces the prose summary in a new
 * REST field so the bundle can render it on hover.
 *
 * The Comments window NEVER runs the AI itself — it routes everything
 * through the AI Copilot pipeline, which routes generation through the
 * WordPress AI Client — so a site's Settings → Connectors config is the
 * single source of truth for provider credentials and selection.
 *
 * SECURITY POSTURE
 * ================
 *
 *   - The option is `manage_options`-gated for read AND write — the
 *     REST permission callback rejects anyone without the cap, and
 *     the OS Settings UI hides the toggle for non-admins.
 *   - The hook on `wp_insert_comment` is a no-op when:
 *       a) the option is off,
 *       b) no admin on the site has AI configured, OR
 *       c) the comment is a pingback / trackback (only `comment_type
 *          === 'comment'` is analyzed).
 *     This makes the toggle safe to enable on sites that don't have
 *     an AI provider — it just stays inert.
 *
 * @package WPDesktopMode
 * @since   0.8.3
 */

defined( 'ABSPATH' ) || exit;

/** Site option storing the on/off state. */
const DESKTOP_MODE_COMMENTS_AI_OPTION = 'desktop_mode_comments_ai_moderation';

/**
 * Returns whether AI moderation for new comments is currently enabled.
 *
 * @since 0.8.3
 *
 * @return bool
 */
function desktop_mode_comments_ai_is_enabled() {
	$raw = get_option( DESKTOP_MODE_COMMENTS_AI_OPTION, false );
	/**
	 * Filter whether AI moderation is enabled for new comments.
	 *
	 * Site-wide; not per-user. Hooks here override the
	 * `desktop_mode_comments_ai_moderation` site option — useful for
	 * gating by environment (staging vs. production) or by feature
	 * flag.
	 *
	 * @since 0.8.3
	 *
	 * @param bool $enabled Current option value.
	 */
	return (bool) apply_filters(
		'desktop_mode_comments_ai_is_enabled',
		(bool) $raw
	);
}

/**
 * On every new or edited comment, queue an AI analysis job — but only when
 * the site has the Comments AI toggle on AND a text-generation provider is
 * configured in Settings → Connectors. Idempotent: the AI job pipeline
 * dedupes on `comment_<id>` while a job is pending, so overlapping fires
 * (e.g. `wp_insert_comment` + a quick `edit_comment`) don't double-spend
 * tokens, while an edit after a prior verdict re-analyzes to keep the
 * spam-confidence meta fresh.
 *
 * This is the sole scheduler for comment analysis: the assistant being
 * enabled no longer triggers analysis on its own (comment scoring is an
 * opt-in Comments-window feature, off by default).
 *
 * @since 0.8.3
 *
 * @param int $comment_id The comment id (from `wp_insert_comment` or `edit_comment`).
 */
function desktop_mode_comments_ai_on_new_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	if ( $comment_id <= 0 || ! desktop_mode_comments_ai_is_enabled() ) {
		return;
	}

	// No usable provider configured in Connectors — stay inert so the toggle
	// is safe to leave on before a provider is set up.
	if ( ! desktop_mode_comments_ai_provider_configured() ) {
		return;
	}

	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}
	if ( '' !== $comment->comment_type && 'comment' !== $comment->comment_type ) {
		return;
	}

	if ( ! function_exists( 'desktop_mode_ai_schedule_job' ) ) {
		return;
	}

	// Comment scoring is a site-wide moderation feature: it is gated ONLY by
	// the "Score new comments with AI" toggle + a configured Connector, never
	// by any user's per-user assistant toggle. The user id below is passed
	// through purely for attribution/observability — the analysis job reads
	// none of it (the provider comes from Connectors), so the commenter's own
	// id (0 for anonymous) is fine.
	$user_id = (int) $comment->user_id;

	desktop_mode_ai_schedule_job(
		'desktop_mode_ai_analyze_comment',
		array( $comment_id, $user_id ),
		'comment_' . $comment_id
	);
}
add_action( 'wp_insert_comment', 'desktop_mode_comments_ai_on_new_comment', 25, 1 );
// Re-analyze on edit so the spam-confidence meta stays fresh under normal
// moderation flows (the verdict filter always trusts the latest analysis).
add_action( 'edit_comment', 'desktop_mode_comments_ai_on_new_comment', 25, 1 );

/**
 * Fold the AI verdict into the per-row spam-confidence score.
 *
 * If a comment has been analyzed and the verdict came back with
 * `spam === true`, push the score firmly into the "high" tone
 * (≥ 70). `harmful === true` adds 20 — harmful but on-topic comments
 * deserve moderation attention even when they don't tip into spam.
 *
 * The `analyzed_at` field is intentionally ignored — we always trust
 * the latest verdict the AI produced, even if it's a few days old.
 * Re-analysis happens automatically on `edit_comment`, so the meta
 * stays fresh under normal moderation flows.
 *
 * @since 0.8.3
 *
 * @param int        $score   Default heuristic score (0–100).
 * @param WP_Comment $comment Comment object.
 * @return int Adjusted score, clamped to 0–100.
 */
function desktop_mode_comments_ai_filter_spam_score( $score, $comment ) {
	if ( ! $comment instanceof WP_Comment ) {
		return $score;
	}
	if ( ! function_exists( 'desktop_mode_ai_get_meta' ) ) {
		return $score;
	}
	$meta = desktop_mode_ai_get_meta( 'comment', (int) $comment->comment_ID );
	if ( ! is_array( $meta ) ) {
		return $score;
	}
	$score = (int) $score;
	if ( ! empty( $meta['spam'] ) ) {
		// Pin to high-tone territory. Heuristics may already have it
		// at 80; we just guarantee a floor.
		$score = max( $score, 75 );
	}
	if ( ! empty( $meta['harmful'] ) ) {
		$score = min( 100, $score + 20 );
	}
	return $score;
}
add_filter(
	'desktop_mode_comments_window_spam_score',
	'desktop_mode_comments_ai_filter_spam_score',
	10,
	2
);

/**
 * REST: GET / POST `desktop-mode/v1/comments/ai-settings`.
 *
 * Read returns `{ enabled: bool, providerConfigured: bool }`.
 * Write accepts `{ enabled: bool }`. Both `manage_options`-gated.
 *
 * `providerConfigured` is a convenience the UI uses to disable the
 * toggle with a "Configure an AI provider first" hint when no admin
 * on the site has wired up an API key. It's a UX cue — the toggle
 * stays writable even when it's `false` so an admin who's about to
 * configure the provider can flip this on first.
 *
 * @since 0.8.3
 */
function desktop_mode_comments_ai_register_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/comments/ai-settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'desktop_mode_comments_ai_rest_get',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'desktop_mode_comments_ai_rest_post',
				'permission_callback' => static function () {
					return current_user_can( 'manage_options' );
				},
				'args'                => array(
					'enabled' => array(
						'required' => true,
						'type'     => 'boolean',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_comments_ai_register_rest_route' );

/**
 * REST GET handler — returns the current state + provider hint.
 *
 * @since 0.8.3
 *
 * @return WP_REST_Response
 */
function desktop_mode_comments_ai_rest_get() {
	return new WP_REST_Response(
		array(
			'enabled'            => desktop_mode_comments_ai_is_enabled(),
			'providerConfigured' => desktop_mode_comments_ai_provider_configured(),
		),
		200
	);
}

/**
 * REST POST handler — updates the toggle.
 *
 * @since 0.8.3
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function desktop_mode_comments_ai_rest_post( WP_REST_Request $request ) {
	$enabled = (bool) $request['enabled'];
	update_option( DESKTOP_MODE_COMMENTS_AI_OPTION, $enabled, false );

	/**
	 * Fires after the Comments AI moderation toggle is changed.
	 *
	 * @since 0.8.3
	 *
	 * @param bool $enabled New state.
	 */
	do_action( 'desktop_mode_comments_ai_toggled', $enabled );

	return new WP_REST_Response(
		array(
			'enabled'            => $enabled,
			'providerConfigured' => desktop_mode_comments_ai_provider_configured(),
		),
		200
	);
}

/**
 * Whether a usable AI text-generation provider is configured in Connectors.
 *
 * Delegates to the AI Copilot's capability check
 * ({@see desktop_mode_ai_provider_configured()}), which inspects the WordPress
 * AI Client's provider registry without making a network request. Returns
 * `false` when the AI Copilot bundle isn't loaded.
 *
 * @since 0.8.3
 *
 * @return bool
 */
function desktop_mode_comments_ai_provider_configured() {
	return function_exists( 'desktop_mode_ai_provider_configured' )
		&& desktop_mode_ai_provider_configured();
}
