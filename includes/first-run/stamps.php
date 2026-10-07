<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_INSTALLED_AT_OPTION = 'openstation_installed_at';

const OPENSTATION_FIRST_ENABLED_AT_OPTION = 'openstation_first_enabled_at';

const OPENSTATION_ENABLED_AT_META_KEY = 'openstation_enabled_at';

const OPENSTATION_ACTIVATED_BY_OPTION = 'openstation_activated_by';

function openstation_normalise_stamp( $raw ) {
	if ( ! is_array( $raw ) || ! isset( $raw['at'] ) ) {
		return null;
	}
	$via = isset( $raw['via'] ) ? sanitize_key( (string) $raw['via'] ) : 'backfill';
	if ( ! in_array( $via, array( 'activation', 'backfill' ), true ) ) {
		$via = 'backfill';
	}
	return array(
		'at'  => max( 0, (int) $raw['at'] ),
		'via' => $via,
	);
}

function openstation_get_install_stamp() {
	return openstation_normalise_stamp( get_option( OPENSTATION_INSTALLED_AT_OPTION, null ) );
}

function openstation_get_first_enabled_stamp() {
	return openstation_normalise_stamp( get_option( OPENSTATION_FIRST_ENABLED_AT_OPTION, null ) );
}

function openstation_get_user_enabled_at( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return 0;
	}
	return max( 0, (int) get_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY, true ) );
}

function openstation_record_installed( $via = 'activation' ) {
	if ( null !== openstation_get_install_stamp() ) {
		return false;
	}
	$via = 'activation' === $via ? 'activation' : 'backfill';

	$has_past = function_exists( 'openstation_users_with_prior_desktop_use' )
		&& count( openstation_users_with_prior_desktop_use() ) > 0;
	if ( $has_past ) {
		$via = 'backfill';
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
	}

	return (bool) add_option(
		OPENSTATION_INSTALLED_AT_OPTION,
		array(
			'at'  => time(),
			'via' => $via,
		),
		'',
		false
	);
}

function openstation_stamp_install_on_activation() {
	openstation_record_installed( 'activation' );
}
register_activation_hook( OPENSTATION_FILE, 'openstation_stamp_install_on_activation' );

function openstation_record_activator() {
	update_option( OPENSTATION_ACTIVATED_BY_OPTION, get_current_user_id() );
}
register_activation_hook( OPENSTATION_FILE, 'openstation_record_activator' );

function openstation_backfill_install_stamp() {
	openstation_record_installed( 'backfill' );
}
add_action( 'admin_init', 'openstation_backfill_install_stamp', 20 );

function openstation_record_user_enabled( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	$now = time();

	if ( 0 === openstation_get_user_enabled_at( $user_id ) ) {
		update_user_meta( $user_id, OPENSTATION_ENABLED_AT_META_KEY, $now );
	}

	$first_on_site = false;
	if ( null === openstation_get_first_enabled_stamp() ) {
		$first_on_site = (bool) add_option(
			OPENSTATION_FIRST_ENABLED_AT_OPTION,
			array(
				'at'  => $now,
				'via' => 'activation',
			),
			'',
			false
		);
	}

	do_action( 'openstation_user_enabled', $user_id, $first_on_site );

	return $first_on_site;
}

function openstation_record_user_disabled( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return;
	}

	do_action( 'openstation_user_disabled', $user_id );
}

function openstation_install_age_days() {
	$stamp = openstation_get_install_stamp();
	if ( null === $stamp || 'activation' !== $stamp['via'] || $stamp['at'] <= 0 ) {
		return null;
	}
	return max( 0, (int) floor( ( time() - $stamp['at'] ) / DAY_IN_SECONDS ) );
}

function openstation_activation_within( $days ) {
	$days    = max( 0, (int) $days );
	$install = openstation_get_install_stamp();
	if ( null === $install || 'activation' !== $install['via'] || $install['at'] <= 0 ) {
		return null;
	}

	$first = openstation_get_first_enabled_stamp();
	if ( null === $first ) {

		if ( time() - $install['at'] > $days * DAY_IN_SECONDS ) {
			return false;
		}
		return null;
	}
	if ( 'activation' !== $first['via'] || $first['at'] <= 0 ) {
		return null;
	}

	return ( $first['at'] - $install['at'] ) <= $days * DAY_IN_SECONDS;
}

function openstation_first_run_config( $user_id = 0 ) {
	$install = openstation_get_install_stamp();
	$first   = openstation_get_first_enabled_stamp();
	return array(
		'installedAt'    => ( null !== $install && 'activation' === $install['via'] ) ? $install['at'] : 0,
		'firstEnabledAt' => ( null !== $first && 'activation' === $first['via'] ) ? $first['at'] : 0,
		'enabledAt'      => openstation_get_user_enabled_at( $user_id ),
	);
}
