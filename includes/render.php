<?php
/**
 * Desktop Mode — Render layer (umbrella loader).
 *
 * Was a 2,525-LOC god-module before the architecture-0.8.1 split;
 * the body has now been sliced into one focused file per concern
 * under `includes/render/`. This file remains as the umbrella
 * `require_once` so existing plugins or test bootstraps that
 * `require_once 'includes/render.php'` continue to load the same
 * rendering surface they always did.
 *
 *   - body-classes.php           — admin_body_class filter
 *   - assets.php                 — desktop_mode_enqueue_assets()
 *   - shell.php                  — desktop_mode_render_shell()
 *   - chromeless-bridge.php      — chromeless iframe bridge +
 *                                  the offset-neutralizer script
 *   - classic-link-interceptor.php — detached-tab link rewriter
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/render/body-classes.php';
require_once __DIR__ . '/render/assets.php';
require_once __DIR__ . '/render/shell.php';
require_once __DIR__ . '/render/chromeless-bridge.php';
require_once __DIR__ . '/render/classic-link-interceptor.php';
