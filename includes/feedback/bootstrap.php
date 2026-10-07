<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_FEEDBACK_ENDPOINT = 'https://openstation.blog/wp-json/openstation-feedback/v1/deactivation';

const OPENSTATION_USAGE_FEEDBACK_ENDPOINT = 'https://openstation.blog/wp-json/openstation-feedback/v1/usage';

function openstation_deactivation_feedback_enabled() {

	return (bool) apply_filters( 'openstation_deactivation_feedback_enabled', true );
}

function openstation_usage_feedback_enabled() {

	return (bool) apply_filters( 'openstation_usage_feedback_enabled', true );
}

require_once __DIR__ . '/deactivation.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/usage.php';
