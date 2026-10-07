<?php

class Tests_OpenStation_WidgetDrafts extends WP_UnitTestCase {

	protected static $editor_id;

	protected static $subscriber_id;

	protected static $author_id;

	public static function wpSetUpBeforeClass( $factory ) {
		self::$editor_id     = $factory->user->create( array( 'role' => 'editor' ) );
		self::$subscriber_id = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$author_id     = $factory->user->create( array( 'role' => 'author' ) );
	}

	public function set_up() {
		parent::set_up();

		global $wp_rest_server;
		$wp_rest_server = new WP_REST_Server();
		do_action( 'rest_api_init' );
	}

	private function apply_request( $params ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/draft-apply' );
		foreach ( $params as $k => $v ) {
			$request->set_param( $k, $v );
		}
		return rest_do_request( $request );
	}

	private function suggestions_request( $post_id ) {
		$request = new WP_REST_Request( 'POST', '/desktop-mode/v1/draft-suggestions' );
		$request->set_param( 'post_id', $post_id );
		return rest_do_request( $request );
	}

	public function test_registers_for_a_user_who_can_edit_posts() {
		wp_set_current_user( self::$editor_id );

		$this->assertTrue( openstation_register_drafts_widget() );

		$entry = openstation_desktop_widget_registry( 'desktop-mode/drafts' );
		$this->assertIsArray( $entry );
		$this->assertSame( 'os-drafts-widget', $entry['script'] );
		$this->assertTrue( $entry['movable'] );
		$this->assertTrue( $entry['resizable'] );
	}

	public function test_is_denied_for_a_user_who_cannot_edit_posts() {
		wp_set_current_user( self::$subscriber_id );

		$result = openstation_register_drafts_widget();

		$this->assertWPError( $result );
		$this->assertSame( 'openstation_capability_denied', $result->get_error_code() );
	}

	public function test_registers_its_script_and_style() {
		openstation_register_drafts_widget_assets();

		$this->assertTrue( wp_script_is( 'os-drafts-widget', 'registered' ) );
		$this->assertTrue( wp_style_is( 'os-drafts-widget', 'registered' ) );

		$script = wp_scripts()->registered['os-drafts-widget'];
		$this->assertContains( 'wp-api-fetch', $script->deps );
		$this->assertTrue( (bool) $script->extra['group'], 'script loads in the footer' );
	}

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

	public function test_apply_creates_category_for_privileged_user() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$this->apply_request( array( 'post_id' => $post_id, 'categories' => array( 'Brand New Cat' ) ) );

		$this->assertInstanceOf( 'WP_Term', get_term_by( 'name', 'Brand New Cat', 'category' ) );
		$this->assertContains( 'Brand New Cat', wp_get_post_categories( $post_id, array( 'fields' => 'names' ) ) );
	}

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

		$this->assertFalse( get_term_by( 'name', 'Author Cannot Create This', 'category' ) );

		$this->assertContains( $existing, wp_get_post_categories( $post_id ) );
	}

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

	public function test_apply_fires_the_applied_action() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$seen = array();
		add_action(
			'openstation_drafts_suggestion_applied',
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

	public function test_suggestions_forbidden_for_user_who_cannot_edit() {
		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		wp_set_current_user( self::$subscriber_id );
		$response = $this->suggestions_request( $post_id );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_suggestions_unavailable_without_a_provider() {
		if ( openstation_ai_provider_configured() ) {
			$this->markTestSkipped( 'This environment has an AI provider configured.' );
		}

		wp_set_current_user( self::$editor_id );
		$post_id = self::factory()->post->create(
			array( 'post_status' => 'draft', 'post_author' => self::$editor_id )
		);

		$response = $this->suggestions_request( $post_id );

		$this->assertSame( 503, $response->get_status() );
		$this->assertSame( 'openstation_ai_unavailable', $response->as_error()->get_error_code() );
	}

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

		$text = openstation_drafts_ai_prompt_text( $post );

		$this->assertStringContainsString( 'Half a thought', $text );
		$this->assertStringContainsString( 'Some marked-up body copy.', $text );
		$this->assertStringNotContainsString( '<strong>', $text );
		$this->assertStringContainsString( 'Field Notes', $text );
	}

	public function test_content_limit_filter_truncates_the_prompt() {
		$post = get_post(
			self::factory()->post->create(
				array(
					'post_status'  => 'draft',
					'post_content' => str_repeat( 'é', 50 ),
				)
			)
		);

		add_filter( 'openstation_drafts_ai_content_limit', array( $this, 'return_ten' ) );
		$text = openstation_drafts_ai_prompt_text( $post );
		remove_filter( 'openstation_drafts_ai_content_limit', array( $this, 'return_ten' ) );

		$this->assertStringContainsString( str_repeat( 'é', 10 ) . '…', $text );
		$this->assertStringNotContainsString( str_repeat( 'é', 11 ), $text );
	}

	public function return_ten() {
		return 10;
	}

	public function test_instructions_and_schema_are_filterable() {
		$post = get_post(
			self::factory()->post->create( array( 'post_status' => 'draft' ) )
		);

		add_filter( 'openstation_drafts_ai_instructions', '__return_empty_string' );
		$this->assertSame( '', openstation_drafts_ai_instructions( $post ) );
		remove_filter( 'openstation_drafts_ai_instructions', '__return_empty_string' );

		add_filter( 'openstation_drafts_ai_schema', array( $this, 'return_marker_schema' ) );
		$schema = openstation_drafts_ai_schema( $post );
		remove_filter( 'openstation_drafts_ai_schema', array( $this, 'return_marker_schema' ) );

		$this->assertSame( array( 'type' => 'marker' ), $schema );
	}

	public function return_marker_schema() {
		return array( 'type' => 'marker' );
	}

	public function test_provider_failure_is_mapped_to_a_reason( $code, $status, $detail, $reason, $provider_status ) {
		$raw = new WP_Error( $code, $detail, null === $status ? array() : array( 'status' => $status ) );

		$error = openstation_drafts_ai_failure( $raw );
		$data  = $error->get_error_data();

		$this->assertSame( 'openstation_ai_failed', $error->get_error_code() );
		$this->assertSame( 502, $data['status'] );
		$this->assertSame( $reason, $data['reason'] );
		$this->assertSame( $provider_status, $data['provider_status'] );
		$this->assertSame( $detail, $data['detail'] );
		$this->assertStringNotContainsString( $detail, $error->get_error_message() );
	}

	public function data_provider_failures() {
		return array(
			'openai 429 no credits'  => array( 'prompt_client_error', 429, 'Too Many Requests (429) - You have no credits remaining.', 'quota', 429 ),
			'rejected key'           => array( 'prompt_client_error', 401, 'Unauthorized (401) - Incorrect API key provided.', 'auth', 401 ),
			'provider 5xx'           => array( 'prompt_upstream_server_error', 503, 'Service Unavailable (503) - overloaded', 'unavailable', 503 ),
			'network'                => array( 'prompt_network_error', 503, 'cURL error 28: Operation timed out', 'unavailable', null ),
			'thrown, no status'      => array( 'openstation_ai_failed', null, 'Unexpected OpenAI API response: Missing the "choices" key.', 'other', null ),
		);
	}

	public function test_clean_list_normalizes_model_output() {
		$out = openstation_drafts_clean_list(
			array( '  spaced  ', '<b>bold</b>', '', array( 'nested' ), 'third', 'fourth' ),
			3
		);

		$this->assertSame( array( 'spaced', 'bold', 'third' ), $out );
	}
}
