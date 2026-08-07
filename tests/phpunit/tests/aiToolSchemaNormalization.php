<?php
/**
 * Tests for `openstation_ai_normalize_tool_schema()` — the projection that keeps
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
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiToolSchemaNormalization extends WP_UnitTestCase {

	/**
	 * A `type` array (an ability's GET/null run-path) becomes the literal
	 * "object" the provider requires at the top level.
	 *
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_type_union_becomes_object() {
		$out = openstation_ai_normalize_tool_schema( array(
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
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_top_level_combinators_are_stripped() {
		$out = openstation_ai_normalize_tool_schema( array(
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
	 * @covers ::openstation_ai_normalize_tool_schema
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

		$out = openstation_ai_normalize_tool_schema( $nested );

		$this->assertArrayHasKey( 'anyOf', $out['properties']['id'] );
	}

	/**
	 * An empty PHP `properties` array (which would encode as `[]`) becomes an
	 * object, so the emitted JSON is `{}`.
	 *
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_empty_properties_array_becomes_object() {
		$out = openstation_ai_normalize_tool_schema( array(
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
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_empty_or_non_array_becomes_object_schema() {
		foreach ( array( array(), null, '', 0, false ) as $empty ) {
			$out = openstation_ai_normalize_tool_schema( $empty );
			$this->assertSame( 'object', $out['type'] );
			$this->assertSame(
				'{"type":"object","properties":{}}',
				wp_json_encode( $out ),
				'empty/non-array input yields a provider-safe empty object schema'
			);
		}
	}

	/**
	 * A schema whose only content is a top-level combinator (nothing duplicated
	 * at the top level — e.g. `{ oneOf: [ { properties: … }, … ] }`) must not
	 * normalize to a bare `{"type":"object"}` with no `properties` key: the
	 * missing key is defaulted to an empty object so the emitted schema is
	 * always a complete object schema.
	 *
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_combinator_only_schema_gets_empty_properties() {
		$out = openstation_ai_normalize_tool_schema( array(
			'oneOf' => array(
				array(
					'properties' => array( 'post_id' => array( 'type' => 'integer' ) ),
					'required'   => array( 'post_id' ),
				),
				array(
					'properties' => array( 'slug' => array( 'type' => 'string' ) ),
					'required'   => array( 'slug' ),
				),
			),
		) );

		$this->assertSame(
			'{"type":"object","properties":{}}',
			wp_json_encode( $out ),
			'a combinator-only schema projects to a complete empty object schema'
		);
	}

	/**
	 * A non-empty schema that never declared `properties` (e.g. a bare
	 * `{ type: ['object','null'] }`) gains an empty-object `properties`.
	 *
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_missing_properties_key_is_defaulted() {
		$out = openstation_ai_normalize_tool_schema( array(
			'type' => array( 'object', 'null' ),
		) );

		$this->assertIsObject( $out['properties'] );
		$this->assertSame( '{}', wp_json_encode( $out['properties'] ) );
	}

	/**
	 * Normalizing an already-normalized schema changes nothing — the projection
	 * is a fixed point, so it is safe to apply more than once (e.g. a plugin that
	 * also normalizes on the `openstation_ai_tools` filter).
	 *
	 * @covers ::openstation_ai_normalize_tool_schema
	 */
	public function test_idempotent() {
		$once  = openstation_ai_normalize_tool_schema( array(
			'type'       => array( 'object', 'null' ),
			'anyOf'      => array( array( 'required' => array( 'a' ) ) ),
			'properties' => array(),
		) );
		$twice = openstation_ai_normalize_tool_schema( $once );

		$this->assertEquals( $once, $twice );
		$this->assertSame( wp_json_encode( $once ), wp_json_encode( $twice ) );
	}

	/**
	 * WordPress-only arg-schema keys (`sanitize_callback`,
	 * `validate_callback`, `arg_options`) are stripped at every depth.
	 * Strict providers reject any unknown field ("Invalid JSON payload
	 * received. Unknown name \"sanitize_callback\"") and 400 the whole
	 * request over one property.
	 *
	 * @covers ::openstation_ai_strip_wp_schema_keys
	 */
	public function test_wp_callback_keys_are_stripped_recursively() {
		$out = openstation_ai_normalize_tool_schema( array(
			'type'              => 'object',
			'sanitize_callback' => 'sanitize_text_field',
			'properties'        => array(
				'title' => array(
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
					'validate_callback' => 'rest_validate_request_arg',
				),
				'tags'  => array(
					'type'  => 'array',
					'items' => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_key',
					),
				),
				'meta'  => array(
					'type'                 => 'object',
					'arg_options'          => array( 'single' => true ),
					'additionalProperties' => array(
						'type'              => 'string',
						'validate_callback' => 'rest_validate_request_arg',
					),
				),
				'id'    => array(
					'anyOf' => array(
						array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						array( 'type' => 'string' ),
					),
				),
			),
		) );

		$this->assertStringNotContainsString( 'sanitize_callback', wp_json_encode( $out ) );
		$this->assertStringNotContainsString( 'validate_callback', wp_json_encode( $out ) );
		$this->assertStringNotContainsString( 'arg_options', wp_json_encode( $out ) );

		// The real schema content survives, including the NESTED anyOf.
		$this->assertSame( 'string', $out['properties']['title']['type'] );
		$this->assertSame( 'string', $out['properties']['tags']['items']['type'] );
		$this->assertSame( 'string', $out['properties']['meta']['additionalProperties']['type'] );
		$this->assertSame( 'integer', $out['properties']['id']['anyOf'][0]['type'] );
	}

	/**
	 * A property NAMED `sanitize_callback` is a legitimate property —
	 * the walk is structure-aware, so only schema-level keys are
	 * stripped, never property names.
	 *
	 * @covers ::openstation_ai_strip_wp_schema_keys
	 */
	public function test_property_named_like_a_callback_key_is_preserved() {
		$out = openstation_ai_normalize_tool_schema( array(
			'type'       => 'object',
			'properties' => array(
				'sanitize_callback' => array(
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		$this->assertArrayHasKey( 'sanitize_callback', $out['properties'] );
		$this->assertSame( 'string', $out['properties']['sanitize_callback']['type'] );
		$this->assertArrayNotHasKey(
			'sanitize_callback',
			$out['properties']['sanitize_callback']
		);
	}

	/**
	 * Tuple-form `items` (a list of schemas) is cleaned per entry.
	 *
	 * @covers ::openstation_ai_strip_wp_schema_keys
	 */
	public function test_tuple_items_are_cleaned_per_entry() {
		$out = openstation_ai_normalize_tool_schema( array(
			'type'       => 'object',
			'properties' => array(
				'pair' => array(
					'type'  => 'array',
					'items' => array(
						array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						array(
							'type'              => 'string',
							'validate_callback' => 'rest_validate_request_arg',
						),
					),
				),
			),
		) );

		$items = $out['properties']['pair']['items'];
		$this->assertSame( 'integer', $items[0]['type'] );
		$this->assertSame( 'string', $items[1]['type'] );
		$this->assertStringNotContainsString( 'sanitize_callback', wp_json_encode( $items ) );
		$this->assertStringNotContainsString( 'validate_callback', wp_json_encode( $items ) );
	}
}
