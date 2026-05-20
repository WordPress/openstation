/**
 * My WordPress — Agents: bot glyph + ability-catalogue helpers.
 *
 * The catalogue itself ships server-side (see
 * `desktop_mode_agents_abilities_catalogue()` in
 * `includes/agents/behaviour.php`) and is fetched from
 * `/desktop-mode/v1/agents/abilities`. This file only exposes the
 * shared SVG glyph (used by the section folder tile + every agent
 * tile + the avatar pill) plus a small role-catalogue used by the
 * Create-Agent dropdown.
 *
 * @internal
 * @since 0.23.0
 */

/**
 * Bot glyph used for every Agents surface. MUST stay byte-identical to
 * `desktop_mode_my_wordpress_agents_icon()` in
 * `includes/my-wordpress/window.php` AND to
 * `desktop_mode_agent_avatar_data_uri()` in `includes/agents/identity.php`.
 *
 * The SVG is hard-coded with `#1d2327` (the WP admin accent blue's
 * dark cousin) because data-URI SVGs don't inherit `currentColor`.
 *
 * @public
 */
export const BOT_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d2327" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
	'<circle cx="12" cy="3.25" r="0.95" fill="#1d2327"/>' +
	'<line x1="12" y1="4.25" x2="12" y2="7"/>' +
	'<rect x="4" y="7" width="16" height="12" rx="2.5"/>' +
	'<line x1="2" y1="12.5" x2="4" y2="12.5"/>' +
	'<line x1="20" y1="12.5" x2="22" y2="12.5"/>' +
	'<circle cx="9" cy="12" r="1.15" fill="#1d2327"/>' +
	'<circle cx="15" cy="12" r="1.15" fill="#1d2327"/>' +
	'<path d="M9.25 15.5 Q12 17 14.75 15.5"/>' +
	'</svg>';

/** Pre-encoded data URI for the bot glyph. */
export const BOT_ICON_DATA_URI =
	'data:image/svg+xml;base64,' + btoa( BOT_ICON_SVG );

/**
 * The standard WordPress roles offered to the Create-Agent flow.
 *
 * The choice intentionally mirrors PR #240's body — administrators
 * can grant agents up to `administrator` if they want, but the
 * defaults nudge toward minimal-privilege roles. Plugins that ship
 * custom roles can extend the dropdown via the
 * `desktop_mode_agent_role_choices` JS filter (see renderer).
 *
 * @public
 */
export const DEFAULT_AGENT_ROLE_CHOICES: ReadonlyArray< {
	slug: string;
	label: string;
} > = [
	{ slug: 'contributor', label: 'Contributor' },
	{ slug: 'author', label: 'Author' },
	{ slug: 'editor', label: 'Editor' },
	{ slug: 'administrator', label: 'Administrator' },
];
