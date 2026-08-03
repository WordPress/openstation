<?php
/**
 * OpenStation — Native Comments Window: spam confidence scoring.
 *
 * Returns a 0–100 integer for every comment row exposing how likely
 * the framework thinks the comment is spam. The default heuristics
 * are intentionally cheap (no external API calls):
 *
 *   - +35  Akismet flagged this comment as spam.
 *   - +25  Comment is in the 'spam' status.
 *   - +30  Author's prior spam rate ≥ 50%, or +20 when ≥ 20%
 *          (requires 3+ prior comments).
 *   - +15  Comment contains 4+ links, or +5 for 2–3 links.
 *   - +10  Comment matches the disallowed-keys list.
 *   - +10  Comment is from an unauthenticated author with no
 *          previously-approved comment.
 *
 * The score caps at 100 and floors at 0. Sites can shape this score
 * via the `openstation_comments_window_spam_score` filter — that's
 * where the AI fallback should hook when the site has no Akismet
 * but does have an AI provider configured.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Compute a 0–100 spam confidence score for a comment.
 *
 * @param int|WP_Comment $comment Comment id or object.
 * @return int 0–100. Higher = more spam-like.
 */
function openstation_comments_window_spam_score( $comment ) {
	$comment = get_comment( $comment );
	if ( ! $comment instanceof WP_Comment ) {
		return 0;
	}

	$score = 0;

	// Akismet — if installed, its verdict is the strongest signal we have.
	$akismet_result = (string) get_comment_meta( $comment->comment_ID, 'akismet_result', true );
	if ( 'true' === $akismet_result ) {
		$score += 35;
	}

	// In-spam status — already-decided spam ranks highest.
	if ( 'spam' === wp_get_comment_status( $comment ) ) {
		$score += 25;
	}

	// Author's prior spam rate (only when the author has 3+ comments to base it on).
	$author_email = (string) $comment->comment_author_email;
	if ( '' !== $author_email ) {
		$prior_spam = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'spam',
				'count'        => true,
			)
		);
		$prior_total = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'all',
				'count'        => true,
			)
		);
		if ( $prior_total >= 3 ) {
			$rate = $prior_spam / $prior_total;
			if ( $rate >= 0.5 ) {
				$score += 30;
			} elseif ( $rate >= 0.2 ) {
				$score += 20;
			}
		}
	}

	// Link count — 4+ links is the classic SEO spam signature.
	$link_count = preg_match_all( '#https?://#i', (string) $comment->comment_content );
	if ( $link_count >= 4 ) {
		$score += 15;
	} elseif ( $link_count >= 2 ) {
		$score += 5;
	}

	// Disallowed keys (option 'disallowed_keys', the modern name for
	// what used to be the comment blacklist).
	$disallowed = (string) get_option( 'disallowed_keys', '' );
	if ( '' !== trim( $disallowed ) ) {
		$keys = array_filter( array_map( 'trim', explode( "\n", $disallowed ) ) );
		foreach ( $keys as $key ) {
			if ( '' === $key ) {
				continue;
			}
			if ( false !== stripos( $comment->comment_content, $key )
				|| false !== stripos( $comment->comment_author, $key )
				|| false !== stripos( $comment->comment_author_email, $key )
				|| false !== stripos( $comment->comment_author_url, $key )
			) {
				$score += 10;
				break;
			}
		}
	}

	// Unauthenticated + no prior approved comment.
	if ( 0 === (int) $comment->user_id ) {
		$prior_approved = (int) get_comments(
			array(
				'author_email' => $author_email,
				'status'       => 'approve',
				'count'        => true,
			)
		);
		if ( 0 === $prior_approved ) {
			$score += 10;
		}
	}

	// Clamp into the documented range BEFORE the filter so a runaway
	// custom hook can't push it past 100. The filter is allowed to
	// further clamp DOWN (e.g. force 0 for an allowlisted author).
	$score = max( 0, min( 100, $score ) );

	/**
	 * Filter the computed spam confidence score for a comment.
	 *
	 * Hook here to plug in an AI fallback when Akismet isn't installed
	 * but an AI provider is. The callback should return an integer
	 * clamped to 0–100 — values outside that range are clamped back.
	 *
	 * @param int        $score   Default heuristic score (0–100).
	 * @param WP_Comment $comment Comment object.
	 */
	$score = (int) apply_filters(
		'openstation_comments_window_spam_score',
		$score,
		$comment
	);

	return max( 0, min( 100, $score ) );
}
