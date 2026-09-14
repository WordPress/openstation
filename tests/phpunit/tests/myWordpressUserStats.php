<?php
/**
 * Tests for the `/desktop-mode/v1/user-stats/<id>` REST endpoint's
 * permission model.
 *
 * The route wears the My WordPress module's gate (`edit_posts` by
 * default). Past it, viewers without `list_users` (and who aren't the
 * subject user) must only ever see published content: the recent-posts
 * list, the post/page counts, the CPT count, and both comment counts
 * must not leak draft / pending / private / future material, nor rows
 * of a post type with no readable front end. The comment counts also
 * ask the comment dossier's parent gate of each post they count.
 * Privileged viewers (`list_users`, or the subject themselves) get the
 * full dossier.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressUserStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $contributor_id;
	protected static $subscriber_id;
	protected static $author_id;

	private $published_post_id;
	private $draft_post_id;
	private $private_post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		register_post_type( 'dm_test_book', array( 'public' => true ) );
		// A plugin's internal type: `publish` rows with no front end
		// a visitor could open. The shape an order, a submission log
		// or an internal note takes.
		register_post_type( 'dm_test_internal', array( 'public' => false ) );

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
		self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_type'   => 'dm_test_internal',
				'post_status' => 'publish',
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
		unregister_post_type( 'dm_test_internal' );
		remove_all_filters( 'openstation_my_wordpress_user_stats' );
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
	 * @covers ::openstation_my_wordpress_register_user_stats_route
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
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_sees_published_recent_only() {
		wp_set_current_user( self::$contributor_id );
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
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_gets_publish_only_counts() {
		wp_set_current_user( self::$contributor_id );
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
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_cpt_and_comment_counts_exclude_non_public() {
		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		$this->assertSame( 1, $counts['cpt'] );
		$this->assertSame( 1, $counts['commentsReceived'] );
	}

	/**
	 * A published row of a post type with no readable front end is
	 * not counted for an unprivileged viewer. `publish` is not
	 * visibility on its own, and an exclusion list naming the types we
	 * know about counts every type we don't — a plugin's orders,
	 * submission log or internal notes among them.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_cpt_count_excludes_non_viewable_types() {
		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];

		// Only the published `dm_test_book` row: the published
		// `dm_test_internal` row has no front end to be public on.
		$this->assertSame(
			1,
			$counts['cpt'],
			'A published row of a non-viewable post type must not be counted.'
		);
	}

	/**
	 * Both comment counts reach past the subject's own published posts,
	 * so a viewer without `list_users` gets the CPT count's two gates on
	 * them (a published parent of a viewable type) plus two of their own:
	 * the parent is not password-protected, and it still exists.
	 * Privileged viewers keep every comment.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_comment_counts_cover_readable_parents_only() {
		$parents = array(
			$this->published_post_id,
			$this->draft_post_id,
			self::factory()->post->create(
				array(
					'post_author'   => self::$author_id,
					'post_status'   => 'publish',
					'post_password' => 'secret',
				)
			),
			self::factory()->post->create(
				array(
					'post_author' => self::$author_id,
					'post_type'   => 'dm_test_internal',
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
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];
		// Only the comment on the published post.
		$this->assertSame( 1, $counts['commentsLeft'] );
		// The fixture's comment on the published post, plus the one above.
		$this->assertSame( 2, $counts['commentsReceived'] );

		wp_set_current_user( self::$admin_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];
		$this->assertSame( 5, $counts['commentsLeft'] );
		// Both fixture comments, plus the four above on the subject's posts.
		$this->assertSame( 6, $counts['commentsReceived'] );
	}

	/**
	 * `read_post` is filterable per post, and the comment dossier asks it
	 * of a comment's parent even when that parent is published. A plugin
	 * that withholds one published post from a viewer takes that post's
	 * comments out of both counts, the ones the subject received and the
	 * ones they left, while comments on posts the viewer can still read
	 * keep counting.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 * @covers ::openstation_my_wordpress_user_stats_readable_comment_count
	 */
	public function test_comment_counts_follow_a_per_post_read_filter() {
		$members_only = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Members only',
			)
		);
		// The subject comments on both published posts, and someone else
		// comments on the members-only one.
		foreach ( array( $this->published_post_id, $members_only ) as $parent ) {
			self::factory()->comment->create(
				array(
					'comment_post_ID'  => $parent,
					'user_id'          => self::$author_id,
					'comment_approved' => '1',
				)
			);
		}
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $members_only,
				'comment_approved' => '1',
			)
		);

		wp_set_current_user( self::$contributor_id );
		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];
		// The fixture's comment and the subject's on the fixture post, plus
		// both comments on the members-only post.
		$this->assertSame( 4, $counts['commentsReceived'] );
		$this->assertSame( 2, $counts['commentsLeft'] );

		$contributor = self::$contributor_id;
		add_filter(
			'map_meta_cap',
			static function ( $caps, $cap, $user_id, $args ) use ( $members_only, $contributor ) {
				if ( 'read_post' === $cap && isset( $args[0] ) && (int) $args[0] === $members_only && (int) $user_id === $contributor ) {
					return array( 'do_not_allow' );
				}
				return $caps;
			},
			10,
			4
		);
		$this->assertFalse(
			openstation_my_wordpress_can_read_comment_post( get_post( $members_only ) ),
			'The comment dossier refuses the members-only post.'
		);

		$counts = $this->dispatch( self::$author_id )->get_data()['counts'];
		// Only the comments on the fixture post are left.
		$this->assertSame( 2, $counts['commentsReceived'] );
		$this->assertSame( 1, $counts['commentsLeft'] );
	}

	/**
	 * `counts.cpt` counts custom post types, so the types Core registers
	 * stay out of it for every viewer: a synced pattern or a navigation
	 * menu the subject saved is not custom-post-type content.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_cpt_count_leaves_out_core_built_in_types() {
		foreach ( array( 'wp_block', 'wp_navigation' ) as $type ) {
			self::factory()->post->create(
				array(
					'post_author' => self::$author_id,
					'post_type'   => $type,
					'post_status' => 'publish',
				)
			);
		}

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 3, $this->dispatch( self::$author_id )->get_data()['counts']['cpt'] );

		wp_set_current_user( self::$contributor_id );
		$this->assertSame( 1, $this->dispatch( self::$author_id )->get_data()['counts']['cpt'] );
	}

	/**
	 * Sensitive profile fields stay gated on the cap.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_unprivileged_viewer_profile_omits_sensitive_fields() {
		wp_set_current_user( self::$contributor_id );
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
	 * @covers ::openstation_my_wordpress_user_stats_callback
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
		// Published + draft book, plus the published internal-type row:
		// a privileged viewer counts every custom type.
		$this->assertSame( 3, $counts['cpt'] );
		$this->assertSame( 2, $counts['commentsReceived'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );

		$this->assertArrayHasKey( 'email', $data['profile'] );
	}

	/**
	 * Users always see their own full dossier, `list_users` or not.
	 *
	 * @covers ::openstation_my_wordpress_user_stats_callback
	 */
	public function test_self_sees_full_data_without_list_users() {
		wp_set_current_user( self::$author_id );
		$data = $this->dispatch( self::$author_id )->get_data();

		$this->assertArrayHasKey( 'draft', $data['counts']['posts'] );
		$this->assertSame( 1, $data['counts']['posts']['draft'] );

		$ids = wp_list_pluck( $data['recent'], 'id' );
		$this->assertContains( $this->draft_post_id, $ids );
	}
	/**
	 * The route wears the My WordPress module's gate: a Subscriber, who
	 * cannot open WP Explorer, cannot read this dossier either.
	 *
	 * @covers ::openstation_my_wordpress_register_user_stats_route
	 */
	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch( self::$author_id )->get_status() );
	}

	/**
	 * A site that narrows the module through its filter locks this route
	 * down with it, administrators included.
	 *
	 * @covers ::openstation_my_wordpress_register_user_stats_route
	 */
	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch( self::$author_id )->get_status() );
	}
}
