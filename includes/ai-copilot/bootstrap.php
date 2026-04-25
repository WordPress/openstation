<?php
/**
 * Desktop Mode — AI Copilot bootstrap.
 *
 * Loads all sub-modules in dependency order: settings helpers first so
 * every other file can call `wpdm_ai_get_settings()` immediately.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/platform-settings.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/providers-registry.php';
require_once __DIR__ . '/openai.php';
require_once __DIR__ . '/analysis.php';
require_once __DIR__ . '/jobs.php';
require_once __DIR__ . '/hooks.php';
require_once __DIR__ . '/tools-registry.php';
require_once __DIR__ . '/search.php';
require_once __DIR__ . '/reindex.php';
