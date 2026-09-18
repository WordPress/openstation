<?php
/**
 * OpenStation — feedback module bootstrap.
 *
 * The deactivation feedback dialog: one optional question asked when a
 * site admin deactivates OpenStation, forwarded server-side to the
 * intake plugin on openstation.blog. Nothing in this module writes to the site — no
 * option, no user meta, no transient, no table — which is why
 * `docs/data-model.md` has no row for it. The only state is the
 * submission itself, and it leaves the site the moment it is sent.
 *
 * Consent is per submission: nothing goes out unless the admin clicks
 * "Send", and both dialog buttons deactivate the plugin either way.
 *
 * Loaded unconditionally from `desktop-mode.php` (not inside the
 * admin-modules gate) so the REST route registers on REST requests.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Where a submission is forwarded: the OpenStation Feedback Intake
 * plugin on openstation.blog, the site the About tab already reads
 * (`OPENSTATION_ABOUT_SITE_URL` in `includes/about-feed.php`), so the
 * disclosure names a host users have already seen named. Filterable
 * through `openstation_deactivation_feedback_endpoint` for hosts that
 * run their own intake.
 */
const OPENSTATION_FEEDBACK_ENDPOINT = 'https://openstation.blog/wp-json/openstation-feedback/v1/deactivation';

/**
 * Whether the deactivation feedback dialog is on for this site.
 *
 * Gates everything: the script on the Plugins screen, the Plugins
 * app's config block, and the REST route's permission callback. A
 * host that returns `false` here ships no dialog and answers 403 on
 * the route.
 *
 * @return bool
 */
function openstation_deactivation_feedback_enabled() {
	/**
	 * Filters whether the deactivation feedback dialog is enabled.
	 *
	 * @param bool $enabled Default true.
	 */
	return (bool) apply_filters( 'openstation_deactivation_feedback_enabled', true );
}

require_once __DIR__ . '/deactivation.php';
require_once __DIR__ . '/rest.php';
