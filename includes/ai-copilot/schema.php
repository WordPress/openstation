<?php
/**
 * OpenStation — AI Copilot: structured-output schema normalization.
 *
 * Every schema handed to `as_json_response()` becomes the provider's
 * structured-output contract (`output_format.schema` on Anthropic, the
 * equivalent response-schema field elsewhere). Providers validate that
 * contract in STRICT mode, which is narrower than JSON Schema: an object
 * subschema that does not say `additionalProperties: false` is rejected
 * outright —
 *
 *     Bad Request (400) - output_format.schema: For 'object' type,
 *     'additionalProperties' must be explicitly set to false
 *
 * — and the whole request fails, not just the offending branch. That is a
 * trap for the schemas we ship (one missing key anywhere in the tree kills
 * the feature) and worse for the filtered ones: `openstation_ai_schema_comment`,
 * `openstation_drafts_ai_schema`, and any plugin that adds a nested object
 * would otherwise have to know the provider's strict-mode rules to add a
 * property safely.
 *
 * So normalization runs at the choke point instead of relying on every
 * author getting it right: `openstation_ai_normalize_response_schema()`
 * walks the tree and stamps `additionalProperties: false` on every object
 * subschema, at every depth, after the filters have run.
 *
 * Tool INPUT schemas are a different contract with different rules — see
 * `openstation_ai_normalize_tool_schema()` in search.php.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Forces a structured-output schema into the strict shape providers require.
 *
 * The only rewrite is `additionalProperties: false` on object subschemas —
 * the key providers demand and JSON Schema treats as optional. A node counts
 * as an object when its `type` is (or includes) `"object"`, or when it
 * declares `properties` / `patternProperties` without a `type` at all. An
 * existing `additionalProperties` is overwritten: `true` and schema-shaped
 * values are exactly what strict mode rejects, so preserving them would only
 * preserve the 400.
 *
 * The walk is structure-aware, covering every position a subschema can
 * occupy: property values (maps keyed by PROPERTY NAME, so a property
 * literally called `items` is never mistaken for the keyword), `items` in
 * both single-schema and tuple form, `prefixItems`, `not`, the `oneOf` /
 * `allOf` / `anyOf` branches, and `$defs` / `definitions` pools.
 *
 * @param array $schema A structured-output (sub)schema.
 * @return array The schema with `additionalProperties: false` on every object node.
 */
function openstation_ai_normalize_response_schema( array $schema ) {
	if ( openstation_ai_schema_is_object_node( $schema ) ) {
		$schema['additionalProperties'] = false;
		if ( isset( $schema['properties'] ) && is_array( $schema['properties'] ) && array() !== $schema['properties'] ) {
			// Strict structured output (OpenAI `strict: true`) also
			// demands that `required` lists EVERY key in `properties` —
			// optional fields do not exist in strict mode, and one
			// missing key 400s the whole request ("'required' is
			// required to be supplied and to be an array including
			// every key in properties").
			$schema['required'] = array_keys( $schema['properties'] );
		}
	}

	foreach ( array( 'properties', 'patternProperties', '$defs', 'definitions' ) as $map_key ) {
		if ( isset( $schema[ $map_key ] ) && is_array( $schema[ $map_key ] ) ) {
			foreach ( $schema[ $map_key ] as $name => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $map_key ][ $name ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
		}
	}

	if ( isset( $schema['items'] ) && is_array( $schema['items'] ) ) {
		$items   = $schema['items'];
		$is_list = array_keys( $items ) === range( 0, count( $items ) - 1 );
		if ( $is_list && array() !== $items ) {
			// Tuple form — a list of schemas.
			foreach ( $items as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$items[ $i ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
			$schema['items'] = $items;
		} else {
			$schema['items'] = openstation_ai_normalize_response_schema( $items );
		}
	}

	foreach ( array( 'oneOf', 'allOf', 'anyOf', 'prefixItems' ) as $list_key ) {
		if ( isset( $schema[ $list_key ] ) && is_array( $schema[ $list_key ] ) ) {
			foreach ( $schema[ $list_key ] as $i => $sub ) {
				if ( is_array( $sub ) ) {
					$schema[ $list_key ][ $i ] = openstation_ai_normalize_response_schema( $sub );
				}
			}
		}
	}

	if ( isset( $schema['not'] ) && is_array( $schema['not'] ) ) {
		$schema['not'] = openstation_ai_normalize_response_schema( $schema['not'] );
	}

	return $schema;
}

/**
 * Whether a (sub)schema describes an object, and so needs the strict key.
 *
 * Covers the three ways a schema says "object": the literal type, a type
 * union that includes it (`array( 'object', 'null' )` — how a nullable
 * branch is usually written), and the untyped-but-shaped form that declares
 * `properties` with no `type` at all.
 *
 * @param array $schema A structured-output (sub)schema.
 * @return bool
 */
function openstation_ai_schema_is_object_node( array $schema ) {
	if ( isset( $schema['type'] ) ) {
		$types = is_array( $schema['type'] ) ? $schema['type'] : array( $schema['type'] );
		return in_array( 'object', $types, true );
	}

	return isset( $schema['properties'] ) || isset( $schema['patternProperties'] );
}
