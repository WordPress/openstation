<?php
/**
 * Tests for the AI-analysis retirement migrations.
 *
 * Migration 2 cleared the post/term analysis jobs when that analysis was
 * removed; migration 8 cleared the comment analysis job and the toggle
 * option when automatic comment scoring followed. Each migration stays
 * scoped to its own jobs, and the runner stamps the high-water mark.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiAnalysisMigrations extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( OPENSTATION_MIGRATION_OPTION );
	}

	public function tear_down() {
		wp_unschedule_hook( 'desktop_mode_ai_analyze_post' );
		wp_unschedule_hook( 'desktop_mode_ai_analyze_term' );
		wp_unschedule_hook( 'desktop_mode_ai_analyze_comment' );
		delete_option( 'desktop_mode_comments_ai_moderation' );
		parent::tear_down();
	}

	/**
	 * Queued post/term analysis events are cleared by the migration.
	 *
	 * @covers ::openstation_migrate_unschedule_post_term_ai
	 */
	public function test_migration_unschedules_post_and_term_jobs() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_post', array( 1, 1 ) );
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_term', array( 1, 'category', 1 ) );

		$this->assertNotFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 1, 1 ) ) );
		$this->assertNotFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_term', array( 1, 'category', 1 ) ) );

		openstation_migrate_unschedule_post_term_ai();

		$this->assertFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 1, 1 ) ),
			'The post analysis event should be unscheduled.'
		);
		$this->assertFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_term', array( 1, 'category', 1 ) ),
			'The term analysis event should be unscheduled.'
		);
	}

	/**
	 * Migration 2 stays scoped to post/term: the comment hook is
	 * migration 8's to clear, and a migration that reached past its
	 * own job list would be clearing events on someone else's behalf.
	 *
	 * @covers ::openstation_migrate_unschedule_post_term_ai
	 */
	public function test_migration_two_leaves_the_comment_job_alone() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_comment', array( 5, 1 ) );

		openstation_migrate_unschedule_post_term_ai();

		$this->assertNotFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_comment', array( 5, 1 ) ),
			'Migration 2 must not unschedule the comment job.'
		);
	}

	/**
	 * Migration 8 retires comment scoring: a site upgrading with the
	 * toggle on and a job still queued keeps neither.
	 *
	 * @covers ::openstation_migrate_remove_comments_ai
	 */
	public function test_migration_eight_clears_the_comment_job_and_option() {
		update_option( 'desktop_mode_comments_ai_moderation', true, false );
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_comment', array( 5, 1 ) );

		openstation_migrate_remove_comments_ai();

		$this->assertFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_comment', array( 5, 1 ) ),
			'The comment analysis event should be unscheduled.'
		);
		$this->assertFalse(
			get_option( 'desktop_mode_comments_ai_moderation', false ),
			'The retired toggle should leave no option row behind.'
		);
	}

	/**
	 * The runner dispatches migration 2 and stamps the high-water mark.
	 *
	 * @covers ::openstation_maybe_run_migrations
	 */
	public function test_runner_dispatches_and_stamps_v2() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_post', array( 2, 1 ) );

		openstation_maybe_run_migrations();

		$this->assertSame(
			OPENSTATION_MIGRATION_VERSION,
			(int) get_option( OPENSTATION_MIGRATION_OPTION )
		);
		$this->assertFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 2, 1 ) ) );
	}
}
