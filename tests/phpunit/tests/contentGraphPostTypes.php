<?php
/**
 * Tests for the Content Graph post-type descriptors.
 *
 * The node cards name a post in the singular ("Post · Author · Month")
 * while the toolbar chips use the plural, so every descriptor carries
 * both — including ones injected through the
 * `openstation_content_graph_post_types` filter without a `singular`.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group content-graph
 */
class Tests_OpenStation_ContentGraphPostTypes extends WP_UnitTestCase {

	public function test_descriptors_carry_singular_labels() {
		$types = openstation_content_graph_post_types();
		$post  = null;
		$page  = null;
		foreach ( $types as $entry ) {
			if ( 'post' === $entry['slug'] ) {
				$post = $entry;
			}
			if ( 'page' === $entry['slug'] ) {
				$page = $entry;
			}
		}

		$this->assertNotNull( $post );
		$this->assertNotNull( $page );
		$this->assertSame( 'Posts', $post['label'] );
		$this->assertSame( 'Post', $post['singular'] );
		$this->assertSame( 'Pages', $page['label'] );
		$this->assertSame( 'Page', $page['singular'] );
	}

	public function test_filtered_descriptor_without_singular_falls_back_to_label() {
		$inject = static function ( $types ) {
			$types[] = array(
				'slug'  => 'recipe',
				'label' => 'Recipes',
				'icon'  => 'dashicons-carrot',
			);
			return $types;
		};
		add_filter( 'openstation_content_graph_post_types', $inject );
		$types = openstation_content_graph_post_types();
		remove_filter( 'openstation_content_graph_post_types', $inject );

		$recipe = null;
		foreach ( $types as $entry ) {
			if ( 'recipe' === $entry['slug'] ) {
				$recipe = $entry;
			}
		}

		$this->assertNotNull( $recipe );
		$this->assertSame( 'Recipes', $recipe['singular'] );
		// The existing normalization still runs alongside it.
		$this->assertArrayHasKey( 'taxonomies', $recipe );
	}

	public function test_post_types_route_ships_singular() {
		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );

		$response = openstation_content_graph_rest_post_types();
		$data     = $response->get_data();

		$post = null;
		foreach ( $data as $entry ) {
			if ( 'post' === $entry['slug'] ) {
				$post = $entry;
			}
		}

		$this->assertNotNull( $post );
		$this->assertSame( 'Post', $post['singular'] );
		$this->assertArrayHasKey( 'count', $post );
	}
}
