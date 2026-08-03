<?php
/**
 * Tests for the My WordPress contributors payload capability gate
 * (`includes/my-wordpress/lock.php`).
 *
 * The `open_station_contributors` REST field surfaces revision-author
 * identities (user id, display name, avatar). Like the sibling
 * `open_station_lock` field, it must be gated on `edit_post` so users
 * who can't edit a post never learn who else has edited it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group desktop-mode-my-wordpress
 */
class Tests_OpenStation_MyWordpressLock extends WP_UnitTestCase {

	protected static $admin_id;
	protected static $editor_id;
	protected static $author_id;
	protected static $subscriber_id;

	private $post_id;

	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$admin_id      = $factory->user->create( array( 'role' => 'administrator' ) );
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
	}

	public function set_up() {
		parent::set_up();

		wp_set_current_user( self::$admin_id );
		do_action( 'rest_api_init' );

		// Published post owned by the author; the editor saved it
		// most recently (`_edit_last`), making them a contributor.
		$this->post_id = self::factory()->post->create(
			array(
				'post_author' => self::$author_id,
				'post_status' => 'publish',
				'post_title'  => 'Collaborative post',
			)
		);
		update_post_meta( $this->post_id, '_edit_last', self::$editor_id );
	}

	public function tear_down() {
		remove_all_filters( 'open_station_my_wordpress_post_contributors' );
		parent::tear_down();
	}

	private function contributor_ids() {
		return wp_list_pluck(
			open_station_my_wordpress_post_contributors_payload( $this->post_id ),
			'userId'
		);
	}

	/**
	 * Privileged viewers (edit_post passes) see the contributor list.
	 *
	 * @covers ::open_station_my_wordpress_post_contributors_payload
	 */
	public function test_contributors_visible_to_users_who_can_edit_the_post() {
		wp_set_current_user( self::$admin_id );
		$this->assertContains( self::$editor_id, $this->contributor_ids() );

		// The post's own author can edit it, too.
		wp_set_current_user( self::$author_id );
		$this->assertContains( self::$editor_id, $this->contributor_ids() );
	}

	/**
	 * Users who can't edit the post get an empty array — revision
	 * authors and `_edit_last` identities must not leak to read-only
	 * viewers.
	 *
	 * @covers ::open_station_my_wordpress_post_contributors_payload
	 */
	public function test_contributors_empty_for_users_who_cannot_edit_the_post() {
		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( array(), open_station_my_wordpress_post_contributors_payload( $this->post_id ) );

		wp_set_current_user( 0 );
		$this->assertSame( array(), open_station_my_wordpress_post_contributors_payload( $this->post_id ) );
	}

	/**
	 * The gate runs BEFORE the filter — plugin-supplied ids are not
	 * exposed to viewers who can't edit the post either.
	 *
	 * @covers ::open_station_my_wordpress_post_contributors_payload
	 */
	public function test_gate_applies_before_the_contributors_filter() {
		$filter_ran = false;
		add_filter(
			'open_station_my_wordpress_post_contributors',
			function ( $ids ) use ( &$filter_ran ) {
				$filter_ran = true;
				$ids[]      = self::$editor_id;
				return $ids;
			}
		);

		wp_set_current_user( self::$subscriber_id );
		$this->assertSame( array(), open_station_my_wordpress_post_contributors_payload( $this->post_id ) );
		$this->assertFalse( $filter_ran );
	}

	/**
	 * End-to-end through the REST field: a subscriber reading a
	 * published post over `/wp/v2/posts/<id>` receives an empty
	 * `open_station_contributors` array, while an admin receives the
	 * populated one.
	 *
	 * @covers ::open_station_my_wordpress_register_lock_field
	 */
	public function test_rest_field_respects_the_gate() {
		$request = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $this->post_id );

		wp_set_current_user( self::$subscriber_id );
		$data = rest_get_server()->dispatch( $request )->get_data();
		$this->assertSame( array(), $data['open_station_contributors'] );

		wp_set_current_user( self::$admin_id );
		$data = rest_get_server()->dispatch( $request )->get_data();
		$this->assertContains(
			self::$editor_id,
			wp_list_pluck( $data['open_station_contributors'], 'userId' )
		);
	}
}
