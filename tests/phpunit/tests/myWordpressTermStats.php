<?php
/**
 * Tests for the `/desktop-mode/v1/term-stats/<taxonomy>/<id>` REST
 * endpoint's post-level permission model.
 *
 * The route wears the My WordPress module's gate (`edit_posts` by
 * default), and terms are public data, but the posts inside a term
 * are not. A contributor must
 * never receive another author's `private`, `draft`, `pending` or
 * `future` post in the `recent` list, and the per-status `counts`
 * breakdown must not betray how many hidden posts a term holds.
 * Authors and editors keep their own (and, for editors, others')
 * unpublished work, custom statuses follow their registered visibility
 * flags, and terms of a hidden taxonomy are not served at all.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressTermStats extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $author_id;
	protected static $contributor_id;
	protected static $subscriber_id;

	private $tag_id;
	private $published_id;
	private $draft_id;
	private $private_id;
	private $pending_id;
	private $future_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id       = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$author_id      = $factory->user->create( array( 'role' => 'author' ) );
		self::$contributor_id = $factory->user->create( array( 'role' => 'contributor' ) );
		self::$subscriber_id  = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		$this->tag_id = self::factory()->tag->create();

		$this->published_id = $this->make_post( 'publish', 'Public article' );
		$this->draft_id     = $this->make_post( 'draft', 'Secret draft' );
		$this->private_id   = $this->make_post( 'private', 'Private notes' );
		$this->pending_id   = $this->make_post( 'pending', 'Pending review' );
		$this->future_id    = $this->make_post( 'future', 'Scheduled scoop', null, '2036-01-01 00:00:00' );
	}

	private function make_post( $status, $title, $author_id = null, $date = null ) {
		$args = array(
			'post_author' => (int) ( $author_id ?? self::$admin_id ),
			'post_status' => $status,
			'post_title'  => $title,
		);
		if ( null !== $date ) {
			$args['post_date']     = $date;
			$args['post_date_gmt'] = $date;
		}
		$post_id = self::factory()->post->create( $args );
		wp_set_object_terms( $post_id, array( $this->tag_id ), 'post_tag' );
		return $post_id;
	}

	private function dispatch( $taxonomy = 'post_tag', $term_id = null ) {
		$term_id = $term_id ?? $this->tag_id;
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/term-stats/' . $taxonomy . '/' . (int) $term_id );
		return rest_get_server()->dispatch( $request );
	}

	private function recent_ids( $response ) {
		return wp_list_pluck( $response->get_data()['recent'], 'id' );
	}

	private function post_counts( $response ) {
		return $response->get_data()['counts']['posts'];
	}

	/**
	 * A contributor only sees the published post in `recent` — the
	 * admin's draft, private, pending and scheduled posts are dropped.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_contributor_recent_excludes_unpublished() {
		wp_set_current_user( self::$contributor_id );

		$response = $this->dispatch();
		$this->assertSame( 200, $response->get_status() );

		$ids = $this->recent_ids( $response );
		$this->assertContains( $this->published_id, $ids );
		$this->assertNotContains( $this->draft_id, $ids );
		$this->assertNotContains( $this->private_id, $ids );
		$this->assertNotContains( $this->pending_id, $ids );
		$this->assertNotContains( $this->future_id, $ids );
	}

	/**
	 * The per-status counts a contributor receives cover only the
	 * published set — the unpublished statuses are zero, so the count
	 * cannot act as an oracle for hidden content.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_contributor_counts_hide_unpublished() {
		wp_set_current_user( self::$contributor_id );

		$counts = $this->post_counts( $this->dispatch() );
		$this->assertSame( 1, $counts['publish'] );
		$this->assertSame( 0, $counts['draft'] );
		$this->assertSame( 0, $counts['private'] );
		$this->assertSame( 0, $counts['pending'] );
		$this->assertSame( 0, $counts['future'] );
		$this->assertSame( 1, $counts['total'] );
	}

	/**
	 * An administrator can read everything in the term, so both the
	 * recent list and the counts include the unpublished posts.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_admin_sees_unpublished_in_recent_and_counts() {
		wp_set_current_user( self::$admin_id );

		$response = $this->dispatch();
		$ids      = $this->recent_ids( $response );
		$this->assertContains( $this->draft_id, $ids );
		$this->assertContains( $this->private_id, $ids );
		$this->assertContains( $this->pending_id, $ids );
		$this->assertContains( $this->future_id, $ids );

		$counts = $this->post_counts( $response );
		$this->assertSame( 1, $counts['publish'] );
		$this->assertSame( 1, $counts['draft'] );
		$this->assertSame( 1, $counts['private'] );
		$this->assertSame( 1, $counts['pending'] );
		$this->assertSame( 1, $counts['future'] );
		$this->assertSame( 5, $counts['total'] );
	}

	/**
	 * An author sees their OWN draft in the term (they can read it),
	 * but not another author's — the own-post scope widens no one
	 * else's view.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_author_sees_own_draft_only() {
		$own_draft = $this->make_post( 'draft', 'My own draft', self::$author_id );

		wp_set_current_user( self::$author_id );

		$response = $this->dispatch();
		$ids      = $this->recent_ids( $response );
		$this->assertContains( $own_draft, $ids );
		$this->assertNotContains( $this->draft_id, $ids ); // The admin's draft.
		$this->assertNotContains( $this->private_id, $ids );
		$this->assertNotContains( $this->future_id, $ids );

		// The count reflects the one draft the author may read.
		$counts = $this->post_counts( $response );
		$this->assertSame( 1, $counts['draft'] );
		$this->assertSame( 0, $counts['private'] );
		$this->assertSame( 0, $counts['future'] );
	}

	/**
	 * A status registered with `public => true` is front-end-visible
	 * data, so it counts and lists for everyone — the readable set is
	 * driven by the registered visibility flags, not a hardcoded
	 * status list.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_custom_public_status_is_visible_to_contributors() {
		register_post_status( 'showcase', array( 'public' => true ) );
		$showcase_id = $this->make_post( 'showcase', 'Showcased piece' );

		try {
			wp_set_current_user( self::$contributor_id );
			$response = $this->dispatch();

			$this->assertContains( $showcase_id, $this->recent_ids( $response ) );
			// The breakdown has no key for the custom status, but the
			// total covers every readable post.
			$this->assertSame( 2, $this->post_counts( $response )['total'] );
		} finally {
			unset( $GLOBALS['wp_post_statuses']['showcase'] );
		}
	}

	/**
	 * The recent list is capped at five and keeps the five most
	 * recent readable posts, newest first.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_recent_is_capped_at_five_newest_first() {
		$extras = array();
		for ( $i = 1; $i <= 6; $i++ ) {
			$extras[ $i ] = $this->make_post( 'publish', "Extra $i", null, sprintf( '2020-01-%02d 00:00:00', $i ) );
		}

		wp_set_current_user( self::$contributor_id );
		$this->assertSame(
			array( $this->published_id, $extras[6], $extras[5], $extras[4], $extras[3] ),
			$this->recent_ids( $this->dispatch() )
		);
	}

	/**
	 * Terms of a non-viewable taxonomy answer exactly like an
	 * unregistered one unless the caller can manage its terms — a
	 * contributor must not enumerate nav menus or a plugin's internal
	 * taxonomy through this endpoint.
	 *
	 * @covers ::openstation_my_wordpress_term_stats_callback
	 */
	public function test_hidden_taxonomy_is_not_served_to_contributors() {
		$menu = wp_insert_term( 'Primary menu', 'nav_menu' );
		$this->assertNotWPError( $menu );

		wp_set_current_user( self::$contributor_id );
		$response = $this->dispatch( 'nav_menu', $menu['term_id'] );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'openstation_invalid_taxonomy', $response->get_data()['code'] );

		// An admin holds nav_menu's manage cap (edit_theme_options).
		wp_set_current_user( self::$admin_id );
		$this->assertSame( 200, $this->dispatch( 'nav_menu', $menu['term_id'] )->get_status() );
	}
	/**
	 * The route wears the My WordPress module's gate: a Subscriber, who
	 * cannot open WP Explorer, cannot read this dossier either.
	 *
	 * @covers ::openstation_my_wordpress_register_term_stats_route
	 */
	public function test_subscriber_is_rejected_by_route() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( 403, $this->dispatch()->get_status() );
	}

	/**
	 * A site that narrows the module through its filter locks this route
	 * down with it, administrators included.
	 *
	 * @covers ::openstation_my_wordpress_register_term_stats_route
	 */
	public function test_filter_narrowed_route_refuses_admins() {
		add_filter( 'openstation_my_wordpress_user_can_use', '__return_false' );

		wp_set_current_user( self::$admin_id );
		$this->assertSame( 403, $this->dispatch()->get_status() );
	}
}
