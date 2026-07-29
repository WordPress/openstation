<?php
/**
 * Popup Siege manifest.
 *
 * @package DesktopModePopupSiege
 */

defined( 'ABSPATH' ) || exit;

return array(
	'id'            => 'popup-siege',
	'version'       => '0.7.0',
	'title'         => __( 'Popup Siege', 'desktop-mode-popup-siege' ),
	'description'   => __( 'Save Mira’s 1999 sky log by steering a Breakout ball into invasive popup X targets before the archive link fails.', 'desktop-mode-popup-siege' ),
	'icon'          => 'dashicons-shield-alt',
	'script'        => 'games/popup-breaker/assets/openstation-adapter.js',
	'style'         => 'standalone/popup-breaker.css',
	'score_min'     => 0,
	'score_max'     => 15000,
	'score_columns' => array(
		array(
			'key'   => 'score',
			'label' => __( 'Score', 'desktop-mode-popup-siege' ),
			'type'  => 'number',
		),
		array(
			'key'   => 'time',
			'label' => __( 'Time', 'desktop-mode-popup-siege' ),
			'type'  => 'time',
		),
		array(
			'key'   => 'restored',
			'label' => __( 'Restored', 'desktop-mode-popup-siege' ),
			'type'  => 'number',
		),
		array(
			'key'   => 'popups_closed',
			'label' => __( 'Popups', 'desktop-mode-popup-siege' ),
			'type'  => 'number',
		),
		array(
			'key'   => 'result',
			'label' => __( 'Result', 'desktop-mode-popup-siege' ),
			'type'  => 'text',
		),
	),
	'config'        => array(
		'assetVersion' => '0.7.0',
		'rulesVersion' => 3,
		'assetBaseUrl' => plugins_url(
			'games/popup-breaker/assets/',
			POPUP_SIEGE_FILE
		),
		'sdkBaseUrl'   => plugins_url(
			'sdk/',
			POPUP_SIEGE_FILE
		),
	),
);
