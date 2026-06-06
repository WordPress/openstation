<?php
/**
 * Regression tests for the comments-window AI spam score.
 *
 * Comment spam scoring is the one AI analysis Desktop Mode keeps: a
 * comment's stored `spam` / `harmful` verdict folds into the heuristic
 * spam-confidence score via the `desktop_mode_comments_window_spam_score`
 * filter. These guard that contract after the post/term analysis removal.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_CommentsAiSpamScore extends WP_UnitTestCase {

	/**
	 * A `spam = true` verdict pins the score to the high-tone floor (>= 75).
	 *
	 * @covers ::desktop_mode_comments_ai_filter_spam_score
	 */
	public function test_spam_verdict_floors_score_at_75() {
		$comment_id = self::factory()->comment->create();
		desktop_mode_ai_save_meta( 'comment', $comment_id, array( 'spam' => true, 'harmful' => false ) );

		$score = apply_filters(
			'desktop_mode_comments_window_spam_score',
			10,
			get_comment( $comment_id )
		);

		$this->assertGreaterThanOrEqual( 75, $score );
	}

	/**
	 * A `harmful = true` verdict adds 20 to the running score.
	 *
	 * @covers ::desktop_mode_comments_ai_filter_spam_score
	 */
	public function test_harmful_verdict_adds_20() {
		$comment_id = self::factory()->comment->create();
		desktop_mode_ai_save_meta( 'comment', $comment_id, array( 'spam' => false, 'harmful' => true ) );

		$score = apply_filters(
			'desktop_mode_comments_window_spam_score',
			30,
			get_comment( $comment_id )
		);

		$this->assertSame( 50, (int) $score );
	}

	/**
	 * A comment with no analysis meta leaves the heuristic score untouched.
	 *
	 * @covers ::desktop_mode_comments_ai_filter_spam_score
	 */
	public function test_no_meta_leaves_score_unchanged() {
		$comment_id = self::factory()->comment->create();

		$score = apply_filters(
			'desktop_mode_comments_window_spam_score',
			42,
			get_comment( $comment_id )
		);

		$this->assertSame( 42, (int) $score );
	}
}
