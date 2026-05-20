<?php
/**
 * Desktop Mode — Agents: behaviour layer (`wp_guideline` storage).
 *
 * Each agent is a `wp_guideline` post tagged with the `skill` term, the
 * shared shape Artur Piszek's agent ecosystem (Dolly, Intelligence,
 * Push MD) already consumes. Field semantics — verbatim from Push MD's
 * `wp_install_skill()` + `format_skill_markdown()`:
 *
 *   - `post_title`   = agent display name (wp-admin label only — NOT
 *                      projected to pushmd's SKILL.md front-matter).
 *   - `post_excerpt` = "when to use this agent" short description.
 *                      Push MD projects this as the YAML `description:`
 *                      field in the SKILL.md front-matter.
 *   - `post_content` = system prompt / instructions (raw markdown,
 *                      `wp_kses_post`'d on write).
 *   - `post_name`    = stable slug. This drives BOTH the projection
 *                      path `wp_guideline/skills/<slug>/SKILL.md` AND
 *                      the YAML `name:` field in the front-matter —
 *                      it is the user-visible identifier other agent
 *                      runtimes (Claude Code, Codex, Cursor) see.
 *   - `post_author`  = the agent's `wp_users.ID` (Layer 1) so
 *                      revisions and comments attribute to the agent.
 *   - taxonomy term  = `wp_guideline_type:skill`.
 *   - meta `guideline_source` = `'desktop-mode/<slug>'` — Push MD
 *                      idempotency key. Flat string, NO leading
 *                      underscore (this is intentional; Push MD
 *                      treats it as a public identifier).
 *   - meta `_desktop_mode_skill_abilities` = ability slugs the operator
 *                      enabled (PROVISIONAL namespace — no public
 *                      Automattic convention exists for
 *                      ability-allowlists on skill posts yet; migrate
 *                      when one is published).
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Source-identifier prefix for guidelines this plugin owns.
 *
 * Per-agent identifiers are `desktop-mode/<slug>` — used as the unique
 * key for `wp_install_skill()`'s upsert behaviour.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENTS_GUIDELINE_SOURCE_PREFIX = 'desktop-mode/';

/**
 * Post-meta key storing the multi-ability allowlist on a skill guideline.
 *
 * Provisional namespace — see file-level doc. Stored as a JSON array in
 * a single meta row (`single = true`, `type = array`) so REST round-trips
 * cleanly and revisions snapshot it as one value.
 *
 * @since 0.23.0
 */
const DESKTOP_MODE_AGENTS_ABILITIES_META_KEY = '_desktop_mode_skill_abilities';

/**
 * Seed the `skill` taxonomy term on init priority 11.
 *
 * Priority 11 runs after `wp_guideline_type`'s registration (Gutenberg
 * + agents-api both register on priority 9–10). The ecosystem
 * convention is to call `wp_insert_term()` directly rather than use the
 * `wp_guideline_types` filter (the filter is documented but unused in
 * practice — Intelligence, Push MD, and agents-api all seed terms via
 * `wp_insert_term()`).
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agents_seed_skill_term() {
	if ( ! taxonomy_exists( 'wp_guideline_type' ) ) {
		return;
	}
	if ( ! term_exists( 'skill', 'wp_guideline_type' ) ) {
		wp_insert_term(
			_x( 'Skill', 'Guideline type term', 'desktop-mode' ),
			'wp_guideline_type',
			array( 'slug' => 'skill' )
		);
	}
}
add_action( 'init', 'desktop_mode_agents_seed_skill_term', 11 );

/**
 * Sanitize an array of ability slugs.
 *
 * Drops non-string entries, trims, sanitizes each via
 * `sanitize_text_field`, dedupes, and re-indexes — keeps the meta row a
 * canonical list with no surprises for JSON consumers.
 *
 * @since 0.23.0
 *
 * @param mixed $value Raw incoming value.
 * @return string[]
 */
function desktop_mode_agents_sanitize_ability_slugs( $value ) {
	if ( ! is_array( $value ) ) {
		return array();
	}
	$out = array();
	foreach ( $value as $slug ) {
		if ( ! is_string( $slug ) ) {
			continue;
		}
		$clean = sanitize_text_field( $slug );
		if ( '' === $clean ) {
			continue;
		}
		$out[] = $clean;
	}
	return array_values( array_unique( $out ) );
}

/**
 * Register the abilities-allowlist meta on `wp_guideline`.
 *
 * Stored single-but-array so the JSON API representation is one array,
 * round-trips cleanly through REST `meta` payloads, and revisions take
 * one snapshot per change instead of N. Auth gates writes behind
 * `edit_posts` — same cap that gates editing the underlying guideline.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agents_register_meta() {
	if ( ! post_type_exists( 'wp_guideline' ) ) {
		return;
	}
	register_post_meta(
		'wp_guideline',
		DESKTOP_MODE_AGENTS_ABILITIES_META_KEY,
		array(
			'type'              => 'array',
			'single'            => true,
			'default'           => array(),
			'show_in_rest'      => array(
				'schema' => array(
					'type'  => 'array',
					'items' => array(
						'type' => 'string',
					),
				),
			),
			'sanitize_callback' => 'desktop_mode_agents_sanitize_ability_slugs',
			'auth_callback'     => function () {
				return current_user_can( 'edit_posts' );
			},
		)
	);
}
add_action( 'init', 'desktop_mode_agents_register_meta', 11 );

/**
 * Resolve the `skill` term id, cached for the request.
 *
 * @since 0.23.0
 *
 * @return int Term id, or 0 if the taxonomy / term doesn't exist.
 */
function desktop_mode_agents_skill_term_id() {
	static $cached = null;
	if ( null !== $cached ) {
		return $cached;
	}
	if ( ! taxonomy_exists( 'wp_guideline_type' ) ) {
		$cached = 0;
		return 0;
	}
	$term = get_term_by( 'slug', 'skill', 'wp_guideline_type' );
	$cached = $term instanceof WP_Term ? (int) $term->term_id : 0;
	return $cached;
}

/**
 * Polyfill of Push MD's `wp_install_skill()`.
 *
 * Push MD ships the canonical implementation in
 * `Automattic/php-toolkit/plugins/push-md/functions.php` and guards it
 * with `function_exists()` so other plugins can polyfill. We do the
 * same so Desktop Mode works without Push MD installed; if Push MD
 * loads first its definition wins, which is intentional — we want one
 * source of truth in mixed installs.
 *
 * The function performs an idempotent upsert keyed on the
 * `guideline_source` post-meta value: pass the same `$source_identifier`
 * and the existing post is returned; pass a new one and a new post is
 * created.
 *
 * @since 0.23.0
 *
 * @param string $source_identifier Per-skill identifier (e.g. `desktop-mode/remove-bg`).
 * @param string $title             `post_title`.
 * @param string $excerpt           `post_excerpt`.
 * @param string $content           `post_content` (markdown).
 * @param array  $extras            Optional `wp_insert_post` overrides.
 * @return array{id:int,created:bool}|WP_Error
 */
if ( ! function_exists( 'wp_install_skill' ) ) {
	function wp_install_skill( $source_identifier, $title, $excerpt, $content, $extras = array() ) {
		// Match Push MD's `wp_install_skill()` behaviour byte-for-byte
		// (file: `Automattic/php-toolkit/plugins/push-md/functions.php`).
		// Diverging here would break ecosystem interop — pushmd, dolly,
		// and intelligence all assume this contract.
		if ( ! is_string( $source_identifier ) || '' === $source_identifier ) {
			return new WP_Error(
				'missing_source_identifier',
				__( 'wp_install_skill: a non-empty source identifier is required.', 'desktop-mode' )
			);
		}

		if ( ! post_type_exists( 'wp_guideline' ) || ! taxonomy_exists( 'wp_guideline_type' ) ) {
			return new WP_Error(
				'guidelines_unavailable',
				__( 'wp_install_skill: the wp_guideline substrate is not registered.', 'desktop-mode' )
			);
		}

		// Search every post_status — including `trash` and `future` —
		// so the upsert finds previously-trashed skills with the same
		// source identifier and reuses them instead of creating a
		// duplicate. Matches Push MD's status list verbatim.
		$existing = get_posts(
			array(
				'post_type'        => 'wp_guideline',
				'post_status'      => array( 'publish', 'draft', 'pending', 'future', 'private', 'trash' ),
				'meta_key'         => 'guideline_source', // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key
				'meta_value'       => $source_identifier, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'posts_per_page'   => 1,
				'no_found_rows'    => true,
				'suppress_filters' => false,
			)
		);

		if ( ! empty( $existing ) ) {
			return array(
				'id'      => (int) $existing[0]->ID,
				'created' => false,
			);
		}

		// Canonical fields win against caller `$extras`: a caller that
		// passes `post_type` or `post_status` cannot accidentally
		// register the skill under a different post type. Push MD
		// implements this by unsetting the protected keys from
		// `$extras` first and merging caller→canonical second.
		$canonical = array(
			'post_type'    => 'wp_guideline',
			'post_status'  => 'publish',
			'post_author'  => get_current_user_id(),
			'post_title'   => $title,
			'post_excerpt' => $excerpt,
			'post_content' => wp_kses_post( $content ),
		);
		$protected = array(
			'post_type',
			'post_status',
			'post_author',
			'post_title',
			'post_excerpt',
			'post_content',
		);
		if ( ! is_array( $extras ) ) {
			$extras = array();
		}
		foreach ( $protected as $key ) {
			unset( $extras[ $key ] );
		}
		$args = array_merge( $extras, $canonical );

		$post_id = wp_insert_post( $args, true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		wp_set_object_terms( $post_id, 'skill', 'wp_guideline_type' );
		update_post_meta( $post_id, 'guideline_source', sanitize_text_field( $source_identifier ) );

		return array(
			'id'      => (int) $post_id,
			'created' => true,
		);
	}
}

/**
 * Build the per-agent source identifier from a slug.
 *
 * @since 0.23.0
 *
 * @param string $slug Agent slug.
 * @return string `desktop-mode/<slug>`.
 */
function desktop_mode_agents_build_source_id( $slug ) {
	return DESKTOP_MODE_AGENTS_GUIDELINE_SOURCE_PREFIX . $slug;
}

/**
 * Return the agent's wp_guideline post given the agent user ID.
 *
 * @since 0.23.0
 *
 * @param int $user_id Agent user id.
 * @return WP_Post|null
 */
function desktop_mode_agents_get_guideline_for_user( $user_id ) {
	$guideline_id = (int) get_user_meta( $user_id, '_desktop_mode_agent_guideline_id', true );
	if ( ! $guideline_id ) {
		return null;
	}
	$post = get_post( $guideline_id );
	return ( $post instanceof WP_Post && 'wp_guideline' === $post->post_type ) ? $post : null;
}

/**
 * Read the abilities allowlist for a skill guideline.
 *
 * @since 0.23.0
 *
 * @param int $guideline_id Post id.
 * @return string[]
 */
function desktop_mode_agents_get_abilities( $guideline_id ) {
	$value = get_post_meta( $guideline_id, DESKTOP_MODE_AGENTS_ABILITIES_META_KEY, true );
	if ( ! is_array( $value ) ) {
		return array();
	}
	return desktop_mode_agents_sanitize_ability_slugs( $value );
}

/**
 * Write the abilities allowlist for a skill guideline.
 *
 * @since 0.23.0
 *
 * @param int      $guideline_id Post id.
 * @param string[] $abilities    Ability slugs.
 * @return void
 */
function desktop_mode_agents_set_abilities( $guideline_id, $abilities ) {
	$clean = desktop_mode_agents_sanitize_ability_slugs( $abilities );
	update_post_meta( $guideline_id, DESKTOP_MODE_AGENTS_ABILITIES_META_KEY, $clean );
}

/**
 * Catalogue of abilities exposed to the Agents picker.
 *
 * Primary source: WordPress 6.9's Core Abilities API (`wp_get_abilities()`).
 * Every ability the site has registered through `wp_register_ability()`
 * is harvested into the picker. This is the same registry Dolly,
 * Intelligence, and any other agent runtime read from — there is no
 * Desktop-Mode-specific ability list and no abilities-from-wp_guideline
 * coupling (wp_guideline is the storage CPT for skills/instructions;
 * abilities live in their own Core registry).
 *
 * Plugins can either:
 *   - register abilities via `wp_register_ability()` (Core API,
 *     recommended — every agent runtime sees them) or
 *   - extend the picker only via the `desktop_mode_agent_abilities_catalogue`
 *     filter (Desktop-Mode-only, escape hatch).
 *
 * If `wp_get_abilities()` is unavailable (pre-6.9 site without the
 * Abilities-API polyfill plugin) the catalogue is empty unless the
 * filter populates it.
 *
 * @since 0.23.0
 *
 * @return array<int, array{slug:string, label:string, description:string}>
 */
function desktop_mode_agents_abilities_catalogue() {
	$catalogue = array();

	if ( function_exists( 'wp_get_abilities' ) ) {
		$abilities = wp_get_abilities();
		if ( is_array( $abilities ) ) {
			foreach ( $abilities as $key => $ability ) {
				$slug = '';
				if ( is_object( $ability ) && method_exists( $ability, 'get_name' ) ) {
					$slug = (string) $ability->get_name();
				}
				if ( '' === $slug ) {
					$slug = is_string( $key ) ? $key : '';
				}
				if ( '' === $slug ) {
					continue;
				}
				$label       = $slug;
				$description = '';
				if ( is_object( $ability ) ) {
					if ( method_exists( $ability, 'get_label' ) ) {
						$label = (string) $ability->get_label();
					}
					if ( method_exists( $ability, 'get_description' ) ) {
						$description = (string) $ability->get_description();
					}
				}
				$catalogue[] = array(
					'slug'        => $slug,
					'label'       => $label,
					'description' => $description,
				);
			}
		}
	}

	/**
	 * Filter the catalogue of abilities exposed to the Agents picker.
	 *
	 * Default value is `wp_get_abilities()` projected into our shape.
	 * Plugins that need to expose abilities NOT yet registered through
	 * the Core API can append entries here, but the preferred path is
	 * `wp_register_ability()` so every agent runtime — Dolly,
	 * Intelligence, Claude Code via pushmd, this plugin — sees the
	 * same registry.
	 *
	 * @since 0.23.0
	 *
	 * @param array $catalogue Abilities harvested from `wp_get_abilities()`.
	 */
	$catalogue = apply_filters( 'desktop_mode_agent_abilities_catalogue', $catalogue );

	if ( ! is_array( $catalogue ) ) {
		return array();
	}

	$seen = array();
	$out  = array();
	foreach ( $catalogue as $row ) {
		if ( ! is_array( $row ) || empty( $row['slug'] ) ) {
			continue;
		}
		$slug = sanitize_text_field( $row['slug'] );
		if ( '' === $slug || isset( $seen[ $slug ] ) ) {
			continue;
		}
		$seen[ $slug ] = true;
		$out[]         = array(
			'slug'        => $slug,
			'label'       => isset( $row['label'] ) ? (string) $row['label'] : $slug,
			'description' => isset( $row['description'] ) ? (string) $row['description'] : '',
		);
	}
	return $out;
}
