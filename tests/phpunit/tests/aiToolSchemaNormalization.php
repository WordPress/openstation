<?php
/**
 * Tests for `desktop_mode_ai_normalize_tool_schema()` — the projection that keeps
 * one ability's legal-but-unsupported input schema from 400-ing the whole
 * assistant.
 *
 * The function is pure (no network, no registry), so each rejected JSON Schema
 * shape can be asserted directly. Every case here is a schema the Abilities API
 * accepts and the provider's tool-schema validator rejects.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group desktop-mode
 * @group desktop-mode-ai
 */
class Tests_DesktopMode_AiToolSchemaNormalization extends WP_UnitTestCase {

	/**
	 * A `type` array (an ability's GET/null run-path) becomes the literal
	 * "object" the provider requires at the top level.
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_type_union_becomes_object() {
		$out = desktop_mode_ai_normalize_tool_schema( array(
			'type'       => array( 'object', 'null' ),
			'properties' => array( 'range' => array( 'type' => 'integer' ) ),
		) );

		$this->assertSame( 'object', $out['type'] );
		// The rest of the schema is preserved.
		$this->assertSame(
			array( 'range' => array( 'type' => 'integer' ) ),
			$out['properties']
		);
	}

	/**
	 * Top-level oneOf / anyOf / allOf are stripped — the provider rejects them
	 * outright, and one such tool fails the entire request.
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_top_level_combinators_are_stripped() {
		$out = desktop_mode_ai_normalize_tool_schema( array(
			'type'  => 'object',
			'anyOf' => array(
				array( 'required' => array( 'post_id' ) ),
				array( 'required' => array( 'slug' ) ),
			),
			'oneOf' => array( array( 'const' => 1 ) ),
			'allOf' => array( array( 'const' => 2 ) ),
			'properties' => array(
				'post_id' => array( 'type' => 'integer' ),
				'slug'    => array( 'type' => 'string' ),
			),
		) );

		$this->assertArrayNotHasKey( 'anyOf', $out );
		$this->assertArrayNotHasKey( 'oneOf', $out );
		$this->assertArrayNotHasKey( 'allOf', $out );
		// The properties the combinator referenced survive — the model still
		// sees post_id and slug, and execute() still enforces "one of".
		$this->assertArrayHasKey( 'post_id', $out['properties'] );
		$this->assertArrayHasKey( 'slug', $out['properties'] );
	}

	/**
	 * A combinator NESTED inside a property is a real constraint the provider
	 * accepts — only the top level is projected.
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_nested_combinators_are_preserved() {
		$nested = array(
			'type'       => 'object',
			'properties' => array(
				'id' => array(
					'anyOf' => array(
						array( 'type' => 'integer' ),
						array( 'type' => 'null' ),
					),
				),
			),
		);

		$out = desktop_mode_ai_normalize_tool_schema( $nested );

		$this->assertArrayHasKey( 'anyOf', $out['properties']['id'] );
	}

	/**
	 * An empty PHP `properties` array (which would encode as `[]`) becomes an
	 * object, so the emitted JSON is `{}`.
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_empty_properties_array_becomes_object() {
		$out = desktop_mode_ai_normalize_tool_schema( array(
			'type'       => 'object',
			'properties' => array(),
		) );

		$this->assertIsObject( $out['properties'] );
		$this->assertSame( '{}', wp_json_encode( $out['properties'] ) );
	}

	/**
	 * A no-args ability (empty or non-array schema) becomes a valid empty object
	 * schema rather than passing nothing through.
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_empty_or_non_array_becomes_object_schema() {
		foreach ( array( array(), null, '', 0, false ) as $empty ) {
			$out = desktop_mode_ai_normalize_tool_schema( $empty );
			$this->assertSame( 'object', $out['type'] );
			$this->assertSame(
				'{"type":"object","properties":{}}',
				wp_json_encode( $out ),
				'empty/non-array input yields a provider-safe empty object schema'
			);
		}
	}

	/**
	 * Normalizing an already-normalized schema changes nothing — the projection
	 * is a fixed point, so it is safe to apply more than once (e.g. a plugin that
	 * also normalizes on the `desktop_mode_ai_tools` filter).
	 *
	 * @covers ::desktop_mode_ai_normalize_tool_schema
	 */
	public function test_idempotent() {
		$once  = desktop_mode_ai_normalize_tool_schema( array(
			'type'       => array( 'object', 'null' ),
			'anyOf'      => array( array( 'required' => array( 'a' ) ) ),
			'properties' => array(),
		) );
		$twice = desktop_mode_ai_normalize_tool_schema( $once );

		$this->assertEquals( $once, $twice );
		$this->assertSame( wp_json_encode( $once ), wp_json_encode( $twice ) );
	}
}
