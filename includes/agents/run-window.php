<?php
/**
 * Desktop Mode — Agents: "Agent run" native window.
 *
 * Lightweight, always-available window that the send-to dispatcher
 * (and any future invocation surface) opens to show the user what an
 * agent is doing. The window is a shell — the bundle's render
 * callback (`src/agent-run-window.ts`) reads a shared store the
 * dispatcher updates as the agent's invocation progresses.
 *
 * @package WPDesktopMode
 * @since   0.23.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Inline SVG bot icon — byte-identical to the one used everywhere
 * else agents appear. Local copy because this file may load before
 * the my-wordpress sibling.
 */
function desktop_mode_agent_run_window_icon() {
	$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d2327" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'
		. '<circle cx="12" cy="3.25" r="0.95" fill="#1d2327"/>'
		. '<line x1="12" y1="4.25" x2="12" y2="7"/>'
		. '<rect x="4" y="7" width="16" height="12" rx="2.5"/>'
		. '<line x1="2" y1="12.5" x2="4" y2="12.5"/>'
		. '<line x1="20" y1="12.5" x2="22" y2="12.5"/>'
		. '<circle cx="9" cy="12" r="1.15" fill="#1d2327"/>'
		. '<circle cx="15" cy="12" r="1.15" fill="#1d2327"/>'
		. '<path d="M9.25 15.5 Q12 17 14.75 15.5"/>'
		. '</svg>';
	return 'data:image/svg+xml;base64,' . base64_encode( $svg );
}

/**
 * Static template rendered into the window body — the bundle mounts
 * its UI into `[data-desktop-mode-agent-run-root]`.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agent_run_render_template() {
	?>
	<div class="desktop-mode-agent-run" data-desktop-mode-agent-run-root>
		<div class="desktop-mode-agent-run__loading">
			<wpd-spinner></wpd-spinner>
		</div>
	</div>
	<?php
}

/**
 * Register the native window. Available to every user who can read
 * guidelines — that's the same gate the send-to dispatcher uses, so
 * if a user can invoke an agent they can see the run window.
 *
 * @since 0.23.0
 *
 * @return void
 */
function desktop_mode_agent_run_window_register() {
	if ( ! function_exists( 'desktop_mode_register_window' ) ) {
		return;
	}
	desktop_mode_register_window(
		'desktop-mode-agent-run',
		array(
			'title'        => __( 'Agent run', 'desktop-mode' ),
			'icon'         => desktop_mode_agent_run_window_icon(),
			'template'     => 'desktop_mode_agent_run_render_template',
			// IMPORTANT: leave `script` / `style` empty. The render
			// callback for this window lives in the MAIN
			// `desktop-mode` bundle (`src/agent-run-window.ts` is
			// compiled into `assets/js/desktop.min.js`). If we
			// declared `'script' => 'desktop-mode'` here, the native-
			// window sync would lazy-load the same URL via dynamic
			// `<script>` injection on first open — the browser
			// re-evaluates the bundle, `init()` runs a second time,
			// and the `WidgetLayer` constructor appends a duplicate
			// "+ Add widget" tile (the two-tiles bug). Empty values
			// make `ensureScript()` short-circuit; the bundle's
			// `registerAgentRunWindow()` already wired the callback
			// at boot.
			'script'       => '',
			'style'        => '',
			'width'        => 520,
			'height'       => 600,
			'min_width'    => 360,
			'min_height'   => 360,
			'placement'    => 'none',
			// Force the run window to the front when opened — Send-To
			// invocations should always surface a visible progress
			// surface, not race a focused window into the background.
			'autofocus'    => true,
			// No `capabilities` arg — the window is a passive UI
			// shell that's only useful to users invoking agents,
			// and the invocation REST routes (`/agents/<id>/invoke`)
			// already gate on `read_guidelines`. Adding a cap
			// filter here was actively breaking opens in browser
			// contexts because `desktop_mode_register_window` checks
			// caps at REGISTRATION time, not per-viewer-payload —
			// any context where `current_user_can` returns false
			// during init (cron, REST bootstrap, mixed-priority
			// hooks) returns `WP_Error` and silently drops the
			// registration. Leaving caps empty makes the window
			// available to every browser-side payload; downstream
			// caps enforce the actual security boundary.
		)
	);
}
add_action( 'init', 'desktop_mode_agent_run_window_register', 25 );
