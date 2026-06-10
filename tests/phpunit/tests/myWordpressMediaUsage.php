<?php
/**
 * Tests for the `/desktop-mode/v1/media-usage/<id>` REST endpoint.
 *
 * Seeds an attachment plus three posts that reference it three
 * different ways (featured image, embedded URL, embedded block
 * class) and asserts the endpoint returns the expected rows with
 * correct `usedAs` tags. Also covers capability gating
 * (subscribers don't see drafts they can't read) and the
 * transient cache (second call hits cache).
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-my-wordpress
 */
class Tests_DesktopMode_MyWordpressMediaUsage extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;
	private $attachment_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		wp_set_current_user( $this->admin_id );

		do_action( 'rest_api_init' );

		// Build a real attachment with a fake file URL.
		$this->attachment_id = self::factory()->attachment->create_object(
			'sample-photo.jpg',
			0,
			array(
				'post_mime_type' => 'image/jpeg',
				'post_type'      => 'attachment',
				'post_status'    => 'inherit',
				'post_title'     => 'Sample photo',
			)
		);
		update_post_meta( $this->attachment_id, '_wp_attached_file', '2026/01/sample-photo.jpg' );
	}

	public function tear_down() {
		// Use the shared cache-key helper so a future change to the
		// key scheme propagates here automatically.
		foreach ( desktop_mode_my_wordpress_media_usage_cache_buckets() as $bucket ) {
			delete_transient(
				desktop_mode_my_wordpress_media_usage_cache_key( $this->attachment_id, $bucket )
			);
		}
		remove_all_filters( 'desktop_mode_my_wordpress_media_usage' );
		remove_all_filters( 'desktop_mode_my_wordpress_media_usage_cache_ttl' );
		parent::tear_down();
	}

	private function dispatch( $id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/media-usage/' . (int) $id );
		return rest_get_server()->dispatch( $request );
	}

	/**
	 * @covers ::desktop_mode_my_wordpress_media_usage_build
	 */
	public function test_finds_featured_image_and_content_embeds_with_correct_usedAs() {
		$featured_post = self::factory()->post->create(
			array( 'post_status' => 'publish', 'post_title' => 'Featured' )
		);
		update_post_meta( $featured_post, '_thumbnail_id', $this->attachment_id );

		$content_post = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Content embed',
				'post_content' => '<p>See <img class="wp-image-' . $this->attachment_id . '" src="x"/>.</p>',
			)
		);

		// Unrelated post — must NOT appear.
		self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Unrelated',
				'post_content' => 'No image here.',
			)
		);

		$response = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( $this->attachment_id, $data['media']['id'] );

		$by_id = array();
		foreach ( $data['usedIn'] as $row ) {
			$by_id[ $row['postId'] ] = $row;
		}
		$this->assertArrayHasKey( $featured_post, $by_id );
		$this->assertArrayHasKey( $content_post, $by_id );
		$this->assertSame( 'featured', $by_id[ $featured_post ]['usedAs'] );
		$this->assertSame( 'content', $by_id[ $content_post ]['usedAs'] );
	}

	/**
	 * Subscriber cannot read drafts — so drafts referencing the
	 * attachment must be filtered out of their result set.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_build
	 */
	public function test_subscriber_does_not_see_drafts() {
		$draft = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Private draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $draft, '_thumbnail_id', $this->attachment_id );

		// Subscriber needs `read` cap on the attachment to call the
		// endpoint. The attachment status `inherit` is publicly
		// readable, so that gate passes.
		wp_set_current_user( $this->subscriber_id );

		$response = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $response->get_status() );
		$rows = $response->get_data()['usedIn'];

		$ids = wp_list_pluck( $rows, 'postId' );
		$this->assertNotContains( $draft, $ids );
	}

	/**
	 * Regression: the transient stores only the viewer-independent
	 * reference map, and the per-row `read_post` gate runs on every
	 * request. An Author and a Subscriber share the same 'read'
	 * cache bucket (neither has `edit_others_posts`) — a cache hit
	 * warmed during the Author's request must NOT serve the Author's
	 * own draft rows to the Subscriber.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_callback
	 * @covers ::desktop_mode_my_wordpress_media_usage_build
	 */
	public function test_cached_scan_does_not_leak_authors_draft_to_subscriber() {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$draft     = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Author-only draft',
				'post_author' => $author_id,
			)
		);
		update_post_meta( $draft, '_thumbnail_id', $this->attachment_id );

		// Warm the cache as the Author — they can read their own
		// draft, so the row is in THEIR response.
		wp_set_current_user( $author_id );
		$first = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $first->get_status() );
		$this->assertContains( $draft, wp_list_pluck( $first->get_data()['usedIn'], 'postId' ) );

		// Same warm cache, different viewer: the Subscriber shares
		// the 'read' bucket but must not inherit the Author's rows.
		wp_set_current_user( $this->subscriber_id );
		$second = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $second->get_status() );
		$this->assertNotContains( $draft, wp_list_pluck( $second->get_data()['usedIn'], 'postId' ) );
	}

	/**
	 * Second call returns the cached payload. We can't reliably
	 * compare query counts (cap checks run on every dispatch), so
	 * we verify cache presence directly and confirm the second
	 * dispatch returns the same payload — even after we mutate the
	 * underlying data, the cache must shield the response.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_callback
	 */
	public function test_transient_caches_result() {
		$post = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		update_post_meta( $post, '_thumbnail_id', $this->attachment_id );

		// Hold the action so the cache is NOT busted between
		// dispatches when we add the second post.
		remove_action( 'save_post', 'desktop_mode_my_wordpress_media_usage_bust_for_post' );

		$first = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $first->get_status() );
		$this->assertCount( 1, $first->get_data()['usedIn'] );

		// Cache key was written — read it through the same helper
		// the writer uses, so the test isn't coupled to the literal
		// key format.
		$cached = get_transient(
			desktop_mode_my_wordpress_media_usage_cache_key( $this->attachment_id, 'edit' )
		);
		$this->assertIsArray( $cached );

		// Add a second referencing post. With the bust hook removed,
		// the cache stays warm — the second dispatch must still see
		// the original 1-row payload.
		$post2 = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		update_post_meta( $post2, '_thumbnail_id', $this->attachment_id );

		$second = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $second->get_status() );
		$this->assertCount( 1, $second->get_data()['usedIn'] );
		$this->assertSame( $first->get_data()['usedIn'], $second->get_data()['usedIn'] );

		// Restore the cache-busting hook for the rest of the suite.
		add_action( 'save_post', 'desktop_mode_my_wordpress_media_usage_bust_for_post' );
	}

	/**
	 * Filter can extend the payload (ACF-style integration).
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_callback
	 */
	public function test_filter_can_extend_usedIn() {
		add_filter(
			'desktop_mode_my_wordpress_media_usage',
			static function ( $payload ) {
				$payload['usedIn'][] = array(
					'postId'        => 999,
					'postType'      => 'plugin-custom',
					'postTypeLabel' => 'Plugin Custom',
					'title'         => 'Synthetic',
					'status'        => 'publish',
					'link'          => '',
					'editLink'      => '',
					'usedAs'        => 'meta',
					'authorId'      => 0,
					'authorName'    => '',
					'date'          => '2026-01-01T00:00:00',
				);
				return $payload;
			}
		);

		$response = $this->dispatch( $this->attachment_id );
		$rows     = $response->get_data()['usedIn'];
		$ids      = wp_list_pluck( $rows, 'postId' );
		$this->assertContains( 999, $ids );
	}

	/**
	 * Regression: the LIKE-scan `%wp-image-12%` also matches
	 * `wp-image-123`. The PHP-side word-boundary recheck must
	 * reject the false positive.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_build
	 */
	public function test_word_boundary_excludes_numeric_prefix_matches() {
		// Stand up a post referencing a HIGHER-id attachment whose
		// number prefixes our subject attachment's id (e.g. subject
		// is 12, false-positive is 120). Order isn't guaranteed by
		// factory ids — we synthesize ids using string content.
		$subject_id = $this->attachment_id;
		$prefix_id  = $subject_id . '0'; // numerically distinct, prefix-overlapping

		$false_positive = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'False positive',
				'post_content' => '<p>Embed: <img class="wp-image-' . $prefix_id . '" src="x"/>.</p>',
			)
		);
		$true_positive = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'True positive',
				'post_content' => '<p>Embed: <img class="wp-image-' . $subject_id . '" src="x"/>.</p>',
			)
		);

		$response = $this->dispatch( $subject_id );
		$this->assertSame( 200, $response->get_status() );
		$ids = wp_list_pluck( $response->get_data()['usedIn'], 'postId' );
		$this->assertContains( $true_positive, $ids );
		$this->assertNotContains( $false_positive, $ids );
	}

	/**
	 * Regression: removing a `wp-image-N` block from a post must
	 * bust the cache for attachment N — otherwise the drill-in
	 * view shows that post as a reference until the TTL expires.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_bust_for_post
	 */
	public function test_reference_removal_busts_cache() {
		$post = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Has reference',
				'post_content' => '<p><img class="wp-image-' . $this->attachment_id . '" src="x"/></p>',
			)
		);

		// Warm the cache.
		$first = $this->dispatch( $this->attachment_id );
		$ids   = wp_list_pluck( $first->get_data()['usedIn'], 'postId' );
		$this->assertContains( $post, $ids );

		// Remove the reference. `wp_update_post` runs both
		// `pre_post_update` and `save_post`, so the union-of-refs
		// buster should clear the cache for attachment N.
		wp_update_post(
			array(
				'ID'           => $post,
				'post_content' => '<p>No more image.</p>',
			)
		);

		$second = $this->dispatch( $this->attachment_id );
		$ids    = wp_list_pluck( $second->get_data()['usedIn'], 'postId' );
		$this->assertNotContains( $post, $ids );
	}

	/**
	 * Regression: deleting a post that references an attachment
	 * must bust the cache for that attachment. We rely on the
	 * `before_delete_post` hook (NOT `deleted_post`, which fires
	 * after `_thumbnail_id` meta + the row itself are already
	 * gone) so the buster can still read the refs out of the
	 * about-to-be-deleted post.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_bust_for_post
	 */
	public function test_post_deletion_busts_attachment_cache() {
		$post = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_content' => '<img class="wp-image-' . $this->attachment_id . '" src="x"/>',
			)
		);

		// Warm the cache.
		$this->dispatch( $this->attachment_id );
		$cache_key = desktop_mode_my_wordpress_media_usage_cache_key(
			$this->attachment_id,
			'edit'
		);
		$this->assertIsArray( get_transient( $cache_key ) );

		// Force-delete the post — cache must be busted before the
		// post row + meta are wiped.
		wp_delete_post( $post, true );
		$this->assertFalse( get_transient( $cache_key ) );
	}

	/**
	 * Unknown attachment id is rejected by the permission callback
	 * (returns false → REST issues 403). The callback runs before
	 * the body fetch, so we never reach the 404-emitting branch in
	 * the callback — both outcomes are correct, the difference is
	 * which gate rejects first.
	 *
	 * @covers ::desktop_mode_my_wordpress_media_usage_callback
	 */
	public function test_unknown_attachment_returns_403_via_permission_gate() {
		$response = $this->dispatch( 999999 );
		$this->assertSame( 403, $response->get_status() );
	}
}
