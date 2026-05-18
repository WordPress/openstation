/**
 * My WordPress — mock data for the Agents UX preview.
 *
 * The Agents surface is a visual mock: no backend, no real LLM wiring,
 * no real WordPress Abilities-API registry, no persistence. This module
 * exports a hard-coded list of four fictional agents and a fictional
 * abilities catalogue so the renderer can paint the full Define /
 * Tools / Triggers shape end-to-end.
 *
 * When the backend lands in a follow-up PR this module is the only
 * surface that has to change — swap the static constants for a
 * REST-backed loader returning the same shape, and the renderer keeps
 * working.
 *
 * @internal
 * @since 0.22.0
 */

/**
 * Mock entry standing in for one WordPress 6.9 Abilities-API ability.
 * The real shape will carry a JSON-Schema `parameters` object too —
 * omitted here because the mock never invokes anything.
 */
export interface MockAbility {
	slug: string;
	label: string;
	description: string;
}

/**
 * Trigger kind enum — mirrors the five flavours called out in the
 * Agents product brief. Stored here as a literal union so the
 * renderer can map kinds to icons without runtime guards.
 */
export type AgentTriggerKind =
	| 'drag'
	| 'chat'
	| 'hook'
	| 'endpoint'
	| 'agent';

/** One configured trigger on an agent. */
export interface AgentTrigger {
	kind: AgentTriggerKind;
	summary: string;
	detail: string;
}

/** One mocked agent, fully self-contained. */
export interface MockAgent {
	id: string;
	name: string;
	description: string;
	roleSlug: string;
	roleLabel: string;
	systemPrompt: string;
	/** Subset of `MOCK_ABILITIES[*].slug` values pre-enabled for this agent. */
	toolSlugs: string[];
	triggers: AgentTrigger[];
}

/**
 * Bot glyph used for both the Agents section folder tile (shipped
 * server-side via `desktop_mode_my_wordpress_agents_icon()`) AND
 * every individual agent tile inside the section. Defined here as a
 * data URI so the same icon is reachable from the JS bundle without
 * an extra round-trip through the entities config; the PHP-side copy
 * is byte-identical for visual consistency on the root grid.
 *
 * Encoded as a base64 SVG so the shared `renderIcon` helper paints it
 * via its `data:image/svg+xml;base64,…` branch — no plumbing changes.
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
	'data:image/svg+xml;base64,' +
	// btoa is fine here — every byte in BOT_ICON_SVG is ASCII.
	btoa( BOT_ICON_SVG );

/**
 * Count of mock agents — read by the root grid so the Agents folder
 * tile can show `"Agents · 4"` without a REST round-trip (the
 * entity's `restPath` is empty by design).
 */
export const MOCK_AGENT_COUNT = 4;

/**
 * Mock abilities catalogue. Names mirror the shape the WordPress 6.9
 * Abilities API uses (`<namespace>/<verb>`). Order matters — the
 * renderer paints the list top-to-bottom and groups by visual section
 * implicitly via the slug prefix.
 */
export const MOCK_ABILITIES: ReadonlyArray< MockAbility > = [
	{
		slug: 'wordpress/list-posts',
		label: 'List posts',
		description: 'Fetch a paginated list of posts.',
	},
	{
		slug: 'wordpress/get-post',
		label: 'Get post',
		description: 'Read a single post by id.',
	},
	{
		slug: 'wordpress/create-post',
		label: 'Create post',
		description: 'Insert a new post.',
	},
	{
		slug: 'wordpress/update-post',
		label: 'Update post',
		description: 'Modify post fields.',
	},
	{
		slug: 'wordpress/update-post-meta',
		label: 'Update post meta',
		description: 'Set or clear post-meta keys.',
	},
	{
		slug: 'wordpress/list-pages',
		label: 'List pages',
		description: 'Fetch a list of pages.',
	},
	{
		slug: 'wordpress/list-users',
		label: 'List users',
		description: 'Fetch site users.',
	},
	{
		slug: 'wordpress/get-user',
		label: 'Get user',
		description: 'Read a single user record.',
	},
	{
		slug: 'wordpress/send-email',
		label: 'Send email',
		description: 'Send a transactional email through wp_mail().',
	},
	{
		slug: 'media/upload',
		label: 'Upload media',
		description: 'Attach a new file to the Media Library.',
	},
	{
		slug: 'media/replace',
		label: 'Replace media',
		description: "Overwrite an existing attachment's file.",
	},
	{
		slug: 'media/remove-background',
		label: 'Remove background',
		description: 'Strip the background from an image attachment.',
	},
	{
		slug: 'media/generate-alt-text',
		label: 'Generate alt text',
		description: 'Write descriptive alt text for an image.',
	},
	{
		slug: 'seo/analyze-post',
		label: 'Analyze post for SEO',
		description: 'Score keyword density, readability, and structure.',
	},
	{
		slug: 'seo/suggest-meta-description',
		label: 'Suggest meta description',
		description: 'Draft a 155-character meta description.',
	},
	{
		slug: 'comments/list',
		label: 'List comments',
		description: 'Fetch recent comments, optionally filtered.',
	},
	{
		slug: 'comments/moderate',
		label: 'Moderate comment',
		description: 'Approve, mark spam, or trash a comment.',
	},
	{
		slug: 'mail/append-to-list',
		label: 'Append to mailing list',
		description: 'Add a subscriber to a mailing-list segment.',
	},
];

/**
 * The four hard-coded agents shipped with this mock. Picking these
 * specific four is intentional — together they exercise every trigger
 * kind (drag / chat / hook / endpoint / agent) across the four main
 * WordPress content domains (media / post / users / comments), so the
 * full UX surface is reachable from the list.
 */
export const MOCK_AGENTS: ReadonlyArray< MockAgent > = [
	{
		id: 'remove-bg',
		name: 'Remove BG',
		description:
			'Removes the background from any image you drag onto it.',
		roleSlug: 'editor',
		roleLabel: 'Editor',
		systemPrompt:
			'You are an image-processing agent. When given an image you remove its background and produce a transparent PNG, replacing the original attachment in the Media Library.',
		toolSlugs: [
			'media/upload',
			'media/replace',
			'media/remove-background',
		],
		triggers: [
			{
				kind: 'drag',
				summary: 'Drag & drop · media items',
				detail: 'Drop an image tile from My WordPress onto this agent to start processing.',
			},
			{
				kind: 'chat',
				summary: 'Chat · double-click',
				detail: 'Open a chat window to ask for a one-off background removal.',
			},
		],
	},
	{
		id: 'optimize-seo',
		name: 'Optimize SEO',
		description:
			'Analyzes a post and suggests SEO improvements you can accept with one click.',
		roleSlug: 'editor',
		roleLabel: 'Editor',
		systemPrompt:
			'You are an SEO assistant. Given a post you analyze its title, slug, headings, meta description, and body for keyword density, readability, and structure, and you propose concrete edits the author can accept.',
		toolSlugs: [
			'wordpress/get-post',
			'wordpress/update-post',
			'wordpress/update-post-meta',
			'seo/analyze-post',
			'seo/suggest-meta-description',
		],
		triggers: [
			{
				kind: 'drag',
				summary: 'Drag & drop · posts',
				detail: 'Drop a post or page tile onto this agent for an audit.',
			},
			{
				kind: 'chat',
				summary: 'Chat · double-click',
				detail: 'Ask "Audit this post" or "Suggest a better title".',
			},
			{
				kind: 'hook',
				summary: 'Hook · save_post',
				detail: 'Runs whenever a post is saved (mocked — no real subscription).',
			},
		],
	},
	{
		id: 'send-to-mail-list',
		name: 'Send to mail list',
		description:
			'Sends a curated newsletter to a segment of your subscribers.',
		roleSlug: 'author',
		roleLabel: 'Author',
		systemPrompt:
			'You are a newsletter operator. Given a target segment and a topic, you assemble the latest matching posts, draft the email body, and dispatch through the configured mailer.',
		toolSlugs: [
			'wordpress/list-posts',
			'wordpress/list-users',
			'mail/append-to-list',
			'wordpress/send-email',
		],
		triggers: [
			{
				kind: 'chat',
				summary: 'Chat · double-click',
				detail: 'Say "Send the weekly digest to subscribers" to kick things off.',
			},
			{
				kind: 'endpoint',
				summary: 'REST · POST /agents/v1/send-newsletter',
				detail: 'Authenticated endpoint — calls from logged-in editors trigger a send.',
			},
		],
	},
	{
		id: 'moderate-comments',
		name: 'Moderate Comments',
		description:
			'Watches incoming comments and approves, rejects, or marks spam automatically.',
		roleSlug: 'editor',
		roleLabel: 'Editor',
		systemPrompt:
			"You are a comment moderator. For every incoming comment you classify it (approve / pending / spam / trash) using the site's tone rules and the linked post's context.",
		toolSlugs: [
			'comments/list',
			'comments/moderate',
			'wordpress/get-post',
			'wordpress/get-user',
		],
		triggers: [
			{
				kind: 'hook',
				summary: 'Hook · wp_insert_comment',
				detail: 'Fires on every new comment (mocked — no real subscription).',
			},
			{
				kind: 'chat',
				summary: 'Chat · double-click',
				detail: 'Ask "How many pending comments today?" to query the queue.',
			},
		],
	},
];
