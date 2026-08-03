<?php
/**
 * Tests for `open_station_ai_normalize_response_schema()` — the projection that
 * keeps a structured-output schema from 400-ing on providers that validate it
 * in strict mode ("For 'object' type, 'additionalProperties' must be explicitly
 * set to false").
 *
 * The function is pure (no network, no provider), so each shape can be asserted
 * directly. The schemas we ship are asserted here too: a missing key anywhere in
 * one of those trees kills the feature that uses it.
 *
 * @package WordPress
 * @subpackage UnitTests
 *
 * @group openstation
 * @group os-ai
 */
class Tests_OpenStation_AiResponseSchemaNormalization extends WP_UnitTestCase {

	/**
	 * The root object gets the key even when the schema never mentioned it.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_root_object_gets_additional_properties_false() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array( 'text' => array( 'type' => 'string' ) ),
				'required'   => array( 'text' ),
			)
		);

		$this->assertFalse( $out['additionalProperties'] );
		// Everything else is preserved.
		$this->assertSame( array( 'text' ), $out['required'] );
		$this->assertSame( array( 'type' => 'string' ), $out['properties']['text'] );
	}

	/**
	 * Scalar leaves are left alone — only object nodes carry the key.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_scalar_properties_are_untouched() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array(
					'count' => array( 'type' => 'integer' ),
					'tags'  => array( 'type' => 'array', 'items' => array( 'type' => 'string' ) ),
				),
			)
		);

		$this->assertArrayNotHasKey( 'additionalProperties', $out['properties']['count'] );
		$this->assertArrayNotHasKey( 'additionalProperties', $out['properties']['tags'] );
		$this->assertArrayNotHasKey( 'additionalProperties', $out['properties']['tags']['items'] );
	}

	/**
	 * A nested object under `properties` is normalized at its own depth —
	 * the provider rejects the request over any node in the tree, not just
	 * the root.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_nested_object_property_is_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array(
					'readiness' => array(
						'type'       => 'object',
						'properties' => array( 'summary' => array( 'type' => 'string' ) ),
					),
				),
			)
		);

		$this->assertFalse( $out['properties']['readiness']['additionalProperties'] );
	}

	/**
	 * Array `items` in single-schema form — the agents answer schema's
	 * `call_to_actions` shape.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_array_items_object_is_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array(
					'actions' => array(
						'type'  => 'array',
						'items' => array(
							'type'       => 'object',
							'properties' => array( 'id' => array( 'type' => 'string' ) ),
						),
					),
				),
			)
		);

		$this->assertFalse( $out['properties']['actions']['items']['additionalProperties'] );
	}

	/**
	 * Tuple-form `items` (a list of schemas) is walked entry by entry.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_tuple_items_are_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'  => 'array',
				'items' => array(
					array( 'type' => 'string' ),
					array( 'type' => 'object', 'properties' => array( 'id' => array( 'type' => 'string' ) ) ),
				),
			)
		);

		$this->assertArrayNotHasKey( 'additionalProperties', $out['items'][0] );
		$this->assertFalse( $out['items'][1]['additionalProperties'] );
	}

	/**
	 * Objects inside `anyOf` / `oneOf` / `allOf` branches — how a nullable
	 * object is usually written.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_combinator_branches_are_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array(
					'entity' => array(
						'anyOf' => array(
							array( 'type' => 'object', 'properties' => array( 'id' => array( 'type' => 'integer' ) ) ),
							array( 'type' => 'null' ),
						),
					),
					'either' => array(
						'oneOf' => array( array( 'type' => 'object', 'properties' => array() ) ),
					),
					'merged' => array(
						'allOf' => array( array( 'type' => 'object', 'properties' => array() ) ),
					),
				),
			)
		);

		$this->assertFalse( $out['properties']['entity']['anyOf'][0]['additionalProperties'] );
		$this->assertArrayNotHasKey( 'additionalProperties', $out['properties']['entity']['anyOf'][1] );
		$this->assertFalse( $out['properties']['either']['oneOf'][0]['additionalProperties'] );
		$this->assertFalse( $out['properties']['merged']['allOf'][0]['additionalProperties'] );
	}

	/**
	 * A type UNION that includes "object" still needs the key.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_type_union_including_object_is_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => array( 'object', 'null' ),
				'properties' => array( 'id' => array( 'type' => 'integer' ) ),
			)
		);

		$this->assertFalse( $out['additionalProperties'] );
	}

	/**
	 * An untyped node that declares `properties` is an object as far as the
	 * validator is concerned.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_untyped_node_with_properties_is_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array( 'properties' => array( 'id' => array( 'type' => 'integer' ) ) )
		);

		$this->assertFalse( $out['additionalProperties'] );
	}

	/**
	 * `true` and schema-shaped values are exactly what strict mode rejects,
	 * so an existing `additionalProperties` is overwritten rather than kept.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_permissive_additional_properties_is_overwritten() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'                 => 'object',
				'additionalProperties' => true,
				'properties'           => array(
					'nested' => array(
						'type'                 => 'object',
						'additionalProperties' => array( 'type' => 'string' ),
						'properties'           => array(),
					),
				),
			)
		);

		$this->assertFalse( $out['additionalProperties'] );
		$this->assertFalse( $out['properties']['nested']['additionalProperties'] );
	}

	/**
	 * A property literally named `items` / `properties` is a property, not a
	 * keyword — the walk is structure-aware.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_property_named_like_a_keyword_is_treated_as_a_property() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array(
					'items'      => array( 'type' => 'string' ),
					'properties' => array(
						'type'       => 'object',
						'properties' => array( 'colour' => array( 'type' => 'string' ) ),
					),
				),
			)
		);

		$this->assertSame( array( 'type' => 'string' ), $out['properties']['items'] );
		$this->assertFalse( $out['properties']['properties']['additionalProperties'] );
		$this->assertArrayNotHasKey(
			'additionalProperties',
			$out['properties']['properties']['properties']['colour']
		);
	}

	/**
	 * `$defs` / `definitions` pools are walked too — a `$ref` target is a
	 * schema the validator sees.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_definition_pools_are_normalized() {
		$out = open_station_ai_normalize_response_schema(
			array(
				'type'  => 'object',
				'$defs' => array(
					'link' => array( 'type' => 'object', 'properties' => array( 'url' => array( 'type' => 'string' ) ) ),
				),
			)
		);

		$this->assertFalse( $out['$defs']['link']['additionalProperties'] );
	}

	/**
	 * A schema that already complies is returned unchanged.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_compliant_schema_is_unchanged() {
		$schema = array(
			'type'                 => 'object',
			'additionalProperties' => false,
			'required'             => array( 'text' ),
			'properties'           => array( 'text' => array( 'type' => 'string' ) ),
		);

		$this->assertSame( $schema, open_station_ai_normalize_response_schema( $schema ) );
	}

	/**
	 * The agents answer schema is compliant as written — the shape that
	 * produced the original 400.
	 *
	 * @covers ::open_station_agent_answer_schema
	 */
	public function test_agent_answer_schema_is_strict() {
		$schema = open_station_agent_answer_schema();

		$this->assertFalse( $schema['additionalProperties'] );
		$this->assertFalse( $schema['properties']['call_to_actions']['items']['additionalProperties'] );
		// OpenAI strict mode: `required` must list EVERY property.
		// `style` missing from the items' required (and call_to_actions
		// from the root's) was the second 400 after additionalProperties.
		$this->assertSame(
			array_keys( $schema['properties'] ),
			$schema['required']
		);
		$items = $schema['properties']['call_to_actions']['items'];
		$this->assertSame( array_keys( $items['properties'] ), $items['required'] );
		$this->assertSame( $schema, open_station_ai_normalize_response_schema( $schema ) );
	}

	/**
	 * A partial `required` list is repaired to cover every property —
	 * strict mode has no optional fields ("'required' is required to be
	 * supplied and to be an array including every key in properties").
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_partial_required_is_repaired() {
		$schema = array(
			'type'       => 'object',
			'properties' => array(
				'text'  => array( 'type' => 'string' ),
				'items' => array(
					'type'  => 'array',
					'items' => array(
						'type'       => 'object',
						'properties' => array(
							'label' => array( 'type' => 'string' ),
							'style' => array( 'type' => 'string' ),
						),
						'required'   => array( 'label' ),
					),
				),
			),
			'required'   => array( 'text' ),
		);

		$normalized = open_station_ai_normalize_response_schema( $schema );
		$this->assertSame( array( 'text', 'items' ), $normalized['required'] );
		$this->assertSame(
			array( 'label', 'style' ),
			$normalized['properties']['items']['items']['required']
		);
	}

	/**
	 * Every schema we hand to `as_json_response()` is already strict, so
	 * normalization is a safety net rather than a load-bearing rewrite.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_shipped_schemas_are_strict_as_written() {
		$post = self::factory()->post->create_and_get( array( 'post_status' => 'draft' ) );

		$schemas = array(
			'copilot answer' => open_station_ai_search_answer_schema(),
			'comment'        => open_station_ai_schema_comment(),
			'drafts'         => open_station_drafts_ai_schema( $post ),
		);

		foreach ( $schemas as $label => $schema ) {
			$this->assertSame(
				$schema,
				open_station_ai_normalize_response_schema( $schema ),
				"The {$label} schema is not strict as written."
			);
		}
	}

	/**
	 * A plugin that adds a nested object through a documented schema filter
	 * can't break the request by omitting the provider-only key.
	 *
	 * @covers ::open_station_ai_normalize_response_schema
	 */
	public function test_filtered_schema_addition_is_repaired() {
		$add_field = static function ( $schema ) {
			$schema['properties']['compliance'] = array(
				'type'       => 'object',
				'properties' => array( 'flagged' => array( 'type' => 'boolean' ) ),
			);
			return $schema;
		};

		add_filter( 'open_station_ai_schema_comment', $add_field );
		$schema = open_station_ai_normalize_response_schema( open_station_ai_schema_comment() );
		remove_filter( 'open_station_ai_schema_comment', $add_field );

		$this->assertFalse( $schema['properties']['compliance']['additionalProperties'] );
	}
}
