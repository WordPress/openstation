<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_AGENT_DRAFT_BRIEF_MAX = 2000;

const OPENSTATION_AGENT_DRAFT_NAME_MAX  = 80;
const OPENSTATION_AGENT_DRAFT_VIBES_MAX = 120;

function openstation_agent_draft( $brief, $user_id ) {
	$brief = trim( (string) $brief );
	if ( '' === $brief ) {
		return new WP_Error(
			'openstation_agent_draft_empty',
			__( 'Describe the agent first. A sentence is enough.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$roles     = array_values( openstation_agent_allowed_roles() );
	$catalogue = openstation_agents_abilities_catalogue();

	$draft = apply_filters( 'openstation_agent_draft', null, $brief, $roles, $catalogue, $user_id );

	if ( null === $draft ) {
		if ( ! function_exists( 'openstation_ai_client_generate' ) || ! openstation_ai_is_available() ) {
			return new WP_Error(
				'openstation_agent_ai_unavailable',
				__( 'The WordPress AI Client is not available on this site.', 'desktop-mode' ),
				array( 'status' => 503 )
			);
		}
		$draft = openstation_agent_draft_generate( $brief, $roles, $catalogue, (int) $user_id );
	}

	if ( is_wp_error( $draft ) ) {
		return $draft;
	}

	return openstation_agent_draft_sanitize( is_array( $draft ) ? $draft : array(), $roles, $catalogue );
}

function openstation_agent_draft_generate( $brief, array $roles, array $catalogue, $user_id ) {
	$messages     = array( openstation_ai_user_text_message( $brief ) );
	$schema       = openstation_agent_draft_answer_schema( $roles, wp_list_pluck( $catalogue, 'slug' ) );
	$instructions = openstation_agent_draft_instructions( $roles, $catalogue );

	$generated = openstation_agent_with_http_timeout(
		static function () use ( $user_id, $messages, $schema, $instructions ) {
			return openstation_ai_client_generate(
				$user_id,
				$messages,
				array(),
				$schema,
				$instructions,
				array( 'source' => 'agents/draft' )
			);
		}
	);

	if ( is_wp_error( $generated ) ) {
		$error = openstation_agent_humanize_generate_error( $generated );
		$data  = $error->get_error_data();
		if ( ! is_array( $data ) || ! isset( $data['status'] ) ) {

			$error->add_data( array_merge( is_array( $data ) ? $data : array(), array( 'status' => 502 ) ) );
		}
		return $error;
	}

	$text   = isset( $generated['text'] ) && is_string( $generated['text'] ) ? $generated['text'] : '';
	$parsed = json_decode( $text, true );
	if ( ! is_array( $parsed ) ) {
		return new WP_Error(
			'openstation_agent_draft_parse',
			__( 'The draft came back in a shape that could not be read. Try again, or fill the fields in yourself.', 'desktop-mode' ),
			array(
				'status' => 502,
				'detail' => mb_substr( $text, 0, 200 ),
			)
		);
	}
	return $parsed;
}

function openstation_agent_draft_answer_schema( array $roles, array $ability_slugs ) {
	$role = array(
		'type'        => 'string',
		'description' => 'The least-privileged role that still lets the agent do its job.',
	);
	if ( ! empty( $roles ) ) {
		$role['enum'] = array_values( array_map( 'strval', $roles ) );
	}
	$ability = array( 'type' => 'string' );
	if ( ! empty( $ability_slugs ) ) {
		$ability['enum'] = array_values( array_map( 'strval', $ability_slugs ) );
	}
	return array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'name', 'description', 'vibes', 'instructions', 'role', 'abilities' ),
		'properties'           => array(
			'name'         => array(
				'type'        => 'string',
				'description' => 'A short working name for the agent, four words at most.',
			),
			'description'  => array(
				'type'        => 'string',
				'description' => 'One sentence saying when to reach for this agent.',
			),
			'vibes'        => array(
				'type'        => 'string',
				'description' => 'The agent\'s voice in a few words, lowercase, no full stop. Examples: "blunt, precise, no sugarcoating" or "warm, reads the room".',
			),
			'instructions' => array(
				'type'        => 'string',
				'description' => 'The agent system prompt. Concrete, scoped to the brief, written to the agent in the second person.',
			),
			'role'         => $role,
			'abilities'    => array(
				'type'        => 'array',
				'description' => 'Only the abilities the brief genuinely needs. Empty when it needs none.',
				'items'       => $ability,
			),
		),
	);
}

function openstation_agent_draft_instructions( array $roles, array $catalogue ) {
	$lines = array(
		'The user is a WordPress administrator defining a new site agent: a durable AI worker that lives on the site as a user, acts through registered abilities under its own role, and answers in a chat window.',
		'Treat the user\'s message as the agent brief and fill in the agent definition.',
		'name: a short working name for the agent, four words at most.',
		'description: one sentence saying when to reach for this agent.',
		'vibes: the agent\'s voice in a few words, lowercase, no full stop.',
		'instructions: the agent system prompt. Concrete, scoped to the brief, written to the agent. Say what it should watch, what it should write, where it may act, and what it must never do.',
		'role: the least-privileged fit among: ' . implode( ', ', array_map( 'strval', $roles ) ) . '.',
		'abilities: only the slugs the brief genuinely needs, from this catalogue:',
	);
	if ( empty( $catalogue ) ) {
		$lines[] = '(no abilities are registered on this site; return an empty list)';
	}
	foreach ( $catalogue as $row ) {
		$slug  = isset( $row['slug'] ) ? (string) $row['slug'] : '';
		$label = isset( $row['label'] ) ? (string) $row['label'] : '';
		if ( '' === $slug ) {
			continue;
		}
		$lines[] = sprintf(
			'- %s: %s%s',
			$slug,
			$label,
			empty( $row['readonly'] ) ? ' (can modify the site)' : ''
		);
	}
	return implode( "\n", $lines );
}

function openstation_agent_draft_sanitize( array $draft, array $roles, array $catalogue ) {
	$str = static function ( $value, $max ) {
		return is_string( $value ) ? mb_substr( trim( sanitize_text_field( $value ) ), 0, $max ) : '';
	};

	$role = isset( $draft['role'] ) && is_string( $draft['role'] ) ? sanitize_key( $draft['role'] ) : '';
	if ( ! in_array( $role, array_map( 'strval', $roles ), true ) ) {
		$role = '';
	}

	$known     = array_map( 'strval', wp_list_pluck( $catalogue, 'slug' ) );
	$abilities = array();
	if ( isset( $draft['abilities'] ) && is_array( $draft['abilities'] ) ) {
		foreach ( $draft['abilities'] as $slug ) {
			if ( is_string( $slug ) && in_array( $slug, $known, true ) && ! in_array( $slug, $abilities, true ) ) {
				$abilities[] = $slug;
			}
		}
	}

	return array(
		'name'         => $str( $draft['name'] ?? '', OPENSTATION_AGENT_DRAFT_NAME_MAX ),
		'description'  => $str( $draft['description'] ?? '', 500 ),
		'vibes'        => $str( $draft['vibes'] ?? '', OPENSTATION_AGENT_DRAFT_VIBES_MAX ),
		'instructions' => isset( $draft['instructions'] ) && is_string( $draft['instructions'] )
			? trim( sanitize_textarea_field( $draft['instructions'] ) )
			: '',
		'role'         => $role,
		'abilities'    => $abilities,
	);
}
