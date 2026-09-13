<?php
/**
 * Tests for the `/desktop-mode/v1/user-footprint/<id>` REST
 * endpoint's timeline permission model.
 *
 * The route is open to any logged-in user, but the payload is
 * tiered on `list_users` (or the subject viewing themselves).
 * Timeline rows whose underlying post is not published are only
 * emitted when the viewer passes `current_user_can( 'read_post' )`
 * for that post — draft / pending / private / future titles must
 * not leak to ordinary logged-in users across the posts,
 * post-update, and comment branches.
 *
 * The aggregates carry the same rule, because a count discloses on
 * its own: `totals.posts` / `totals.pages` are publish-only for an
 * unprivileged viewer, and the `updates` rollups (lifetime and
 * per-day) only count revisions whose parent is published.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressUserFootprint extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $subscriber_id;

	private $published_id;
	private $draft_id;
	private $private_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		$this->published_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Public article',
			)
		);
		$this->draft_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Secret draft',
			)
		);
		$this->private_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'private',
				'post_title'  => 'Private notes',
			)
		);
	}

	private function dispatch_footprint( $user_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/user-footprint/' . (int) $user_id );
		return rest_get_server()->dispatch( $request );
	}

	private function timeline_post_ids( $response ) {
		return wp_list_pluck( $response->get_data()['timeline'], 'postId' );
	}

	/**
	 * A subscriber viewing another user's footprint only sees rows
	 * for published posts — drafts and private posts are dropped.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_subscriber_does_not_see_unpublished_titles_in_timeline() {
		wp_set_current_user( self::$subscriber_id );

		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertSame( 200, $response->get_status() );

		$ids = $this->timeline_post_ids( $response );
		$this->assertContains( $this->published_id, $ids );
		$this->assertNotContains( $this->draft_id, $ids );
		$this->assertNotContains( $this->private_id, $ids );
	}

	/**
	 * Privileged viewers keep the full timeline: an admin (and the
	 * subject user themselves) can read the drafts, so the rows stay.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_privileged_viewers_keep_unpublished_rows() {
		wp_set_current_user( self::$admin_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );

		wp_set_current_user( self::$author_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );
	}

	/**
	 * The comment branch LEFT-joins the parent post's title — a
	 * comment left on someone else's draft must not leak that draft's
	 * existence to viewers who can't read it.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_comment_on_unreadable_draft_is_dropped_from_timeline() {
		$admins_draft = self::factory()->post->create(
			array(
				'post_author' => self::$admin_id,
				'post_status' => 'draft',
				'post_title'  => 'Hidden parent',
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $admins_draft,
				'user_id'          => self::$author_id,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$subscriber_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertNotContains( $admins_draft, $ids );

		// The admin can read their own draft — the comment row stays.
		wp_set_current_user( self::$admin_id );
		$ids = $this->timeline_post_ids( $this->dispatch_footprint( self::$author_id ) );
		$this->assertContains( $admins_draft, $ids );
	}

	/**
	 * The post-update (revision rollup) branch joins the parent's
	 * title too — updates the subject made to an unpublished post
	 * must not leak it to viewers who can't read the parent.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_update_rows_on_unreadable_drafts_are_dropped() {
		// Backdate the parent so the revision saved below counts as
		// an update (revision date > parent creation date).
		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft in progress',
				'post_date'     => '2026-01-01 00:00:00',
				'post_date_gmt' => '2026-01-01 00:00:00',
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$subscriber_id );
		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertNotContains( $draft, $this->timeline_post_ids( $response ) );

		// Privileged viewer keeps the update row.
		wp_set_current_user( self::$admin_id );
		$response = $this->dispatch_footprint( self::$author_id );
		$timeline = $response->get_data()['timeline'];
		$updates  = wp_list_filter( $timeline, array( 'kind' => 'post-update' ) );
		$this->assertContains( $draft, wp_list_pluck( $updates, 'postId' ) );
	}

	/**
	 * The lifetime totals are a disclosure in their own right: a
	 * subscriber must not learn how many drafts, pending, private or
	 * scheduled posts another user is sitting on. Only the published
	 * ones count.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_subscriber_totals_count_published_only() {
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'pending',
				'post_title'  => 'Awaiting review',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_type'   => 'page',
				'post_title'  => 'Public page',
			)
		);
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_type'   => 'page',
				'post_title'  => 'Secret page',
			)
		);

		wp_set_current_user( self::$subscriber_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		// One published post (the fixture) and one published page.
		$this->assertSame( 1, $totals['posts'], 'Draft, private and pending posts must not be counted.' );
		$this->assertSame( 1, $totals['pages'], 'A draft page must not be counted.' );
	}

	/**
	 * A privileged viewer keeps the unfiltered totals — the gate
	 * withholds nothing they are entitled to.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_privileged_viewer_totals_include_unpublished() {
		wp_set_current_user( self::$admin_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		// Published + draft + private, from the fixtures.
		$this->assertSame( 3, $totals['posts'] );
	}

	/**
	 * The subject sees their own unpublished work counted, without
	 * holding `list_users`.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_subject_sees_own_unpublished_totals() {
		wp_set_current_user( self::$author_id );
		$totals = $this->dispatch_footprint( self::$author_id )->get_data()['totals'];

		$this->assertSame( 3, $totals['posts'] );
	}

	/**
	 * The `updates` rollups follow the same rule as the timeline rows
	 * they summarise: a revision on a parent the caller cannot read is
	 * not counted, per day or lifetime. Otherwise the heatmap reports
	 * "this user edited something private on Tuesday" — exactly what
	 * the per-row timeline gate withholds.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_update_counts_exclude_unreadable_parents() {
		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft in progress',
				'post_date'     => '2026-01-01 00:00:00',
				'post_date_gmt' => '2026-01-01 00:00:00',
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$subscriber_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame(
			0,
			$data['totals']['updates'],
			'A revision on an unreadable draft must not reach the lifetime count.'
		);
		$this->assertSame(
			0,
			array_sum( wp_list_pluck( $data['daily'], 'updates' ) ),
			'…nor any heatmap cell.'
		);

		// The privileged viewer still gets the update.
		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertGreaterThan( 0, $data['totals']['updates'] );
	}

	/**
	 * Logged-out requests are rejected by the permission callback.
	 *
	 * @covers ::openstation_my_wordpress_register_user_footprint_route
	 */
	public function test_logged_out_request_is_rejected() {
		wp_set_current_user( 0 );
		$response = $this->dispatch_footprint( self::$author_id );
		$this->assertSame( 401, $response->get_status() );
	}
}
