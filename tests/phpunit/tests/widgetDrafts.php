<?php
/**
 * Tests for the Drafts widget (`includes/widgets/widget-drafts.php`) —
 * asset registration and the `edit_posts` capability gate that keeps the
 * widget out of the picker for users whose REST query would only ever
 * return a permission error.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 */
class Tests_DesktopMode_WidgetDrafts extends WP_UnitTestCase {

	/**
	 * User who can edit posts.
	 *
	 * @var int
	 */
	protected static $editor_id;

	/**
	 * User who cannot.
	 *
	 * @var int
	 */
	protected static $subscriber_id;

	/**
	 * Author: can edit their own posts but cannot manage categories.
	 *
	 * @var int
	 */
	protected static $author_id;

	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();
		// Fresh REST server so rest_do_request() sees our routes.
		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init' );
	}

	/** Dispatch a draft-apply request for the current user. */
	private function apply_request( $params ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/draft-apply' );
		foreach ( $params as $k => $v ) {
			$request->set_param( $k, $v );
		}
		return rest_do_request( $request );
	}

	/**
	 * @covers ::desktop_mode_register_drafts_widget
	 */
	public function test_registers_for_a_user_who_can_edit_posts() {
		wp_set_current_user( self::$editor_id );

		$this->assertTrue( desktop_mode_register_drafts_widget() );

		$entry = desktop_mode_desktop_widget_registry( 'desktop-mode/drafts' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'desktop-mode-drafts-widget', $entry['script'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	/**
	 * A subscriber's `/wp/v2/posts?status=draft&context=edit` request is
	 * rejected by core, so the widget must not be offered at all.
	 *
	 * @covers ::desktop_mode_register_drafts_widget
	 */
	public function test_is_denied_for_a_user_who_cannot_edit_posts() {
		wp_set_current_user( self::$subscriber_id );

		$result = desktop_mode_register_drafts_widget();

		$this->assertWPError( $result );
		$this->assertSame( 'desktop_mode_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::desktop_mode_register_drafts_widget_assets
	 */
	public function test_registers_its_script_and_style() {
		desktop_mode_register_drafts_widget_assets();

		$this->assertTrue( wp_script_is( 'desktop-mode-drafts-widget', 'registered' ) );
		$this->assertTrue( wp_style_is( 'desktop-mode-drafts-widget', 'registered' ) );

		$script = wp_scripts()->registered['desktop-mode-drafts-widget'];
		$this->assertContains( 'wp-api-fetch', $script->deps );
		$this->assertTrue( (bool) $script->extra['group'], 'script loads in the footer' );
	}

	/**
	 * draft-apply writes the chosen title + excerpt onto the post.
	 *
	 * @covers ::desktop_mode_rest_draft_apply
	 */
	public function test_apply_writes_title_and_excerpt() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'draft',
				'post_author'  => self::$editor_id,
				'post_title'   => 'Old title',
				'post_excerpt' => '',
			)
		);

		$response = $this->apply_request(
			array(
				'post_id' => $post_id,
				'title'   => 'Shiny new title',
				'excerpt' => 'A crisp summary.',
			)
		);

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'Shiny new title', get_post_field( 'post_title', $post_id ) );
		$this->assertSame( 'A crisp summary.', get_post_field( 'post_excerpt', $post_id ) );
	}

	/**
	 * draft-apply appends tags without clobbering existing ones.
	 *
	 * @covers ::desktop_mode_rest_draft_apply
	 */
	public function test_apply_appends_tags() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);
		wp_set_post_tags( $post_id, array( 'existing' ), false );

		$this->apply_request( array( 'post_id' => $post_id, 'tags' => array( 'fresh' ) ) );

		$tags = wp_get_post_tags( $post_id, array( 'fields' => 'names' ) );
		$this->assertContains( 'existing', $tags );
		$this->assertContains( 'fresh', $tags );
	}

	/**
	 * An editor (manage_categories) can create a new category via apply.
	 *
	 * @covers ::desktop_mode_rest_draft_apply
	 */
	public function test_apply_creates_category_for_privileged_user() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$this->apply_request( array( 'post_id' => $post_id, 'categories' => array( 'Brand New Cat' ) ) );

		$this->assertInstanceOf( 'WP_Term', get_term_by( 'name', 'Brand New Cat', 'category' ) );
		$this->assertContains( 'Brand New Cat', wp_get_post_categories( $post_id, array( 'fields' => 'names' ) ) );
	}

	/**
	 * An author (no manage_categories) can assign an EXISTING category but
	 * cannot create a new one — the unknown category is skipped.
	 *
	 * @covers ::desktop_mode_rest_draft_apply
	 */
	public function test_apply_does_not_create_category_for_unprivileged_user() {
		$existing = self::factory()->term->create(
			array( 'taxonomy' => 'category', 'name' => 'Existing Cat' )
		);
		wp_set_current_user( self::$author_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$author_id )
		);

		$this->apply_request(
			array(
				'post_id'    => $post_id,
				'categories' => array( 'Existing Cat', 'Author Cannot Create This' ),
			)
		);

		// The unknown category was NOT created…
		$this->assertFalse( get_term_by( 'name', 'Author Cannot Create This', 'category' ) );
		// …but the existing one WAS assigned.
		$this->assertContains( $existing, wp_get_post_categories( $post_id ) );
	}

	/**
	 * A subscriber cannot edit posts, so draft-apply is forbidden.
	 *
	 * @covers ::desktop_mode_rest_draft_apply_permission
	 */
	public function test_apply_forbidden_for_user_who_cannot_edit() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$original = get_post_field( 'post_title', $post_id );

		wp_set_current_user( self::$subscriber_id );
		$response = $this->apply_request( array( 'post_id' => $post_id, 'title' => 'Nope' ) );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( $original, get_post_field( 'post_title', $post_id ), 'title unchanged' );
	}
}
