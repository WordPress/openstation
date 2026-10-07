<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_MIGRATION_VERSION = 10;

const OPENSTATION_MIGRATION_OPTION = 'desktop_mode_migration_version';

function openstation_maybe_run_migrations() {
	$installed = (int) get_option( OPENSTATION_MIGRATION_OPTION, 0 );
	if ( $installed >= OPENSTATION_MIGRATION_VERSION ) {
		return;
	}

	openstation_run_pending_migrations( $installed );

	update_option( OPENSTATION_MIGRATION_OPTION, OPENSTATION_MIGRATION_VERSION, false );
}
add_action( 'admin_init', 'openstation_maybe_run_migrations' );

function openstation_run_migrations_on_activation() {

	if ( false !== get_option( OPENSTATION_MIGRATION_OPTION, false ) ) {
		return;
	}

	$prior_users = openstation_users_with_prior_desktop_use();
	if ( ! empty( $prior_users ) ) {
		return;
	}

	openstation_maybe_run_migrations();
}
register_activation_hook( OPENSTATION_FILE, 'openstation_run_migrations_on_activation' );

function openstation_run_pending_migrations( $from ) {
	$from = (int) $from;

	if ( $from < 1 ) {
		openstation_migrate_os_settings_optin();
	}

	if ( $from < 2 ) {
		openstation_migrate_unschedule_post_term_ai();
	}

	if ( $from < 3 ) {
		openstation_migrate_delete_ai_keys();
	}

	if ( $from < 4 ) {
		openstation_migrate_brand_defaults();
	}

	if ( $from < 5 ) {
		openstation_migrate_flag_rebrand_notice( $from );
	}

	if ( $from < 6 ) {
		openstation_migrate_close_recycle_bin_icon_gap();
	}

	if ( $from < 7 ) {
		openstation_migrate_seed_agent_faces();
	}

	if ( $from < 8 ) {
		openstation_migrate_remove_comments_ai();
	}

	if ( $from < 9 ) {
		openstation_migrate_agent_ability_slugs();
	}

	if ( $from < 10 ) {
		openstation_migrate_first_run_stamps();
	}
}

function openstation_migrate_agent_ability_slugs() {
	$meta_key = '_desktop_mode_agent_abilities';
	$renames  = array(
		'desktop-mode/search-comments-on-post' => 'desktop-mode/search-comments-by-post',
	);

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => $meta_key,
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw   = get_user_meta( (int) $user_id, $meta_key, true );
		$slugs = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
		if ( ! is_array( $slugs ) ) {
			continue;
		}

		$changed = false;
		foreach ( $slugs as $i => $slug ) {
			if ( is_string( $slug ) && isset( $renames[ $slug ] ) ) {
				$slugs[ $i ] = $renames[ $slug ];
				$changed     = true;
			}
		}
		if ( ! $changed ) {
			continue;
		}

		update_user_meta(
			(int) $user_id,
			$meta_key,
			wp_slash( (string) wp_json_encode( array_values( array_unique( $slugs ) ) ) )
		);
	}
}

function openstation_migrate_first_run_stamps() {
	$prior_users = openstation_users_with_prior_desktop_use();
	if ( empty( $prior_users ) ) {
		return;
	}

	if ( null === openstation_get_first_enabled_stamp() ) {
		add_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => 0,
				'via' => 'backfill',
			),
			'',
			false
		);
	}

	foreach ( $prior_users as $user_id ) {
		openstation_mark_intro_seen( $user_id, OPENSTATION_SHELL_TOUR_INTRO_SLUG );
	}
}

function openstation_migrate_seed_agent_faces() {

	if (
		! function_exists( 'openstation_agent_get_agents' )
		|| ! function_exists( 'openstation_agent_get_face_seed' )
		|| ! defined( 'OPENSTATION_AGENT_FACE_SEED_META' )
	) {
		return;
	}

	foreach ( openstation_agent_get_agents() as $agent ) {
		$user_id = isset( $agent->ID ) ? (int) $agent->ID : 0;
		if ( $user_id <= 0 ) {
			continue;
		}
		if ( openstation_agent_get_face_seed( $user_id ) > 0 ) {
			continue;
		}
		update_user_meta(
			$user_id,
			OPENSTATION_AGENT_FACE_SEED_META,
			crc32( (string) $agent->user_login )
		);
	}
}

const OPENSTATION_DESKTOP_GRID_ROW_H = 110;

function openstation_migrate_close_recycle_bin_icon_gap() {
	global $wpdb;

	if ( ! function_exists( 'openstation_files_table_names' ) ) {
		return;
	}
	$tables = openstation_files_table_names();
	$tbl    = $tables['placements'];

	$table_exists = (int) $wpdb->get_var(
		$wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s',
			$tbl
		)
	);
	if ( 0 === $table_exists ) {
		return;
	}

	$wpdb->query(
		$wpdb->prepare(

			"UPDATE `{$tbl}` AS p
			INNER JOIN (
				SELECT owner_id, x, y FROM `{$tbl}`
				WHERE parent_id = 0
					AND file_type = 'shortcut'
					AND file_ref  = %s
			) AS bin
				ON p.owner_id = bin.owner_id
				AND p.x       = bin.x
				AND p.y       > bin.y
			SET p.y = p.y - %d
			WHERE p.parent_id = 0
				AND p.trashed_at_ms IS NULL",
			'desktop-mode-recycle-bin',
			OPENSTATION_DESKTOP_GRID_ROW_H
		)
	);

	$wpdb->delete(
		$tbl,
		array(
			'parent_id' => 0,
			'file_type' => 'shortcut',
			'file_ref'  => 'desktop-mode-recycle-bin',
		),
		array( '%d', '%s', '%s' )
	);
}

const OPENSTATION_REBRAND_NOTICE_META_KEY = 'desktop_mode_rebrand_notice';

const OPENSTATION_REBRAND_INTRO_SLUG = 'openstation-rebrand';

function openstation_users_with_prior_desktop_use() {
	return array_map(
		'intval',
		array_unique(
			array_merge(
				get_users(
					array(
						'fields'       => 'ID',
						'meta_key'     => 'desktop_mode_mode',
						'meta_compare' => 'EXISTS',
					)
				),
				get_users(
					array(
						'fields'       => 'ID',
						'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY,
						'meta_compare' => 'EXISTS',
					)
				)
			)
		)
	);
}

function openstation_migrate_flag_rebrand_notice( $from ) {
	if ( (int) $from >= 4 ) {
		return;
	}

	foreach ( openstation_users_with_prior_desktop_use() as $user_id ) {
		update_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, 1 );
	}
}

function openstation_should_show_rebrand_notice() {
	$user_id = get_current_user_id();
	if ( ! $user_id ) {
		return false;
	}

	if ( ! get_user_meta( $user_id, OPENSTATION_REBRAND_NOTICE_META_KEY, true ) ) {
		return false;
	}

	return ! openstation_has_seen_intro( $user_id, OPENSTATION_REBRAND_INTRO_SLUG );
}

function openstation_migrate_brand_defaults() {

	$map = array(
		'accent'    => array(
			'from' => 'wp-blue',
			'to'   => 'pulse',
		),
		'wallpaper' => array(
			'from' => 'dark',
			'to'   => 'galaxy',
		),
	);

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY,
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) ) {
			continue;
		}

		$changed = false;
		foreach ( $map as $key => $move ) {
			if ( ! isset( $move['from'], $move['to'] ) ) {
				continue;
			}

			if ( isset( $raw[ $key ] ) && $move['from'] === $raw[ $key ] ) {
				$raw[ $key ] = $move['to'];
				$changed     = true;
			}
		}

		if ( $changed ) {
			openstation_save_os_settings( (int) $user_id, $raw );
		}
	}
}

function openstation_migrate_os_settings_optin() {
	$flags = array(
		'nativePostsEnabled',
		'nativePagesEnabled',
		'nativeUsersEnabled',
		'nativePluginsEnabled',
		'nativeCommentsEnabled',
	);

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY,
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) ) {
			continue;
		}

		$changed = false;
		foreach ( $flags as $flag ) {
			if ( array_key_exists( $flag, $raw ) ) {
				unset( $raw[ $flag ] );
				$changed = true;
			}
		}

		if ( ! $changed ) {
			continue;
		}

		openstation_save_os_settings( (int) $user_id, $raw );
	}
}

function openstation_migrate_unschedule_post_term_ai() {
	wp_unschedule_hook( 'desktop_mode_ai_analyze_post' );
	wp_unschedule_hook( 'desktop_mode_ai_analyze_term' );
}

function openstation_migrate_remove_comments_ai() {
	wp_unschedule_hook( 'desktop_mode_ai_analyze_comment' );
	delete_option( 'desktop_mode_comments_ai_moderation' );
}

function openstation_migrate_delete_ai_keys() {

	delete_option( 'desktop_mode_ai_platform' );

	$user_ids = get_users(
		array(
			'fields'       => 'ID',
			'meta_key'     => OPENSTATION_OS_SETTINGS_META_KEY,
			'meta_compare' => 'EXISTS',
		)
	);

	foreach ( $user_ids as $user_id ) {
		$raw = get_user_meta( (int) $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
		if ( ! is_array( $raw ) || ! isset( $raw['ai'] ) || ! is_array( $raw['ai'] ) ) {
			continue;
		}

		$changed = false;
		foreach ( array( 'apiKey', 'apiKeys', 'transport', 'provider', 'model' ) as $stale ) {
			if ( array_key_exists( $stale, $raw['ai'] ) ) {
				unset( $raw['ai'][ $stale ] );
				$changed = true;
			}
		}

		if ( ! $changed ) {
			continue;
		}

		openstation_save_os_settings( (int) $user_id, $raw );
	}
}

add_action( 'admin_init', 'openstation_presence_migration_tick', 20 );
