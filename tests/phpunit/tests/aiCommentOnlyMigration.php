<?php
/**
 * Tests for migration v2 — unscheduling leftover post/term AI analysis jobs.
 *
 * Post and taxonomy-term analysis was removed in 0.11.0. The migration
 * clears any `desktop_mode_ai_analyze_post` / `desktop_mode_ai_analyze_term`
 * cron events that prior versions may have queued.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiCommentOnlyMigration extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( DESKTOP_MODE_MIGRATION_OPTION );
	}

	public function tear_down() {
		wp_unschedule_hook( 'desktop_mode_ai_analyze_post' );
		wp_unschedule_hook( 'desktop_mode_ai_analyze_term' );
		parent::tear_down();
	}

	/**
	 * Queued post/term analysis events are cleared by the migration.
	 *
	 * @covers ::desktop_mode_migrate_unschedule_post_term_ai
	 */
	public function test_migration_unschedules_post_and_term_jobs() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_post', array( 1, 1 ) );
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_term', array( 1, 'category', 1 ) );

		$this->assertNotFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 1, 1 ) ) );
		$this->assertNotFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_term', array( 1, 'category', 1 ) ) );

		desktop_mode_migrate_unschedule_post_term_ai();

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
	 * The comment analysis event is NOT touched — it is the surviving job.
	 *
	 * @covers ::desktop_mode_migrate_unschedule_post_term_ai
	 */
	public function test_migration_leaves_comment_job_alone() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_comment', array( 5, 1 ) );

		desktop_mode_migrate_unschedule_post_term_ai();

		$this->assertNotFalse(
			wp_next_scheduled( 'desktop_mode_ai_analyze_comment', array( 5, 1 ) ),
			'Comment analysis (the surviving job) must not be unscheduled.'
		);

		wp_unschedule_hook( 'desktop_mode_ai_analyze_comment' );
	}

	/**
	 * The runner dispatches migration 2 and stamps the high-water mark.
	 *
	 * @covers ::desktop_mode_maybe_run_migrations
	 */
	public function test_runner_dispatches_and_stamps_v2() {
		wp_schedule_single_event( time() + 100, 'desktop_mode_ai_analyze_post', array( 2, 1 ) );

		desktop_mode_maybe_run_migrations();

		$this->assertSame(
			DESKTOP_MODE_MIGRATION_VERSION,
			(int) get_option( DESKTOP_MODE_MIGRATION_OPTION )
		);
		$this->assertFalse( wp_next_scheduled( 'desktop_mode_ai_analyze_post', array( 2, 1 ) ) );
	}
}
