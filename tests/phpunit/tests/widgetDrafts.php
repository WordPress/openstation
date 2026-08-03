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
 * @group openstation
 */
class Tests_OpenStation_WidgetDrafts extends WP_UnitTestCase {

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

	/** Dispatch a draft-suggestions request for the current user. */
	private function suggestions_request( $post_id ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/draft-suggestions' );
		$request->set_param( 'post_id', $post_id );
		return rest_do_request( $request );
	}

	/**
	 * @covers ::open_station_register_drafts_widget
	 */
	public function test_registers_for_a_user_who_can_edit_posts() {
		wp_set_current_user( self::$editor_id );

		$this->assertTrue( open_station_register_drafts_widget() );

		$entry = open_station_desktop_widget_registry( 'desktop-mode/drafts' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'os-drafts-widget', $entry['script'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	/**
	 * A subscriber's `/wp/v2/posts?status=draft&context=edit` request is
	 * rejected by core, so the widget must not be offered at all.
	 *
	 * @covers ::open_station_register_drafts_widget
	 */
	public function test_is_denied_for_a_user_who_cannot_edit_posts() {
		wp_set_current_user( self::$subscriber_id );

		$result = open_station_register_drafts_widget();

		$this->assertWPError( $result );
		$this->assertSame( 'open_station_capability_denied', $result->get_error_code() );
	}

	/**
	 * @covers ::open_station_register_drafts_widget_assets
	 */
	public function test_registers_its_script_and_style() {
		open_station_register_drafts_widget_assets();

		$this->assertTrue( wp_script_is( 'os-drafts-widget', 'registered' ) );
		$this->assertTrue( wp_style_is( 'os-drafts-widget', 'registered' ) );

		$script = wp_scripts()->registered['os-drafts-widget'];
		$this->assertContains( 'wp-api-fetch', $script->deps );
		$this->assertTrue( (bool) $script->extra['group'], 'script loads in the footer' );
	}

	/**
	 * draft-apply writes the chosen title + excerpt onto the post.
	 *
	 * @covers ::open_station_rest_draft_apply
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
	 * @covers ::open_station_rest_draft_apply
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
	 * @covers ::open_station_rest_draft_apply
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
	 * @covers ::open_station_rest_draft_apply
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
	 * @covers ::open_station_rest_draft_apply_permission
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

	/**
	 * draft-apply strips markup out of an accepted title.
	 *
	 * The suggestion text round-trips through the browser, so the write
	 * path sanitizes rather than trusting what comes back.
	 *
	 * @covers ::open_station_rest_draft_apply
	 */
	public function test_apply_sanitizes_the_title() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$this->apply_request(
			array(
				'post_id' => $post_id,
				'title'   => '<script>alert(1)</script>Clean title',
			)
		);

		$this->assertSame( 'Clean title', get_post_field( 'post_title', $post_id ) );
	}

	/**
	 * An empty title is ignored rather than blanking the post.
	 *
	 * @covers ::open_station_rest_draft_apply
	 */
	public function test_apply_ignores_an_empty_title() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_author' => self::$editor_id,
				'post_title'  => 'Keep me',
			)
		);

		$this->apply_request( array( 'post_id' => $post_id, 'title' => '   ' ) );

		$this->assertSame( 'Keep me', get_post_field( 'post_title', $post_id ) );
	}

	/**
	 * `open_station_drafts_suggestion_applied` reports what actually changed.
	 *
	 * @covers ::open_station_rest_draft_apply
	 */
	public function test_apply_fires_the_applied_action() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$seen = array();
		add_action(
			'open_station_drafts_suggestion_applied',
			function ( $id, $applied ) use ( &$seen ) {
				$seen[] = array( $id, $applied );
			},
			10,
			2
		);

		$this->apply_request( array( 'post_id' => $post_id, 'title' => 'Hooked' ) );

		$this->assertCount( 1, $seen );
		$this->assertSame( $post_id, $seen[0][0] );
		$this->assertSame( array( 'title' => 'Hooked' ), $seen[0][1] );
	}

	/**
	 * draft-suggestions answers 403 — not 503 — for a user who cannot edit
	 * the post, so the response can't be used to probe whether the site has
	 * an AI provider configured.
	 *
	 * @covers ::open_station_rest_draft_suggestions_permission
	 */
	public function test_suggestions_forbidden_for_user_who_cannot_edit() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		wp_set_current_user( self::$subscriber_id );
		$response = $this->suggestions_request( $post_id );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * With no AI provider configured, a user who CAN edit the post gets a
	 * clean 503 rather than a fatal or a half-built response.
	 *
	 * @covers ::open_station_rest_draft_suggestions_permission
	 */
	public function test_suggestions_unavailable_without_a_provider() {
		if ( open_station_ai_provider_configured() ) {
			$this->markTestSkipped( 'This environment has an AI provider configured.' );
		}

		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$response = $this->suggestions_request( $post_id );

		$this->assertSame( 503, $response->get_status() );
		$this->assertSame( 'open_station_ai_unavailable', $response->as_error()->get_error_code() );
	}

	/**
	 * The prompt carries the draft's title, content and the site's existing
	 * categories — the last is what keeps the model classifying into the
	 * site's taxonomy instead of inventing one.
	 *
	 * @covers ::open_station_drafts_ai_prompt_text
	 */
	public function test_prompt_text_includes_title_content_and_existing_categories() {
		self::factory()->term->create(
			array( 'taxonomy' => 'category', 'name' => 'Field Notes' )
		);
		$post = get_post(
			self::factory()->post->create(
				array(
					'post_status'  => 'draft',
					'post_title'   => 'Half a thought',
					'post_content' => '<p>Some <strong>marked-up</strong> body copy.</p>',
				)
			)
		);

		$text = open_station_drafts_ai_prompt_text( $post );

		$this->assertStringContainsString( 'Half a thought', $text );
		$this->assertStringContainsString( 'Some marked-up body copy.', $text );
		$this->assertStringNotContainsString( '<strong>', $text );
		$this->assertStringContainsString( 'Field Notes', $text );
	}

	/**
	 * `open_station_drafts_ai_content_limit` caps how much of the draft is
	 * sent to the model, without splitting a multibyte character.
	 *
	 * @covers ::open_station_drafts_ai_prompt_text
	 */
	public function test_content_limit_filter_truncates_the_prompt() {
		$post = get_post(
			self::factory()->post->create(
				array(
					'post_status'  => 'draft',
					'post_content' => str_repeat( 'é', 50 ),
				)
			)
		);

		add_filter( 'open_station_drafts_ai_content_limit', array( $this, 'return_ten' ) );
		$text = open_station_drafts_ai_prompt_text( $post );
		remove_filter( 'open_station_drafts_ai_content_limit', array( $this, 'return_ten' ) );

		$this->assertStringContainsString( str_repeat( 'é', 10 ) . '…', $text );
		$this->assertStringNotContainsString( str_repeat( 'é', 11 ), $text );
	}

	/** Filter callback for {@see test_content_limit_filter_truncates_the_prompt()}. */
	public function return_ten() {
		return 10;
	}

	/**
	 * The instruction + schema are filterable, so a plugin can retune the
	 * assistant without forking the route.
	 *
	 * @covers ::open_station_drafts_ai_instructions
	 * @covers ::open_station_drafts_ai_schema
	 */
	public function test_instructions_and_schema_are_filterable() {
		$post = get_post(
			self::factory()->post->create( array( 'post_status' => 'draft' ) )
		);

		add_filter( 'open_station_drafts_ai_instructions', '__return_empty_string' );
		$this->assertSame( '', open_station_drafts_ai_instructions( $post ) );
		remove_filter( 'open_station_drafts_ai_instructions', '__return_empty_string' );

		add_filter( 'open_station_drafts_ai_schema', array( $this, 'return_marker_schema' ) );
		$schema = open_station_drafts_ai_schema( $post );
		remove_filter( 'open_station_drafts_ai_schema', array( $this, 'return_marker_schema' ) );

		$this->assertSame( array( 'type' => 'marker' ), $schema );
	}

	/** Filter callback for {@see test_instructions_and_schema_are_filterable()}. */
	public function return_marker_schema() {
		return array( 'type' => 'marker' );
	}

	/**
	 * The list normalizer strips markup, drops blanks and non-scalars, and
	 * caps the list — the model's output is never trusted verbatim.
	 *
	 * @covers ::open_station_drafts_clean_list
	 */
	public function test_clean_list_normalizes_model_output() {
		$out = open_station_drafts_clean_list(
			array( '  spaced  ', '<b>bold</b>', '', array( 'nested' ), 'third', 'fourth' ),
			3
		);

		$this->assertSame( array( 'spaced', 'bold', 'third' ), $out );
	}
}
