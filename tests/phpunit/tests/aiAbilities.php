<?php
/**
 * Tests for the AI Copilot's WordPress Abilities.
 *
 * Covers registration (category + abilities with populated schemas), the
 * permission gates that replaced the old capability checks, execute()
 * round-trips (including output-schema validation), and the tool-name mapping
 * the agent loop relies on.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiAbilities extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		if ( ! function_exists( 'wp_get_ability' ) ) {
			$this->markTestSkipped( 'Abilities API not available (requires WordPress 7.0+).' );
		}
	}

	/**
	 * The Copilot offers every registered read-only ability (its own plus any
	 * Core/third-party read-only ability), and nothing that isn't read-only.
	 *
	 * @covers ::openstation_ai_search_ability_names
	 */
	public function test_only_readonly_abilities_are_offered() {
		$names = openstation_ai_search_ability_names();

		$this->assertContains( 'desktop-mode/search-posts', $names );

		foreach ( $names as $name ) {
			$meta = (array) wp_get_ability( $name )->get_meta();
			$this->assertTrue(
				! empty( $meta['annotations']['readonly'] ),
				"Only read-only abilities should be offered; {$name} is not." )
			;
		}
	}

	/**
	 * @covers ::openstation_ai_register_ability_category
	 */
	public function test_category_is_registered() {
		$this->assertInstanceOf( 'WP_Ability_Category', wp_get_ability_category( 'openstation' ) );
	}

	/**
	 * Every Copilot ability is registered under the openstation category
	 * with a non-empty description and input + output schemas.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_all_abilities_registered_with_schemas() {
		$names = array_merge(
			openstation_ai_search_ability_names(),
			array( 'desktop-mode/analyze-comment' )
		);

		foreach ( $names as $name ) {
			$ability = wp_get_ability( $name );
			$this->assertInstanceOf( 'WP_Ability', $ability, "Ability {$name} should be registered." );
			$this->assertSame( 'openstation', $ability->get_category(), "Ability {$name} in openstation category." );
			$this->assertNotEmpty( $ability->get_description(), "Ability {$name} has a description." );
			$this->assertNotEmpty( $ability->get_input_schema(), "Ability {$name} has an input schema." );
			$this->assertNotEmpty( $ability->get_output_schema(), "Ability {$name} has an output schema." );
		}
	}

	/**
	 * Tool names are the ability slug with the namespace stripped and dashes
	 * turned into underscores — reproducing the historical tool names.
	 *
	 * @covers ::openstation_ai_ability_tool_name
	 */
	public function test_tool_name_derivation() {
		$this->assertSame( 'search_posts', openstation_ai_ability_tool_name( 'desktop-mode/search-posts' ) );
		$this->assertSame( 'search_comments_by_post', openstation_ai_ability_tool_name( 'desktop-mode/search-comments-by-post' ) );
		$this->assertSame( 'get_php_error_log', openstation_ai_ability_tool_name( 'desktop-mode/get-php-error-log' ) );

		// Third-party names are normalized to a provider-safe [a-z0-9_] shape.
		$this->assertSame( 'sub_do_thing', openstation_ai_ability_tool_name( 'My-Plugin/sub/Do.Thing' ) );
		$this->assertMatchesRegularExpression( '/^[a-z0-9_]+$/', openstation_ai_ability_tool_name( 'x/A B!C' ) );
	}

	/**
	 * Two namespaces that strip to the same tool name must not both reach the
	 * provider as that name — it rejects the whole request ("Tool names must
	 * be unique"). OpenStation keeps the bare name even when the third-party
	 * ability registered first; the other keeps its namespace.
	 *
	 * @covers ::openstation_ai_unique_ability_tool_names
	 */
	public function test_colliding_tool_names_are_made_unique() {
		$map = openstation_ai_unique_ability_tool_names(
			array(
				'acme/get-site-context',
				'desktop-mode/get-site-context',
				'desktop-mode/search-posts',
				'other/get-site-context',
			)
		);

		$this->assertSame(
			array(
				'get_site_context'       => 'desktop-mode/get-site-context',
				'search_posts'           => 'desktop-mode/search-posts',
				'acme_get_site_context'  => 'acme/get-site-context',
				'other_get_site_context' => 'other/get-site-context',
			),
			$map
		);
	}

	/**
	 * A name that still collides once namespaced is dropped, never repeated.
	 *
	 * @covers ::openstation_ai_unique_ability_tool_names
	 */
	public function test_unresolvable_tool_name_collision_is_dropped() {
		$map = openstation_ai_unique_ability_tool_names(
			array( 'acme/do-thing', 'acme/do_thing', 'acme/Do.Thing' )
		);

		$this->assertSame(
			array(
				'do_thing'      => 'acme/do-thing',
				'acme_do_thing' => 'acme/do_thing',
			),
			$map
		);
	}

	/**
	 * A reader can execute the read-only search abilities; execute() passes
	 * output validation and returns the handler payload.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_search_posts_executes_for_reader() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$result = wp_get_ability( 'desktop-mode/search-posts' )->execute( array( 'query' => 'hello', 'offset' => 0 ) );

		$this->assertNotWPError( $result );
		$this->assertArrayHasKey( 'items', $result );
		$this->assertArrayHasKey( 'has_more', $result );
	}

	/**
	 * The error-log ability is gated on manage_options: a subscriber is
	 * cleanly refused (WP_Error, no fatal), an admin is allowed.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_error_log_ability_permission_gate() {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$denied = wp_get_ability( 'desktop-mode/get-php-error-log' )->execute( array( 'lines' => 10 ) );
		$this->assertWPError( $denied );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$allowed = wp_get_ability( 'desktop-mode/get-php-error-log' )->execute( array( 'lines' => 10 ) );
		$this->assertNotWPError( $allowed );
		$this->assertArrayHasKey( 'log_available', $allowed );
	}

	/**
	 * The comment-analysis ability requires moderate_comments.
	 *
	 * @covers ::openstation_ai_register_comment_analysis_ability
	 */
	public function test_analyze_comment_ability_requires_moderation_cap() {
		$comment_id = self::factory()->comment->create();

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$denied = wp_get_ability( 'desktop-mode/analyze-comment' )->execute( array( 'comment_id' => $comment_id ) );
		$this->assertWPError( $denied );
		$this->assertSame( 'ability_invalid_permissions', $denied->get_error_code() );
	}

	/**
	 * Only safe read-only abilities are exposed to external agents over MCP;
	 * the error log and comment analysis are not.
	 *
	 * @covers ::openstation_ai_register_abilities
	 */
	public function test_mcp_exposure_is_limited_to_safe_abilities() {
		$public = wp_get_ability( 'desktop-mode/search-posts' )->get_meta();
		$this->assertArrayHasKey( 'mcp', $public );
		$this->assertTrue( $public['mcp']['public'] );

		$private = wp_get_ability( 'desktop-mode/get-php-error-log' )->get_meta();
		$this->assertArrayNotHasKey( 'mcp', $private );
	}

	/**
	 * An image counts as used wherever the site points at it, in any
	 * status and through any of the copies WordPress makes of it, and a
	 * reference added after a first call is not served from the cache.
	 *
	 * @covers ::openstation_ai_find_unused_media
	 * @covers ::openstation_ai_media_references
	 */
	public function test_find_unused_media_skips_every_kind_of_reference() {
		$featured = $this->make_image( 'featured.jpg' );
		$in_draft = $this->make_image( 'in-draft.jpg' );
		$sized    = $this->make_image( 'sized-scaled.jpg' );
		$logo     = $this->make_image( 'logo.png' );
		$gallery  = $this->make_image( 'gallery.jpg' );
		$unused   = $this->make_image( 'unused.jpg' );
		$later    = $this->make_image( 'later.jpg' );

		update_post_meta( self::factory()->post->create(), '_thumbnail_id', $featured );
		self::factory()->post->create(
			array(
				'post_status'  => 'draft',
				'post_content' => '<!-- wp:image {"id":' . $in_draft . '} --><figure><img class="wp-image-' . $in_draft . '"/></figure><!-- /wp:image -->',
			)
		);
		self::factory()->post->create(
			array(
				'post_type'    => 'wp_template_part',
				'post_content' => '<img src="https://example.org/wp-content/uploads/2026/01/sized-1024x768.jpg"/>',
			)
		);
		self::factory()->post->create(
			array(
				'post_status'  => 'trash',
				'post_content' => '<!-- wp:gallery {"ids":[' . $gallery . ']} /-->',
			)
		);
		set_theme_mod( 'custom_logo', $logo );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$this->assertWPError( wp_get_ability( 'desktop-mode/find-unused-media' )->execute( array( 'offset' => 0 ) ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$result = wp_get_ability( 'desktop-mode/find-unused-media' )->execute( array( 'offset' => 0 ) );
		$this->assertEqualsCanonicalizing( array( $unused, $later ), wp_list_pluck( $result['items'], 'id' ) );
		$this->assertSame( 2, $result['total'] );

		self::factory()->post->create( array( 'post_content' => '<img class="wp-image-' . $later . '"/>' ) );
		$result = wp_get_ability( 'desktop-mode/find-unused-media' )->execute( array( 'offset' => 0 ) );
		$this->assertSame( array( $unused ), wp_list_pluck( $result['items'], 'id' ) );
	}

	/**
	 * An Author never gets an item attached to a post they cannot read,
	 * and an item's places (and their count) leave out the posts they
	 * cannot read.
	 *
	 * @covers ::openstation_ai_search_media
	 */
	public function test_search_media_leaves_out_what_the_caller_cannot_read() {
		$editor  = self::factory()->user->create( array( 'role' => 'editor' ) );
		$public  = self::factory()->post->create( array( 'post_author' => $editor ) );
		$draft   = self::factory()->post->create(
			array(
				'post_author' => $editor,
				'post_status' => 'draft',
			)
		);
		$private = self::factory()->post->create(
			array(
				'post_author' => $editor,
				'post_status' => 'private',
			)
		);

		$image  = $this->make_image( 'paella.jpg' );
		$hidden = $this->make_image( 'paella-secret.jpg', $private );
		update_post_meta( $public, '_thumbnail_id', $image );
		update_post_meta( $draft, '_thumbnail_id', $image );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertWPError( wp_get_ability( 'desktop-mode/search-media' )->execute( array( 'query' => 'paella', 'offset' => 0 ) ) );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'author' ) ) );
		$result = wp_get_ability( 'desktop-mode/search-media' )->execute( array( 'query' => 'paella', 'offset' => 0 ) );
		$items  = array_column( $result['items'], null, 'id' );

		$this->assertArrayNotHasKey( $hidden, $items );
		$this->assertSame( 1, $items[ $image ]['used_in_count'] );
		$this->assertSame( 'featured', $items[ $image ]['used_in'][0]['used_as'] );
	}

	/**
	 * Creates an image attachment stored under `2026/01/<file>`.
	 *
	 * @param string $file   File name.
	 * @param int    $parent Parent post id.
	 * @return int Attachment id.
	 */
	private function make_image( $file, $parent = 0 ) {
		$id = self::factory()->attachment->create_object(
			$file,
			$parent,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_title'     => pathinfo( $file, PATHINFO_FILENAME ),
			)
		);
		update_post_meta( $id, '_wp_attached_file', '2026/01/' . $file );
		return $id;
	}
}
