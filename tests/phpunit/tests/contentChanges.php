<?php
/**
 * Tests for the generic content-change realtime layer
 * (includes/content-changes.php): recorder dedupe + gates, post /
 * comment hook wiring, the redirect-surviving buffer, the chromeless
 * footer emitter, and the Heartbeat catch-all.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 */
class Tests_OpenStation_ContentChanges extends WP_UnitTestCase {

	protected static $admin_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id = $factory->user->create( array( 'role' => 'administrator' ) );
	}

	public function set_up() {
		parent::set_up();
		wp_set_current_user( self::$admin_id );
		openstation_content_changes_reset();
		delete_option( OPENSTATION_CONTENT_CHANGES_LOG_OPTION );
		delete_transient( openstation_content_changes_buffer_key( self::$admin_id ) );
	}

	public function tear_down() {
		openstation_content_changes_reset();
		delete_option( OPENSTATION_CONTENT_CHANGES_LOG_OPTION );
		delete_transient( openstation_content_changes_buffer_key( self::$admin_id ) );
		delete_user_meta( self::$admin_id, 'desktop_mode_mode' );
		unset( $_GET['openstation_chromeless'] );
		remove_all_filters( 'openstation_content_changes_should_record' );
		remove_all_filters( 'openstation_content_changes_broadcasts' );
		if ( post_type_exists( 'wpd_hidden_cpt' ) ) {
			unregister_post_type( 'wpd_hidden_cpt' );
		}
		if ( post_type_exists( 'wpd_shown_cpt' ) ) {
			unregister_post_type( 'wpd_shown_cpt' );
		}
		parent::tear_down();
	}

	private function enter_chromeless() {
		update_user_meta( self::$admin_id, 'desktop_mode_mode', '1' );
		$_GET['openstation_chromeless'] = '1';
	}

	/* ---------------------------------------------------------------------
	 * Recorder
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_record
	 */
	public function test_record_rejects_invalid_args() {
		$this->assertFalse( openstation_content_changes_record( '', 1, 'updated' ) );
		$this->assertFalse( openstation_content_changes_record( 'post', 0, 'updated' ) );
		$this->assertFalse( openstation_content_changes_record( 'post', 1, '' ) );
		$this->assertSame( array(), openstation_content_changes_log() );
	}

	/**
	 * @covers ::openstation_content_changes_record
	 */
	public function test_record_dedupes_first_writer_wins() {
		$this->assertTrue( openstation_content_changes_record( 'post', 9, 'trashed' ) );
		$this->assertFalse( openstation_content_changes_record( 'post', 9, 'updated' ) );

		$log = openstation_content_changes_log();
		$this->assertSame( array( 9 ), $log['post']['trashed'] );
		$this->assertArrayNotHasKey( 'updated', $log['post'] );
	}

	/**
	 * @covers ::openstation_content_changes_record
	 */
	public function test_should_record_filter_vetoes() {
		add_filter( 'openstation_content_changes_should_record', '__return_false' );
		$this->assertFalse( openstation_content_changes_record( 'post', 3, 'updated' ) );
		$this->assertSame( array(), openstation_content_changes_log() );
	}

	/**
	 * @covers ::openstation_content_changes_record
	 */
	public function test_recorded_action_fires() {
		$seen = array();
		add_action(
			'openstation_content_change_recorded',
			function ( $type, $id, $action ) use ( &$seen ) {
				$seen[] = array( $type, $id, $action );
			},
			10,
			3
		);

		openstation_content_changes_record( 'shop_order', 12, 'created' );

		$this->assertSame( array( array( 'shop_order', 12, 'created' ) ), $seen );
	}

	/* ---------------------------------------------------------------------
	 * Post hooks
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_on_after_insert_post
	 */
	public function test_new_post_records_created() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );

		$log = openstation_content_changes_log();
		$this->assertContains( $post_id, $log['post']['created'] );
	}

	/**
	 * @covers ::openstation_content_changes_on_after_insert_post
	 */
	public function test_updating_a_post_records_updated_and_skips_the_revision() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		openstation_content_changes_reset();

		wp_update_post(
			array(
				'ID'         => $post_id,
				'post_title' => 'Fresh title',
			)
		);

		$log = openstation_content_changes_log();
		$this->assertSame( array( $post_id ), $log['post']['updated'] );
		$this->assertArrayNotHasKey( 'revision', $log );
	}

	/**
	 * @covers ::openstation_content_changes_on_after_insert_post
	 */
	public function test_first_real_save_of_an_auto_draft_records_created() {
		$post_id = wp_insert_post(
			array(
				'post_title'  => 'Auto Draft',
				'post_status' => 'auto-draft',
			)
		);
		// The auto-draft shell itself must not be recorded.
		$this->assertSame( array(), openstation_content_changes_log() );

		wp_update_post(
			array(
				'ID'          => $post_id,
				'post_title'  => 'Real title',
				'post_status' => 'draft',
			)
		);

		$log = openstation_content_changes_log();
		$this->assertSame( array( $post_id ), $log['post']['created'] );
	}

	/**
	 * @covers ::openstation_content_changes_on_after_insert_post
	 */
	public function test_post_type_without_show_ui_is_skipped() {
		register_post_type( 'wpd_hidden_cpt', array( 'show_ui' => false ) );

		self::factory()->post->create( array( 'post_type' => 'wpd_hidden_cpt' ) );

		$this->assertArrayNotHasKey( 'wpd_hidden_cpt', openstation_content_changes_log() );
	}

	/**
	 * @covers ::openstation_content_changes_on_after_insert_post
	 */
	public function test_show_ui_cpt_is_recorded_under_its_own_type() {
		register_post_type( 'wpd_shown_cpt', array( 'show_ui' => true ) );

		$post_id = self::factory()->post->create( array( 'post_type' => 'wpd_shown_cpt' ) );

		$log = openstation_content_changes_log();
		$this->assertContains( $post_id, $log['wpd_shown_cpt']['created'] );
	}

	/**
	 * Trashing must record ONLY the recycle-bin's `trashed` verb — the
	 * internal status write reaches `wp_after_insert_post` afterwards
	 * and the first-writer-wins dedupe (plus the trash-status skip)
	 * must drop it. Proves the recycle-bin delegation end to end.
	 *
	 * @covers ::openstation_content_changes_record
	 * @covers ::openstation_recycle_bin_record_change
	 */
	public function test_trash_records_only_the_trashed_verb() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		openstation_content_changes_reset();

		wp_trash_post( $post_id );

		$log = openstation_content_changes_log();
		$this->assertSame( array( $post_id ), $log['post']['trashed'] );
		$this->assertArrayNotHasKey( 'updated', $log['post'] );
	}

	/**
	 * @covers ::openstation_content_changes_record
	 * @covers ::openstation_recycle_bin_record_change
	 */
	public function test_untrash_records_only_the_untrashed_verb() {
		$post_id = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		wp_trash_post( $post_id );
		openstation_content_changes_reset();

		wp_untrash_post( $post_id );

		$log = openstation_content_changes_log();
		$this->assertSame( array( $post_id ), $log['post']['untrashed'] );
		$this->assertArrayNotHasKey( 'updated', $log['post'] );
	}

	/* ---------------------------------------------------------------------
	 * Comment hooks
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_on_comment_transition
	 */
	public function test_new_comment_records_created() {
		$post_id    = self::factory()->post->create();
		openstation_content_changes_reset();
		$comment_id = self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );

		$log = openstation_content_changes_log();
		$this->assertContains( $comment_id, $log['comment']['created'] );
	}

	/**
	 * @covers ::openstation_content_changes_on_comment_transition
	 */
	public function test_approving_a_comment_records_updated() {
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '0',
			)
		);
		openstation_content_changes_reset();

		wp_set_comment_status( $comment_id, 'approve' );

		$log = openstation_content_changes_log();
		$this->assertSame( array( $comment_id ), $log['comment']['updated'] );
	}

	/**
	 * @covers ::openstation_content_changes_on_comment_transition
	 */
	public function test_trashing_a_comment_records_only_the_trashed_verb() {
		$post_id    = self::factory()->post->create();
		$comment_id = self::factory()->comment->create( array( 'comment_post_ID' => $post_id ) );
		openstation_content_changes_reset();

		wp_trash_comment( $comment_id );

		$log = openstation_content_changes_log();
		$this->assertSame( array( $comment_id ), $log['comment']['trashed'] );
		$this->assertArrayNotHasKey( 'updated', $log['comment'] );
	}

	/* ---------------------------------------------------------------------
	 * WooCommerce guard
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_register_wc_hooks
	 */
	public function test_wc_hooks_are_not_registered_without_woocommerce() {
		$this->assertFalse( class_exists( 'WooCommerce' ) );
		$this->assertFalse( openstation_content_changes_register_wc_hooks() );
	}

	/* ---------------------------------------------------------------------
	 * Redirect-surviving buffer + footer emitter
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_on_shutdown
	 */
	public function test_shutdown_buffers_an_unflushed_changelog() {
		openstation_content_changes_record( 'post', 5, 'updated' );

		openstation_content_changes_on_shutdown();

		$buffered = get_transient( openstation_content_changes_buffer_key( self::$admin_id ) );
		$this->assertSame( array( 5 ), $buffered['post']['updated'] );
	}

	/**
	 * @covers ::openstation_content_changes_emit_footer
	 */
	public function test_footer_emits_broadcasts_and_consumes_the_buffer() {
		$this->enter_chromeless();

		// Mutating request: record + buffer across the redirect.
		openstation_content_changes_record( 'shop_order', 12, 'updated' );
		openstation_content_changes_on_shutdown();

		// Redirect target: fresh request state, footer flushes the buffer.
		openstation_content_changes_reset();
		ob_start();
		openstation_content_changes_emit_footer();
		$html = ob_get_clean();

		$this->assertStringContainsString( 'os.shop_order.changed', $html );
		$this->assertStringContainsString( '"ids":[12]', $html );
		$this->assertStringContainsString( '"action":"updated"', $html );
		$this->assertFalse( get_transient( openstation_content_changes_buffer_key( self::$admin_id ) ) );

		// A later chromeless render with nothing new emits nothing.
		openstation_content_changes_reset();
		ob_start();
		openstation_content_changes_emit_footer();
		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * @covers ::openstation_content_changes_emit_footer
	 */
	public function test_footer_emits_nothing_outside_chromeless() {
		openstation_content_changes_record( 'post', 7, 'updated' );

		ob_start();
		openstation_content_changes_emit_footer();
		$this->assertSame( '', ob_get_clean() );
	}

	/**
	 * The footer must consume the in-memory changelog even when it
	 * emits: shutdown afterwards must not re-buffer what the parent
	 * shell already received.
	 *
	 * @covers ::openstation_content_changes_emit_footer
	 * @covers ::openstation_content_changes_on_shutdown
	 */
	public function test_shutdown_does_not_rebuffer_a_flushed_changelog() {
		$this->enter_chromeless();
		openstation_content_changes_record( 'post', 21, 'updated' );

		ob_start();
		openstation_content_changes_emit_footer();
		ob_end_clean();

		openstation_content_changes_on_shutdown();

		$this->assertFalse( get_transient( openstation_content_changes_buffer_key( self::$admin_id ) ) );
	}

	/**
	 * @covers ::openstation_content_changes_emit_footer
	 */
	public function test_broadcasts_filter_can_suppress_the_emit() {
		$this->enter_chromeless();
		openstation_content_changes_record( 'post', 8, 'updated' );
		add_filter( 'openstation_content_changes_broadcasts', '__return_empty_array' );

		ob_start();
		openstation_content_changes_emit_footer();
		$this->assertSame( '', ob_get_clean() );
	}

	/* ---------------------------------------------------------------------
	 * Heartbeat catch-all
	 * ------------------------------------------------------------------- */

	/**
	 * @covers ::openstation_content_changes_heartbeat_received
	 */
	public function test_heartbeat_without_opt_in_key_is_untouched() {
		$response = openstation_content_changes_heartbeat_received( array(), array() );
		$this->assertArrayNotHasKey( 'openstation_content_changes', $response );
	}

	/**
	 * @covers ::openstation_content_changes_on_shutdown
	 * @covers ::openstation_content_changes_heartbeat_received
	 */
	public function test_heartbeat_returns_entries_newer_than_seen_ts() {
		openstation_content_changes_record( 'page', 33, 'updated' );
		openstation_content_changes_on_shutdown();

		$response = openstation_content_changes_heartbeat_received(
			array(),
			array( 'openstation_content_changes_seen_ts' => 0 )
		);

		$block = $response['openstation_content_changes'];
		$this->assertGreaterThan( 0, $block['ts'] );
		$this->assertCount( 1, $block['entries'] );
		$this->assertSame( 'page', $block['entries'][0]['type'] );
		$this->assertSame( 'updated', $block['entries'][0]['action'] );
		$this->assertSame( array( 33 ), $block['entries'][0]['ids'] );

		// A client already at the high-water mark gets no entries.
		$caught_up = openstation_content_changes_heartbeat_received(
			array(),
			array( 'openstation_content_changes_seen_ts' => $block['ts'] )
		);
		$this->assertSame( array(), $caught_up['openstation_content_changes']['entries'] );
		$this->assertSame( $block['ts'], $caught_up['openstation_content_changes']['ts'] );
	}
}
