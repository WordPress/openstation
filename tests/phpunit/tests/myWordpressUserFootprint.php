<?php
/**
 * Tests for the `/desktop-mode/v1/user-footprint/<id>` REST
 * endpoint's permission model.
 *
 * The route wears the My WordPress module's gate (`edit_posts` by
 * default), and past it activity is gated per post. Timeline rows
 * whose underlying post the viewer may not see (an unpublished post
 * they cannot `read_post`, a published row of a type with no front
 * end, a comment's sealed or deleted parent) are dropped, so those
 * titles must not leak to ordinary logged-in users across the posts,
 * post-update, and comment branches.
 *
 * The aggregates carry the same gate, because a count discloses on
 * its own: `totals` and each day's `comments` and `updates` ask that
 * gate of every post they count, so they never report what the rows
 * withhold, and they include what the rows show, for a Contributor
 * and an Editor alike.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressUserFootprint extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $contributor_id;
	protected static $subscriber_id;

	private $published_id;
	private $draft_id;
	private $private_id;

	/**
	 * A GMT datetime one day before the test run. A parent dated here
	 * predates any revision the test saves, so that revision counts as an
	 * update, without tying the fixture to a calendar date.
	 *
	 * @var string
	 */
	private $a_day_ago;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id      = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		$this->a_day_ago = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );

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

	public function tear_down() {
		unregister_post_type( 'dm_fp_internal' );
		parent::tear_down();
	}

	private function dispatch_footprint( $user_id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/user-footprint/' . (int) $user_id );
		return rest_get_server()->dispatch( $request );
	}

	private function timeline_post_ids( $response ) {
		return wp_list_pluck( $response->get_data()['timeline'], 'postId' );
	}

	/**
	 * A contributor viewing another user's footprint only sees rows
	 * for published posts — drafts and private posts are dropped.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_contributor_does_not_see_unpublished_titles_in_timeline() {
		wp_set_current_user( self::$contributor_id );

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

		wp_set_current_user( self::$contributor_id );
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
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$contributor_id );
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
	 * contributor must not learn how many drafts, pending, private or
	 * scheduled posts another user is sitting on. Only the published
	 * ones count.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_contributor_totals_count_published_only() {
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

		wp_set_current_user( self::$contributor_id );
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
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$contributor_id );
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
	 * Post ids of the timeline rows of one kind.
	 *
	 * @param array  $data Footprint payload.
	 * @param string $kind Row kind.
	 * @return int[]
	 */
	private function timeline_ids_of_kind( $data, $kind ) {
		return array_values( wp_list_pluck( wp_list_filter( $data['timeline'], array( 'kind' => $kind ) ), 'postId' ) );
	}

	/**
	 * An Editor holds no `list_users`, but can read another user's drafts
	 * and private posts, so the timeline lists them. The counts summarise
	 * those same rows and have to count them too, rather than contradict
	 * the timeline painted next to them.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 * @covers ::openstation_my_wordpress_footprint_visible_counts
	 */
	public function test_editor_counts_agree_with_the_rows_they_can_read() {
		$draft = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'draft',
				'post_title'    => 'Draft being edited',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'A later save creates a revision.',
			)
		);

		wp_set_current_user( self::$editor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();

		$post_rows = $this->timeline_ids_of_kind( $data, 'post' );
		$this->assertContains( $this->draft_id, $post_rows );
		$this->assertContains( $this->private_id, $post_rows );
		// Published + the fixture draft + the draft above + private.
		$this->assertSame( 4, $data['totals']['posts'] );

		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );

		// A Contributor, reading neither draft, gets neither counted.
		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['posts'] );
		$this->assertSame( 0, $data['totals']['updates'] );
	}

	/**
	 * A published row of a type with no readable front end is not public
	 * activity. An edit to one reaches neither the update counts nor the
	 * timeline for a Contributor, while an administrator, who can edit the
	 * row, keeps both.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 * @covers ::openstation_my_wordpress_footprint_can_see_post
	 */
	public function test_updates_to_a_non_viewable_type_stay_with_viewers_who_can_edit_it() {
		register_post_type(
			'dm_fp_internal',
			array(
				'public'       => false,
				'map_meta_cap' => true,
				'supports'     => array( 'title', 'editor', 'revisions' ),
			)
		);
		$record = self::factory()->post->create(
			array(
				'post_author'   => self::$admin_id,
				'post_type'     => 'dm_fp_internal',
				'post_status'   => 'publish',
				'post_title'    => 'Internal record',
				'post_date'     => $this->a_day_ago,
				'post_date_gmt' => $this->a_day_ago,
			)
		);
		wp_set_current_user( self::$author_id );
		wp_update_post(
			array(
				'ID'           => $record,
				'post_content' => 'The subject edits the record.',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 0, $data['totals']['updates'] );
		$this->assertSame( 0, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertNotContains( $record, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertContains( $record, $this->timeline_ids_of_kind( $data, 'post-update' ) );
	}

	/**
	 * Comments carry the comment dossier's parent gate into the counts as
	 * well as the rows. A comment on a private post, a password-protected
	 * post, a published row of a type with no front end, or a post that
	 * no longer exists is withheld from a Contributor everywhere: no
	 * timeline row, no heatmap cell (so no streak day), no lifetime count.
	 * An administrator keeps all of them.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 * @covers ::openstation_my_wordpress_footprint_can_see_post
	 */
	public function test_comment_counts_follow_the_comment_row_gate() {
		register_post_type(
			'dm_fp_internal',
			array(
				'public'       => false,
				'map_meta_cap' => true,
			)
		);
		$parents = array(
			$this->published_id,
			self::factory()->post->create(
				array(
					'post_author' => self::$admin_id,
					'post_status' => 'private',
				)
			),
			self::factory()->post->create(
				array(
					'post_author'   => self::$admin_id,
					'post_status'   => 'publish',
					'post_password' => 'secret',
				)
			),
			self::factory()->post->create(
				array(
					'post_author' => self::$admin_id,
					'post_type'   => 'dm_fp_internal',
					'post_status' => 'publish',
				)
			),
			// A post that has since been deleted.
			999999,
		);
		foreach ( $parents as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}

		wp_set_current_user( self::$contributor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['comments'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
		$this->assertSame( array( $this->published_id ), $this->timeline_ids_of_kind( $data, 'comment' ) );

		wp_set_current_user( self::$admin_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 5, $data['totals']['comments'] );
		$this->assertSame( 5, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
		$this->assertCount( 5, $this->timeline_ids_of_kind( $data, 'comment' ) );
	}

	/**
	 * A draft has no date until it is published, so "newer than the post"
	 * cannot tell its first save from a later one. The first revision a
	 * draft gets records its creation and is not an update; the next one
	 * is. Publishing the draft later dates it after both saves, and the
	 * second save stays an update rather than dropping out as an edit
	 * that predates the post.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_first_save_of_an_undated_draft_is_not_an_update() {
		wp_set_current_user( self::$author_id );
		$draft = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Fresh draft',
			)
		);
		$this->assertSame( '0000-00-00 00:00:00', get_post( $draft )->post_date_gmt );

		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'First save.',
			)
		);
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 0, $data['totals']['updates'] );
		$this->assertSame( 0, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertNotContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'Second save.',
			)
		);
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );

		wp_update_post(
			array(
				'ID'          => $draft,
				'post_status' => 'publish',
			)
		);
		$this->assertNotSame( '0000-00-00 00:00:00', get_post( $draft )->post_date_gmt );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		$this->assertSame( 1, $data['totals']['updates'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $draft, $this->timeline_ids_of_kind( $data, 'post-update' ) );
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
	/**
	 * A scheduled post's date is its future publication time, so every
	 * save made before it goes live is older than the post. Those saves
	 * are still updates: the first records the post, and each later one
	 * counts in the lifetime total, the heatmap and the timeline.
	 *
	 * @covers ::openstation_my_wordpress_user_footprint_callback
	 */
	public function test_saves_before_a_scheduled_date_count_as_updates() {
		wp_set_current_user( self::$author_id );
		$in_a_week = gmdate( 'Y-m-d H:i:s', time() + WEEK_IN_SECONDS );
		$scheduled = self::factory()->post->create(
			array(
				'post_author'   => self::$author_id,
				'post_status'   => 'future',
				'post_title'    => 'Scheduled scoop',
				'post_date'     => $in_a_week,
				'post_date_gmt' => $in_a_week,
			)
		);
		foreach ( array( 'First save.', 'Second save.', 'Third save.' ) as $content ) {
			wp_update_post(
				array(
					'ID'           => $scheduled,
					'post_content' => $content,
				)
			);
		}
		$this->assertSame( 'future', get_post_status( $scheduled ) );

		$data = $this->dispatch_footprint( self::$author_id )->get_data();
		// Three saves: the first records the post, the other two are updates.
		$this->assertSame( 2, $data['totals']['updates'] );
		$this->assertSame( 2, array_sum( wp_list_pluck( $data['daily'], 'updates' ) ) );
		$this->assertContains( $scheduled, $this->timeline_ids_of_kind( $data, 'post-update' ) );
	}

	/**
	 * A plugin that filters `read_post` for a single post moves the counts
	 * with the rows. The Editor can read every draft the subject holds
	 * until a filter hides one of them: that draft, and the comment on
	 * it, leave the timeline and the counts alike, while the fixture
	 * draft, identical in type, status and authorship, stays in both.
	 *
	 * @covers ::openstation_my_wordpress_footprint_visible_counts
	 * @covers ::openstation_my_wordpress_footprint_can_see_post
	 */
	public function test_a_per_post_capability_filter_reaches_the_counts() {
		$hidden = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'draft',
				'post_title'  => 'Embargoed draft',
			)
		);
		foreach ( array( $this->draft_id, $hidden ) as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}
		add_filter(
			'map_meta_cap',
			static function ( $caps, $cap, $user_id, $args ) use ( $hidden ) {
				if ( 'read_post' === $cap && isset( $args[0] ) && (int) $args[0] === $hidden ) {
					return array( 'do_not_allow' );
				}
				return $caps;
			},
			10,
			4
		);

		wp_set_current_user( self::$editor_id );
		$data = $this->dispatch_footprint( self::$author_id )->get_data();

		$post_rows = $this->timeline_ids_of_kind( $data, 'post' );
		$this->assertNotContains( $hidden, $post_rows );
		$this->assertContains( $this->draft_id, $post_rows );
		// Published + the fixture draft + private, without the hidden draft.
		$this->assertSame( 3, $data['totals']['posts'] );

		$this->assertSame( array( $this->draft_id ), $this->timeline_ids_of_kind( $data, 'comment' ) );
		$this->assertSame( 1, $data['totals']['comments'] );
		$this->assertSame( 1, array_sum( wp_list_pluck( $data['daily'], 'comments' ) ) );
	}

	/**
	 * The route wears the My WordPress module's gate: a Subscriber, who
	 * cannot open WP Explorer, cannot read this dossier either.
	 *
	 * @covers ::openstation_my_wordpress_register_user_footprint_route
	 */
	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch_footprint( self::$author_id )->get_status() );
	}

	/**
	 * A site that narrows the module through its filter locks this route
	 * down with it, administrators included.
	 *
	 * @covers ::openstation_my_wordpress_register_user_footprint_route
	 */
	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch_footprint( self::$author_id )->get_status() );
	}
}
