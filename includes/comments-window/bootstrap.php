<?php
/**
 * Desktop Mode — Native Comments Window module bootstrap.
 *
 * Replaces the classic `edit-comments.php` iframe with a native
 * desktop window driven by `<wpd-table>` and core's `/wp/v2/comments`
 * REST endpoint, behind a per-user opt-in
 * (`OsSettingsState.nativeCommentsEnabled`, surfaced as the "Use the
 * native Comments window" toggle in OS Settings → Features).
 *
 * Public PHP surface (all filterable):
 *
 *   - desktop_mode_comments_window_user_can_register
 *   - desktop_mode_comments_window_user_can_use
 *   - desktop_mode_comments_window_args
 *   - desktop_mode_comments_window_template_html
 *   - desktop_mode_comments_window_query_args
 *   - desktop_mode_comments_window_spam_score
 *   - desktop_mode_comments_window_reply_editor
 *
 * The URL-remap swap (Comments tile → native window when opt-in is
 * on) is implemented JS-side in `src/desktop.ts` via
 * `registerNativeUrlRemap`.
 *
 * @package WPDesktopMode
 * @since   0.8.3
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/spam-score.php';
require_once __DIR__ . '/ai-moderation.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/rest.php';
