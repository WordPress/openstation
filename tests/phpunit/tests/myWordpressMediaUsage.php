<?php

class Tests_OpenStation_MyWordpressMediaUsage extends WP_UnitTestCase {

	private $admin_id;
	private $subscriber_id;
	private $attachment_id;

	public function set_up() {
		parent::set_up();

		$this->admin_id      = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$this->subscriber_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );

		wp_set_current_user( $this->admin_id );

		do_action( 'rest_api_init' );

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

		foreach ( openstation_my_wordpress_media_usage_cache_buckets() as $bucket ) {
			delete_transient(
				openstation_my_wordpress_media_usage_cache_key( $this->attachment_id, $bucket )
			);
		}
		remove_all_filters( 'openstation_my_wordpress_media_usage' );
		remove_all_filters( 'openstation_my_wordpress_media_usage_cache_ttl' );
		parent::tear_down();
	}

	private function dispatch( $id ) {
		$request = new WP_REST_Request( 'GET', '/desktop-mode/v1/media-usage/' . (int) $id );
		return rest_get_server()->dispatch( $request );
	}

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

	public function test_subscriber_does_not_see_drafts() {
		$draft = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Private draft',
				'post_author' => $this->admin_id,
			)
		);
		update_post_meta( $draft, '_thumbnail_id', $this->attachment_id );

		wp_set_current_user( $this->subscriber_id );

		$response = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $response->get_status() );
		$rows = $response->get_data()['usedIn'];

		$ids = wp_list_pluck( $rows, 'postId' );
		$this->assertNotContains( $draft, $ids );
	}

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

		wp_set_current_user( $author_id );
		$first = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $first->get_status() );
		$this->assertContains( $draft, wp_list_pluck( $first->get_data()['usedIn'], 'postId' ) );

		wp_set_current_user( $this->subscriber_id );
		$second = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $second->get_status() );
		$this->assertNotContains( $draft, wp_list_pluck( $second->get_data()['usedIn'], 'postId' ) );
	}

	public function test_transient_caches_result() {
		$post = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		update_post_meta( $post, '_thumbnail_id', $this->attachment_id );

		remove_action( 'save_post', 'openstation_my_wordpress_media_usage_bust_for_post' );

		$first = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $first->get_status() );
		$this->assertCount( 1, $first->get_data()['usedIn'] );

		$cached = get_transient(
			openstation_my_wordpress_media_usage_cache_key( $this->attachment_id, 'edit' )
		);
		$this->assertIsArray( $cached );

		$post2 = self::factory()->post->create( array( 'post_status' => 'publish' ) );
		update_post_meta( $post2, '_thumbnail_id', $this->attachment_id );

		$second = $this->dispatch( $this->attachment_id );
		$this->assertSame( 200, $second->get_status() );
		$this->assertCount( 1, $second->get_data()['usedIn'] );
		$this->assertSame( $first->get_data()['usedIn'], $second->get_data()['usedIn'] );

		add_action( 'save_post', 'openstation_my_wordpress_media_usage_bust_for_post' );
	}

	public function test_filter_can_extend_usedIn() {
		add_filter(
			'openstation_my_wordpress_media_usage',
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

	public function test_word_boundary_excludes_numeric_prefix_matches() {

		$subject_id = $this->attachment_id;
		$prefix_id  = $subject_id . '0';

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

	public function test_reference_removal_busts_cache() {
		$post = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Has reference',
				'post_content' => '<p><img class="wp-image-' . $this->attachment_id . '" src="x"/></p>',
			)
		);

		$first = $this->dispatch( $this->attachment_id );
		$ids   = wp_list_pluck( $first->get_data()['usedIn'], 'postId' );
		$this->assertContains( $post, $ids );

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

	public function test_post_deletion_busts_attachment_cache() {
		$post = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_content' => '<img class="wp-image-' . $this->attachment_id . '" src="x"/>',
			)
		);

		$this->dispatch( $this->attachment_id );
		$cache_key = openstation_my_wordpress_media_usage_cache_key(
			$this->attachment_id,
			'edit'
		);
		$this->assertIsArray( get_transient( $cache_key ) );

		wp_delete_post( $post, true );
		$this->assertFalse( get_transient( $cache_key ) );
	}

	public function test_unknown_attachment_returns_403_via_permission_gate() {
		$response = $this->dispatch( 999999 );
		$this->assertSame( 403, $response->get_status() );
	}
}
