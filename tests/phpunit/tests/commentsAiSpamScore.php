<?php
/**
 * Regression tests for the comments-window AI spam score.
 *
 * Comment spam scoring is the one AI analysis OpenStation keeps: a
 * comment's stored `spam` / `harmful` verdict folds into the heuristic
 * spam-confidence score via the `openstation_comments_window_spam_score`
 * filter. These guard that contract after the post/term analysis removal.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_CommentsAiSpamScore extends WP_UnitTestCase {

	/**
	 * A `spam = true` verdict pins the score to the high-tone floor (>= 75).
	 *
	 * @covers ::openstation_comments_ai_filter_spam_score
	 */
	public function test_spam_verdict_floors_score_at_75() {
		$comment_id = self::factory()->comment->create();
		openstation_ai_save_meta( 'comment', $comment_id, array( 'spam' => true, 'harmful' => false ) );

		$score = apply_filters(
			'openstation_comments_window_spam_score',
			10,
			get_comment( $comment_id )
		);

		$this->assertGreaterThanOrEqual( 75, $score );
	}

	/**
	 * A `harmful = true` verdict adds 20 to the running score.
	 *
	 * @covers ::openstation_comments_ai_filter_spam_score
	 */
	public function test_harmful_verdict_adds_20() {
		$comment_id = self::factory()->comment->create();
		openstation_ai_save_meta( 'comment', $comment_id, array( 'spam' => false, 'harmful' => true ) );

		$score = apply_filters(
			'openstation_comments_window_spam_score',
			30,
			get_comment( $comment_id )
		);

		$this->assertSame( 50, (int) $score );
	}

	/**
	 * A comment with no analysis meta leaves the heuristic score untouched.
	 *
	 * @covers ::openstation_comments_ai_filter_spam_score
	 */
	public function test_no_meta_leaves_score_unchanged() {
		$comment_id = self::factory()->comment->create();

		$score = apply_filters(
			'openstation_comments_window_spam_score',
			42,
			get_comment( $comment_id )
		);

		$this->assertSame( 42, (int) $score );
	}

	/**
	 * The scheduler is wired to both new comments and edits, so an edit
	 * re-analyzes and the stored verdict stays fresh under moderation.
	 *
	 * Guards against the edit path being dropped (it was previously carried
	 * by the now-removed `openstation_ai_on_comment_change`).
	 *
	 * @covers ::openstation_comments_ai_on_new_comment
	 */
	public function test_scheduler_hooked_on_insert_and_edit() {
		$this->assertSame(
			25,
			has_action( 'wp_insert_comment', 'openstation_comments_ai_on_new_comment' ),
			'New comments should schedule analysis.'
		);
		$this->assertSame(
			25,
			has_action( 'edit_comment', 'openstation_comments_ai_on_new_comment' ),
			'Edited comments should re-schedule analysis.'
		);
	}
}
