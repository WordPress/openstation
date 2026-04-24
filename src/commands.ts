/**
 * Desktop Mode — Command Palette registry.
 *
 * Third-party plugins contribute slash-commands via the public
 * `wp.desktop.registerCommand()` API. The AI Assistant reads from
 * this registry the moment the user types `/` as the first character
 * of their query, and rendering / selection / invocation happens in
 * `ai-assistant.ts`.
 *
 * Intentionally decoupled from the AI Assistant: the registry is just
 * a Map<slug, def>. Future UIs (a standalone Raycast-style launcher,
 * a right-click context menu) can consume the same registry without
 * depending on the assistant module.
 *
 * @since 0.14.0
 */

// ---------------------------------------------------------------------------
// Public shape of an admin link — matches the AI answer schema so
// command handlers can return links the assistant already knows how
// to render.
// ---------------------------------------------------------------------------

export interface CommandAdminLink {
	title: string;
	url: string;
	description: string;
	icon: string;
}

export interface CommandEntity {
	id: number;
	type: 'post' | 'page' | 'comment';
	title?: string;
	url: string;
	edit_url: string;
	topic?: string;
	ai_summary?: string;
}

/**
 * Context passed to every command's `run()` function. Exposes a tiny
 * surface — enough to close the palette and open wp-admin pages in
 * legacy windows, without coupling to the full desktop API.
 */
export interface CommandContext {
	/** Close the AI Assistant panel. */
	close(): void;
	/**
	 * Open a wp-admin URL in a legacy iframe window on the desktop.
	 *
	 * @param url   Absolute or relative wp-admin URL.
	 * @param title Window title.
	 * @param icon  Optional Dashicons class for the window tile.
	 */
	openInWindow( url: string, title: string, icon?: string ): void;
	/**
	 * Ask the user to confirm a destructive action. Returns a Promise
	 * resolving to `true` if they accept, `false` otherwise.
	 *
	 * Use this from any command whose `run()` would do something
	 * irreversible — closing all windows, deleting content, switching
	 * destructive settings. The default implementation uses the
	 * browser's native `confirm()` dialog; the shell may swap a custom
	 * UI in later (the contract — Promise<boolean> — won't change).
	 *
	 * @since 0.14.0
	 *
	 * @param message Headline question, short and direct.
	 * @param details Optional secondary line shown below the message.
	 */
	confirm( message: string, details?: string ): Promise< boolean >;
	/**
	 * Show a toast / ephemeral message to the user.
	 *
	 * **Not yet wired — calls are silently dropped today.** Planned to
	 * route through the shared toast layer in a follow-up release. If
	 * you need user feedback from a command `run()` right now, return
	 * a `string` or `{ message: string }` from `run()` and the
	 * assistant overlay / `wp.desktop.ai.ask()` caller will surface
	 * it as `res.message`. For out-of-band toasts, dispatch
	 * `wp-desktop.shell.toast` via `wp.desktop.hooks.doAction()`.
	 *
	 * This field stays typed so command code written today compiles
	 * against the final API unchanged.
	 */
	notify?: ( message: string ) => void;
}

/**
 * Answer shape a command `run()` returns. The assistant renders it
 * the same way it renders AI responses — one code path, one style.
 *
 *   - Return `void` / `undefined` when the command performs an action
 *     (opens a window, saves a setting) and has nothing to say.
 *   - Return a string as a shorthand for `{ message: string }`.
 */
export type CommandResult =
	| void
	| string
	| {
		message: string;
		answer_type?: 'chat' | 'navigation' | 'entity';
		admin_links?: CommandAdminLink[];
		entity?: CommandEntity | null;
	};

/**
 * A single option returned by a command's `suggest()` autocomplete.
 * The palette renders these after the slug-space as the user types.
 */
export interface CommandSuggestion {
	/**
	 * The string inserted into the input when the user picks this
	 * suggestion (Tab or click). Also what `run()` receives as `args`
	 * when the suggestion is the one the user submits.
	 */
	value: string;
	/** Human-readable label rendered in the palette. */
	label: string;
	/** Optional muted second line. */
	description?: string;
	/** Optional Dashicons class. */
	icon?: string;
}

/**
 * A slash-command registered by a plugin.
 */
export interface DesktopCommand {
	/**
	 * Command slug — what the user types after `/`. Must be
	 * URL-safe-ish: letters, digits, hyphen, underscore. Case
	 * insensitive for matching but stored lower-case.
	 */
	slug: string;
	/** One-line human-readable label shown in the palette. */
	label: string;
	/** Optional fuller description. Wraps. */
	description?: string;
	/**
	 * Optional argument hint, e.g. `"[post id]"` or `"[query]"`.
	 * Rendered in the palette as dim text after the label.
	 */
	hint?: string;
	/** Dashicon class for the list item (default `dashicons-arrow-right-alt`). */
	icon?: string;
	/**
	 * Pre-rendered SVG markup rendered inline as the item glyph.
	 * Takes precedence over `icon` when present. Populated today by
	 * the iframe-command bridge forwarding `@wordpress/icons` elements
	 * via `renderToString`; plugins may set it directly when shipping
	 * a custom SVG is easier than enqueueing a dashicon.
	 *
	 * @since 0.16.0
	 */
	iconSvg?: string;
	/**
	 * When true, the command surfaces in the palette as soon as the
	 * user opens it — no need to type `/` first. Set this for
	 * contextual commands whose relevance is obvious from the current
	 * window (Gutenberg block actions, editor toggles, etc.): the
	 * iframe-command bridge auto-sets it on every harvested entry.
	 *
	 * When falsy (the default), the command is slash-only — it only
	 * appears after the user types `/`. Good for utility / namespaced
	 * commands the user must deliberately invoke (plugin-registered
	 * tools, destructive actions) where showing them eagerly would add
	 * noise.
	 *
	 * @since 0.16.0
	 */
	eager?: boolean;
	/**
	 * Optional owner tag — the WordPress script handle that registered
	 * the command. Set this when a plugin deactivation should live-
	 * unregister its commands: the server-sync module walks the command
	 * registry and removes every command whose `owner` matches a handle
	 * that just left the `serverCommandScripts` payload.
	 *
	 * Plugins that don't set `owner` still get live-*registration* on
	 * activation (their JS runs, they call `registerCommand`, the palette
	 * repaints). Only the live-unregistration-on-deactivation case needs
	 * this field — omitting it is a graceful fallback to "commands stay
	 * until the next page reload."
	 *
	 * @since 0.15.0
	 */
	owner?: string;
	/**
	 * Opt into being callable by the AI Copilot as a tool.
	 *
	 * When `true`, `wp.desktop.ai.ask()` harvests this command into
	 * the `command_tools` array sent to `/ai/search`. If the model
	 * matches the user's query to this command, the server returns
	 * `{ answer_type: 'tool_call', tool: { slug, args } }` and the
	 * shell invokes the command's `run()` locally.
	 *
	 * Default `false`. Opt-in was chosen deliberately: the AI is a
	 * natural-language surface, and handing it every registered
	 * command (including destructive ones like `/delete_all_posts`)
	 * would turn a typo into a catastrophe. Commands that are safe
	 * to invoke via a paraphrased user intent ("turn on the lights")
	 * set this explicitly.
	 *
	 * @since 0.17.0
	 */
	aiCallable?: boolean;
	/**
	 * Optional argument autocomplete. Called as the user types after
	 * `/<slug> `, with the current args prefix. Returns (or resolves
	 * to) a list of {@link CommandSuggestion}s the palette renders for
	 * navigation.
	 *
	 * When a command DOESN'T define `suggest()`, the palette accepts
	 * free-text arguments (current behaviour). When it DOES, the user
	 * can still type anything — suggestions are hints, not constraints.
	 *
	 * @since 0.14.0
	 */
	suggest?: (
		args: string,
		ctx: CommandContext,
	) => CommandSuggestion[] | Promise< CommandSuggestion[] >;
	/**
	 * Handler invoked when the user runs the command. Receives the
	 * raw args string (everything after `/<slug> `) and a small
	 * context object. May be sync or async.
	 */
	run( args: string, ctx: CommandContext ): CommandResult | Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map< string, DesktopCommand >();
const listeners = new Set<() => void >();

/**
 * Register (or replace) a command. Slug matching is case-insensitive;
 * a second registration with the same slug replaces the first —
 * mirrors WordPress's `register_*` semantics.
 *
 * Called by plugins:
 *
 * ```js
 * wp.desktop.registerCommand({
 *     slug: 'turn_on_comments',
 *     label: 'Turn on comments',
 *     hint: '[post id]',
 *     description: 'Re-enable the comments section on a given post.',
 *     icon: 'dashicons-admin-comments',
 *     run: async (args, ctx) => {
 *         const id = parseInt(args.trim(), 10);
 *         if (!id) return 'Usage: /turn_on_comments [post id]';
 *         await fetch(`/wp-json/my-plugin/v1/enable-comments/${id}`, {
 *             method: 'POST',
 *             headers: { 'X-WP-Nonce': wpDesktopConfig.restNonce },
 *         });
 *         ctx.close();
 *         return `Comments enabled on post ${id}.`;
 *     },
 * });
 * ```
 *
 * @since 0.14.0
 */
export function registerCommand( cmd: DesktopCommand ): void {
	if ( ! cmd || typeof cmd.slug !== 'string' || cmd.slug.trim() === '' ) {
		return;
	}
	if ( typeof cmd.label !== 'string' || cmd.label.trim() === '' ) {
		return;
	}
	if ( typeof cmd.run !== 'function' ) {
		return;
	}
	const slug = cmd.slug.trim().toLowerCase();
	if ( ! /^[a-z0-9_\-]+$/.test( slug ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[wp-desktop-mode] registerCommand: slug must be [a-z0-9_-]+, got',
				cmd.slug,
			);
		}
		return;
	}
	registry.set( slug, { ...cmd, slug } );
	notify();
}

/** Remove a command by slug. */
export function unregisterCommand( slug: string ): void {
	if ( registry.delete( slug.toLowerCase() ) ) {
		notify();
	}
}

/**
 * Remove every command whose `owner` tag matches. Used by the iframe
 * command-bridge to evict a focused window's commands when focus moves
 * elsewhere, and by the command server-sync on plugin deactivation.
 *
 * @since 0.16.0
 */
export function unregisterByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ slug, cmd ] of Array.from( registry.entries() ) ) {
		if ( cmd.owner === owner ) {
			registry.delete( slug );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

/** Return every registered command in insertion order. */
export function listCommands(): DesktopCommand[] {
	return Array.from( registry.values() );
}

/**
 * Return every command opted in as an AI tool via `aiCallable: true`.
 * The shape the AI Copilot wants is narrow — slug plus a bit of
 * metadata for the model's tool-description field — so we project
 * here rather than shipping the full `DesktopCommand` (including
 * `run`/`suggest` closures) over the wire.
 *
 * @since 0.17.0
 */
export function listAiCallableCommands(): Array< {
	slug: string;
	label: string;
	description: string;
	hint: string;
} > {
	const out: Array< {
		slug: string;
		label: string;
		description: string;
		hint: string;
	} > = [];
	for ( const cmd of registry.values() ) {
		if ( cmd.aiCallable !== true ) {
			continue;
		}
		out.push( {
			slug: cmd.slug,
			label: cmd.label,
			description: cmd.description ?? '',
			hint: cmd.hint ?? '',
		} );
	}
	return out;
}

/**
 * Return only commands flagged `eager` — the subset the palette
 * surfaces before the user types anything. See the `eager` field on
 * {@link DesktopCommand} for the opt-in semantics.
 *
 * @since 0.16.0
 */
export function listEagerCommands(): DesktopCommand[] {
	return Array.from( registry.values() ).filter( ( c ) => c.eager === true );
}

/** Look up a command by exact slug. */
export function findCommand( slug: string ): DesktopCommand | null {
	return registry.get( slug.toLowerCase() ) ?? null;
}

/**
 * Filter the registry by slug or label prefix match. Used by the
 * palette UI for autocomplete.
 */
export function filterCommands( query: string ): DesktopCommand[] {
	const q = query.trim().toLowerCase();
	if ( q === '' ) {
		return listCommands();
	}
	return listCommands().filter(
		( c ) =>
			c.slug.toLowerCase().startsWith( q ) ||
			c.label.toLowerCase().includes( q ),
	);
}

/**
 * Subscribe to registry changes (commands registered or removed).
 * Lets open palette UIs re-render when a plugin registers its
 * commands asynchronously after the panel is already visible.
 */
export function subscribeCommands( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error( '[wp-desktop-mode] command-registry listener threw:', err );
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Parse helper — used by the assistant to decide whether an input is
// a command, and to split slug from args.
// ---------------------------------------------------------------------------

export interface ParsedCommandInput {
	isCommand: boolean;
	slug: string;
	args: string;
	hasArgsPart: boolean;
}

export function parseCommandInput( input: string ): ParsedCommandInput {
	if ( ! input.startsWith( '/' ) ) {
		return { isCommand: false, slug: '', args: '', hasArgsPart: false };
	}
	const rest = input.slice( 1 );
	const spaceIdx = rest.indexOf( ' ' );
	if ( spaceIdx === -1 ) {
		return { isCommand: true, slug: rest, args: '', hasArgsPart: false };
	}
	return {
		isCommand: true,
		slug: rest.slice( 0, spaceIdx ),
		args: rest.slice( spaceIdx + 1 ),
		hasArgsPart: true,
	};
}
