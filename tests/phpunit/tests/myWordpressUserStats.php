<?php
/**
 * Tests for the `/desktop-mode/v1/user-stats/<id>` REST endpoint's
 * permission model.
 *
 * Viewers without `list_users` (and who aren't the subject user)
 * must only ever see published content: the recent-posts list, the
 * post/page counts, the CPT count, and the comments-received count
 * must not leak draft / pending / private / future material.
 * Privileged viewers (`list_users`, or the subject themselves) get
 * the full dossier.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressUserStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $subscriber_id;
	protected static $author_id;

	private $published_post_id;
	private $draft_post_id;
	private $private_post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		register_post_type( 'dm_test_book', array( 'public' => true ) );

		// The author's content: 2 published + 1 draft + 1 private
		// post, 1 published + 1 draft page, 1 published + 1 draft CPT.
		//
		// The six post/page rows compete for five `recent` slots, and
		// the endpoint orders by `post_date` alone — the post factory
		// sets no date, so without explicit ones all six share a
		// timestamp and MySQL breaks the tie however the rows happen to
		// be laid out. Explicit descending dates make the cut
		// deterministic: the newest five (through the published page)
		// are the ones `recent` should carry.
		$this->published_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_date'   => '2026-01-06 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_date'   => '2026-01-05 10:00:00',
			)
		);
		$this->draft_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_date'   => '2026-01-04 10:00:00',
			)
		);
		$this->private_post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'private',
				'post_date'   => '2026-01-03 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'page',
				'post_status' => 'publish',
				'post_date'   => '2026-01-02 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'page',
				'post_status' => 'draft',
				'post_date'   => '2026-01-01 10:00:00',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_book',
				'post_status' => 'publish',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_book',
				'post_status' => 'draft',
			)
		);

		// One approved comment on a published post, one on a draft.
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->published_post_id,
				'comment_approved' => '1',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $this->draft_post_id,
				'comment_approved' => '1',
			)
		);
	}

	public function tear_down() {
		unregister_post_type( 'dm_test_book' );
		remove_all_filters( 'open_station_my_wordpress_user_stats' );
		parent::tear_down();
	}

	/**
	 * Dispatch a stats request for the given subject user.
	 *
	 * @param int $user_id Subject user id.
	 * @return WP_REST_Response
	 */
	private function dispatch( $user_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/user-stats/' . (int) $user_id );
		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Logged-out requests are rejected by the permission callback.
	 *
	 * @covers ::open_station_my_wordpress_register_user_stats_route
	 */
	public function test_logged_out_request_is_rejected() {
		wp_set_current_user( 0 );
		$response = $this->dispatch( self::$author_id );
		$this->assertSame( 401, $response->get_status() );
	}

	/**
	 * A viewer without `list_users` must not receive another user's
	 * draft / pending / private posts in the `recent` list.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_sees_published_recent_only() {
		wp_set_current_user( self::$subscriber_id );
		$data = $this->dispatch( self::$author_id )->get_data();

		$this->assertNotEmpty( $data['recent'] );
		$ids = array();
		foreach ( $data['recent'] as $row ) {
			$this->assertSame( 'publish', $row['status'] );
			$ids[] = $row['id'];
		}
		$this->assertContains( $this->published_post_id, $ids );
		$this->assertNotContains( $this->draft_post_id, $ids );
		$this->assertNotContains( $this->private_post_id, $ids );
	}

	/**
	 * A viewer without `list_users` only gets published counts —
	 * the per-status breakdown is omitted and `total` collapses to
	 * the publish count.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_gets_publish_only_counts() {
		wp_set_current_user( self::$subscriber_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame(
			array(
				'publish' => 2,
				'total'   => 2,
			),
			$counts['posts']
		);
		$this->assertSame(
			array(
				'publish' => 1,
				'total'   => 1,
			),
			$counts['pages']
		);
	}

	/**
	 * The CPT count and the comments-received count must also be
	 * restricted to published content for unprivileged viewers.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_cpt_and_comment_counts_exclude_non_public() {
		wp_set_current_user( self::$subscriber_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 1, $counts['cpt'] );
		$this->assertSame( 1, $counts['commentsReceived'] );
	}

	/**
	 * Sensitive profile fields stay gated on the cap.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_profile_omits_sensitive_fields() {
		wp_set_current_user( self::$subscriber_id );
		$profile = $this->dispatch( self::$author_id )->get_data()['profile'];

		$this->assertArrayNotHasKey( 'email', $profile );
		$this->assertArrayNotHasKey( 'username', $profile );
		$this->assertArrayNotHasKey( 'registered', $profile );
		$this->assertArrayNotHasKey( 'roles', $profile );
	}

	/**
	 * A viewer with `list_users` still gets the full dossier: the
	 * per-status breakdown, non-public recents, unrestricted CPT and
	 * comment counts, and the sensitive profile fields.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_privileged_viewer_sees_full_data() {
		wp_set_current_user( self::$admin_id );
		$data   = $this->dispatch( self::$author_id )->get_data();
		$counts = $data['counts'];

		$this->assertSame( 2, $counts['posts']['publish'] );
		$this->assertSame( 1, $counts['posts']['draft'] );
		$this->assertSame( 1, $counts['posts']['private'] );
		$this->assertSame( 4, $counts['posts']['total'] );
		$this->assertSame( 1, $counts['pages']['draft'] );
		$this->assertSame( 2, $counts['cpt'] );
		$this->assertSame( 2, $counts['commentsReceived'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );

		$this->assertArrayHasKey( 'email', $data['profile'] );
	}

	/**
	 * Users always see their own full dossier, `list_users` or not.
	 *
	 * @covers ::open_station_my_wordpress_user_stats_callback
	 */
	public function test_self_sees_full_data_without_list_users() {
		wp_set_current_user( self::$author_id );
		$data = $this->dispatch( self::$author_id )->get_data();

		$this->assertArrayHasKey( 'draft', $data['counts']['posts'] );
		$this->assertSame( 1, $data['counts']['posts']['draft'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );
	}
}
