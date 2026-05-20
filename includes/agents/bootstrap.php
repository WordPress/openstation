<?php
/**
 * Desktop Mode — Agents module bootstrap.
 *
 * Implements the three-layer model from PR #240:
 *
 *  - Layer 1 (identity)   — synthetic `wp_users` rows + login blocks  → identity.php
 *  - Layer 2 (behaviour)  — `wp_guideline` posts tagged `skill`        → behaviour.php
 *  - Layer 3 (bindings)   — user meta for triggers / model / limits    → bindings.php
 *
 * Plus REST surface (`/desktop-mode/v1/agents`) and a soft-gate that
 * paints a "Enable Guidelines experiment" affordance when the Gutenberg
 * substrate is not active.
 *
 * Behaviour-layer storage, Artur Piszek's ecosystem
 * conventions (Dolly, Intelligence, Push MD) verbatim: each agent is a
 * `wp_guideline` post with `post_title` = name, `post_excerpt` =
 * description, `post_content` = system prompt, `post_meta.guideline_source`
 * = `'desktop-mode/<slug>'`, taxonomy `wp_guideline_type` = `skill`.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/gutenberg-gate.php';
require_once __DIR__ . '/behaviour.php';
require_once __DIR__ . '/identity.php';
require_once __DIR__ . '/bindings.php';
require_once __DIR__ . '/abilities.php';
require_once __DIR__ . '/runner.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/privacy.php';
require_once __DIR__ . '/run-window.php';
