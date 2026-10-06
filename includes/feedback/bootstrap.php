<?php
/**
 * OpenStation — feedback module bootstrap.
 *
 * Two dialogs, both forwarded server-side to the intake plugin on
 * openstation.blog:
 *
 * - The deactivation feedback dialog (`deactivation.php`, `rest.php`):
 *   one optional question asked when a site admin deactivates
 *   OpenStation. Writes nothing to the site — no option, no user meta,
 *   no transient, no table — which is why `docs/data-model.md` has no
 *   row for it. The only state is the submission itself, and it
 *   leaves the site the moment it is sent.
 * - Usage feedback (`usage.php`): once a user has had OpenStation on
 *   for a while, the shell asks whether they have two minutes to say
 *   how it is going, and a yes opens a short optional form. Its only
 *   state on the site is the `usage-feedback` slug in the seen-intros
 *   registry.
 *
 * Consent is per submission: nothing goes out unless the user clicks
 * "Send", and every other way out of either dialog sends nothing.
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
 * Where a usage feedback submission is forwarded: the same intake
 * plugin, its `usage` route. Filterable through
 * `openstation_usage_feedback_endpoint`.
 */
const OPENSTATION_USAGE_FEEDBACK_ENDPOINT = 'https://openstation.blog/wp-json/openstation-feedback/v1/usage';

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

/**
 * Whether the usage feedback prompt is on for this site.
 *
 * Gates the shell config key that shows the prompt and the REST
 * route's permission callback. A host that returns `false` here
 * ships no prompt and answers 403 on the route.
 *
 * @return bool
 */
function openstation_usage_feedback_enabled() {
	/**
	 * Filters whether the usage feedback prompt is enabled.
	 *
	 * @param bool $enabled Default true.
	 */
	return (bool) apply_filters( 'openstation_usage_feedback_enabled', true );
}

require_once __DIR__ . '/deactivation.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/usage.php';
