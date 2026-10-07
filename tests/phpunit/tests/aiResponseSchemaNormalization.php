<?php

class Tests_OpenStation_AiResponseSchemaNormalization extends WP_UnitTestCase {

	public function test_root_object_gets_additional_properties_false() {
		$out = openstation_ai_normalize_response_schema(
			array(
				'type'       => 'object',
				'properties' => array( 'text' => array( 'type' => 'string' ) ),
				'required'   => array( 'text' ),
			)
		);

		$this->assertFalse( $out['additionalProperties'] );

		$this->assertSame( array( 'text' ), $out['required'] );
		$this->assertSame( array( 'type' => 'string' ), $out['properties']['text'] );
	}

	public function test_scalar_properties_are_untouched() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_nested_object_property_is_normalized() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_array_items_object_is_normalized() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_tuple_items_are_normalized() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_combinator_branches_are_normalized() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_type_union_including_object_is_normalized() {
		$out = openstation_ai_normalize_response_schema(
			array(
				'type'       => array( 'object', 'null' ),
				'properties' => array( 'id' => array( 'type' => 'integer' ) ),
			)
		);

		$this->assertFalse( $out['additionalProperties'] );
	}

	public function test_untyped_node_with_properties_is_normalized() {
		$out = openstation_ai_normalize_response_schema(
			array( 'properties' => array( 'id' => array( 'type' => 'integer' ) ) )
		);

		$this->assertFalse( $out['additionalProperties'] );
	}

	public function test_permissive_additional_properties_is_overwritten() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_property_named_like_a_keyword_is_treated_as_a_property() {
		$out = openstation_ai_normalize_response_schema(
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

	public function test_definition_pools_are_normalized() {
		$out = openstation_ai_normalize_response_schema(
			array(
				'type'  => 'object',
				'$defs' => array(
					'link' => array( 'type' => 'object', 'properties' => array( 'url' => array( 'type' => 'string' ) ) ),
				),
			)
		);

		$this->assertFalse( $out['$defs']['link']['additionalProperties'] );
	}

	public function test_compliant_schema_is_unchanged() {
		$schema = array(
			'type'                 => 'object',
			'additionalProperties' => false,
			'required'             => array( 'text' ),
			'properties'           => array( 'text' => array( 'type' => 'string' ) ),
		);

		$this->assertSame( $schema, openstation_ai_normalize_response_schema( $schema ) );
	}

	public function test_agent_answer_schema_is_strict() {
		$schema = openstation_agent_answer_schema();

		$this->assertFalse( $schema['additionalProperties'] );
		$this->assertFalse( $schema['properties']['call_to_actions']['items']['additionalProperties'] );

		$this->assertSame(
			array_keys( $schema['properties'] ),
			$schema['required']
		);
		$items = $schema['properties']['call_to_actions']['items'];
		$this->assertSame( array_keys( $items['properties'] ), $items['required'] );
		$this->assertSame( $schema, openstation_ai_normalize_response_schema( $schema ) );
	}

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

		$normalized = openstation_ai_normalize_response_schema( $schema );
		$this->assertSame( array( 'text', 'items' ), $normalized['required'] );
		$this->assertSame(
			array( 'label', 'style' ),
			$normalized['properties']['items']['items']['required']
		);
	}

	public function test_shipped_schemas_are_strict_as_written() {
		$post = self::factory()->post->create_and_get( array( 'post_status' => 'draft' ) );

		$schemas = array(
			'copilot answer' => openstation_ai_search_answer_schema(),
			'comment'        => openstation_ai_schema_comment(),
			'drafts'         => openstation_drafts_ai_schema( $post ),
		);

		foreach ( $schemas as $label => $schema ) {
			$this->assertSame(
				$schema,
				openstation_ai_normalize_response_schema( $schema ),
				"The {$label} schema is not strict as written."
			);
		}
	}

	public function test_filtered_schema_addition_is_repaired() {
		$add_field = static function ( $schema ) {
			$schema['properties']['compliance'] = array(
				'type'       => 'object',
				'properties' => array( 'flagged' => array( 'type' => 'boolean' ) ),
			);
			return $schema;
		};

		add_filter( 'openstation_ai_schema_comment', $add_field );
		$schema = openstation_ai_normalize_response_schema( openstation_ai_schema_comment() );
		remove_filter( 'openstation_ai_schema_comment', $add_field );

		$this->assertFalse( $schema['properties']['compliance']['additionalProperties'] );
	}
}
