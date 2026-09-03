/**
 * Features — the per-user opt-ins, the betas, and (for an admin) the
 * site-wide Extended Options.
 *
 * Per-user switches write the store. The three surfaces that are
 * SERVER truth rather than a preference — Extended Options, the
 * comments-AI toggle, the intro reset, the folder-sharing purge — are
 * app actions: PHP does the write, `data()` comes back with the new
 * facts, and the ones that gated a server-side registration spend the
 * `refresh_menu` effect so the shell learns what the server would now
 * register without an F5.
 */

import { __, html, sprintf } from '@openstation/app';
import { doAction, HOOKS } from '../../../src/hooks';
import { openAdminUrl, shellConfig, spendMenuRefresh, update } from './store';
import { pickedChecked, pickedValue, uiOf, type Ctx, type ExtendedOptions, type Section } from './types';

/** Show the platform-native shortcut: ⌘K on Apple, Ctrl+K elsewhere. */
const SHORTCUT_KEY =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad|iPod/i.test( navigator.platform || navigator.userAgent || '' )
		? '⌘K'
		: 'Ctrl+K';

/**
 * Developer mode gates SERVER-side registrations (Code Blue's native
 * window + desktop icon), which the shell only learns about from a
 * fresh menu payload. Wait for the debounced settings sync to actually
 * persist (the `saved` lifecycle phase — the refresh probe rebuilds
 * the payload from saved user meta, so firing earlier would harvest
 * the old state), then spend one refresh. On `failed` the store has
 * already rolled the toggle back; nothing to refresh.
 *
 * One permanent listener + a pending flag rather than a self-removing
 * listener per toggle: the sync debounce collapses rapid flips into
 * ONE `saved` event, and the flag collapses them into ONE probe.
 */
let pendingRegistrationRefresh = false;

document.addEventListener( 'os-settings-save-lifecycle', ( event ) => {
	if ( ! pendingRegistrationRefresh ) {
		return;
	}
	const phase = ( event as CustomEvent< { phase?: string } > ).detail?.phase;
	if ( phase !== 'saved' && phase !== 'failed' ) {
		return;
	}
	pendingRegistrationRefresh = false;
	if ( phase === 'saved' ) {
		spendMenuRefresh();
	}
} );

/** A checkbox row: the label, the switch, and the sentence under it. */
const item = ( label: string, checked: boolean, onToggle: ( e: Event ) => void, hint: string, disabled = false, extra: unknown = '' ) => html`
	<div class="os-features__item">
		<os-checkbox-label
			label=${ label }
			?checked=${ checked }
			?disabled=${ disabled }
			@os-checkbox-change=${ onToggle }
		></os-checkbox-label>
		<p class="os-features__hint">${ hint }</p>
		${ extra }
	</div>
`;

/** The "needs a provider" notice, linking to Settings → Connectors. */
const providerNotice = ( connectorsUrl: string ) => html`
	<os-notice tone="warning" not-dismissible>
		${ __( 'This feature requires an AI provider configured in' ) }
		<a
			href=${ connectorsUrl }
			@click=${ ( e: Event ) => {
				e.preventDefault();
				if ( connectorsUrl ) {
					openAdminUrl( connectorsUrl, __( 'Connectors' ) );
				}
			} }
		>${ __( 'Settings → Connectors' ) }</a>.
	</os-notice>
`;

/**
 * The comments-AI toggle is a SITE option, persisted by the
 * `comments-ai` action. The shell's page config keeps a mirror other
 * bundles read at load; it is updated from the fresh data so a window
 * already open obeys the new value.
 */
async function toggleCommentsAi( ctx: Ctx, enabled: boolean ): Promise< void > {
	const ui = uiOf( ctx ).features;
	if ( ui.commentsAiSaving ) {
		return;
	}
	ui.commentsAiSaving = true;
	ctx.repaint();
	await ctx.dispatch( 'comments-ai', { enabled } );
	ui.commentsAiSaving = false;
	syncShellMirrors( ctx );
	ctx.repaint();
}

async function resetIntros( ctx: Ctx ): Promise< void > {
	const ui = uiOf( ctx ).features;
	if ( ui.resetting ) {
		return;
	}
	ui.resetting = true;
	ctx.repaint();
	if ( await ctx.dispatch( 'reset-intros' ) ) {
		// Broadcast so already-loaded bundles that cache their own
		// dismissed-dialog state can invalidate it without an F5.
		document.dispatchEvent( new CustomEvent( 'os-intros-reset' ) );
	}
	ui.resetting = false;
	ctx.repaint();
}

/**
 * Keep the page config's AI mirrors in step with the server facts
 * `data()` carries — after every paint, because the `focus` lifecycle
 * action re-probes them whenever the window regains focus, which is
 * how the toggle un-gates after the user connects a provider in
 * Settings → Connectors without a reload. A change lets the shell
 * re-gate the ⌘K palette and its admin-bar icon.
 */
export function syncShellMirrors( ctx: Ctx ): void {
	const cfg = shellConfig();
	const ai = ctx.data.aiAssistant;
	if ( ai && cfg.aiAssistant ) {
		const changed =
			cfg.aiAssistant.available !== ai.available ||
			cfg.aiAssistant.assistantProviderConfigured !== ai.assistantProviderConfigured;
		Object.assign( cfg.aiAssistant, ai );
		if ( changed ) {
			document.dispatchEvent( new CustomEvent( 'os-ai-status-changed' ) );
		}
	}
	if ( ctx.data.commentsAi && cfg.commentsAi ) {
		Object.assign( cfg.commentsAi, ctx.data.commentsAi );
	}
}

// ---------------------------------------------------------- sections

const featuresSection: Section = ( s, ctx ) => {
	const { aiAssistant, commentsAi, isAdmin } = ctx.data;
	const ui = uiOf( ctx ).features;
	const onHeartbeatRate = ( e: Event ): void => {
		const next = Number( pickedValue( e ) );
		if ( ! [ 15, 30, 45, 60 ].includes( next ) ) {
			return;
		}
		update( { heartbeatRate: next as 15 | 30 | 45 | 60 } );
		// Tell WordPress to use the closest matching speed bucket right
		// now — Core only accepts 'standard' / 'slow' (15 / 60). Exact
		// 30 / 45 take effect on the next page load via the
		// `heartbeat_settings` PHP filter.
		try {
			const wp = ( window as unknown as {
				wp?: { heartbeat?: { interval?: ( speed: string ) => void } };
			} ).wp;
			wp?.heartbeat?.interval?.( next >= 60 ? 'slow' : 'standard' );
		} catch {
			// Non-fatal — the server filter still applies on reload.
		}
	};
	// No heading. The page title above already says "Features", and
	// its description already covers the per-account,
	// takes-effect-immediately point that used to open this section.
	return html`
		<os-section
			heading=""
			description=${ __( 'Watch the dot in the OpenStation Preferences title bar to see when a change has been saved.' ) }
		>
			${ aiAssistant?.available
				? item(
					__( 'AI assistant' ),
					s.ai.enabled,
					( e ) => update( { ai: { ...s.ai, enabled: pickedChecked( e ) } } ),
					sprintf(
						/* translators: %s: keyboard shortcut, e.g. ⌘K or Ctrl+K */
						__( 'Adds an AI mode to the %s command palette: find content and ask about your site.' ),
						SHORTCUT_KEY,
					),
					! aiAssistant.assistantProviderConfigured,
					aiAssistant.assistantProviderConfigured ? '' : providerNotice( aiAssistant.connectorsUrl ),
				)
				: '' }
			${ commentsAi
				? item(
					__( 'Score new comments with AI' ),
					commentsAi.enabled,
					( e ) => void toggleCommentsAi( ctx, pickedChecked( e ) ),
					__( 'Rates incoming comments so you can triage the queue faster.' ),
					ui.commentsAiSaving || ! commentsAi.providerConfigured,
					commentsAi.providerConfigured ? '' : providerNotice( aiAssistant?.connectorsUrl ?? '' ),
				)
				: '' }
			<div class="os-features__item">
				<os-checkbox-label
					label=${ __( 'Window links' ) }
					?checked=${ s.windowLinksEnabled }
					@os-checkbox-change=${ ( e: Event ) => update( { windowLinksEnabled: pickedChecked( e ) } ) }
				></os-checkbox-label>
				<p class="os-features__hint">
					${ __( 'Draws connector lines between related windows. Line style and visibility live in Windows → Window links.' ) }
				</p>
				${ item(
					__( 'Bring related windows to front' ),
					s.windowLinkRaiseOnFocus,
					( e ) => update( { windowLinkRaiseOnFocus: pickedChecked( e ) } ),
					__( 'Clicking a window also surfaces its parent and children.' ),
					! s.windowLinksEnabled,
				) }
				${ item(
					__( 'Highlight related windows' ),
					s.windowLinkHighlight,
					( e ) => update( { windowLinkHighlight: pickedChecked( e ) } ),
					__( 'Related windows get an accent outline while one of them is focused.' ),
					! s.windowLinksEnabled,
				) }
			</div>
			${ item(
				__( 'Show desktop when clicking the wallpaper' ),
				s.showDesktopOnWallpaperClick,
				( e ) => update( { showDesktopOnWallpaperClick: pickedChecked( e ) } ),
				__( 'A click on the empty desktop minimizes every window; a second click restores them.' ),
			) }
			${ item(
				__( 'Show post/page status ribbon' ),
				s.showPostStatusRibbons,
				( e ) => update( { showPostStatusRibbons: pickedChecked( e ) } ),
				__( 'Marks unpublished posts and pages with a corner ribbon on their tiles.' ),
			) }
			${ item(
				__( 'Enable developer mode' ),
				s.developerModeEnabled,
				( e ) => {
					update( { developerModeEnabled: pickedChecked( e ) } );
					pendingRegistrationRefresh = true;
				},
				__( 'Unlocks developer surfaces meant for plugin authors.' ),
			) }
			${ item(
				__( 'Folder sharing' ),
				s.foldersSharingEnabled,
				( e ) => update( { foldersSharingEnabled: pickedChecked( e ) } ),
				__( 'Share desktop folders with other users or roles, with read or write access.' ),
				false,
				isAdmin
					? html`<div class="os-features__danger-row">
						<p class="os-features__hint">${ __( 'Removes every share and its access list. Cannot be undone.' ) }</p>
						<os-button
							variant="danger"
							os-action="purge-shares"
							os-confirm=${ __(
								'This drops every shares table on the site (current + legacy). All invites, accept/deny decisions, and share rows are permanently removed. Recipients lose their access until someone shares with them again. The empty tables are recreated on the next admin load so the feature keeps working — but every existing share is gone.',
							) }
							os-confirm-title=${ __( 'Delete folder sharing data?' ) }
							os-confirm-label=${ __( 'Delete data' ) }
							os-confirm-danger
						>${ __( 'Delete folder sharing data' ) }</os-button>
					</div>`
					: '',
			) }
			<div class="os-features__item">
				<label class="os-features__select-label">
					<span class="os-features__select-title">${ __( 'WordPress Heartbeat rate' ) }</span>
					<os-select value=${ String( s.heartbeatRate ) } @os-pick=${ onHeartbeatRate }>
						<os-option value="15">${ __( 'Fast (15s, not recommended)' ) }</os-option>
						<os-option value="30">${ __( 'Medium (30s)' ) }</os-option>
						<os-option value="45">${ __( 'Slow (45s)' ) }</os-option>
						<os-option value="60">${ __( 'Very slow (60s, default)' ) }</os-option>
					</os-select>
				</label>
				<p class="os-features__hint">
					${ __( 'How often the Heartbeat API runs. Faster means quicker live updates and more server traffic. The 30s and 45s rates apply exactly from the next page load.' ) }
				</p>
			</div>
			<div class="os-features__row">
				<p class="os-features__hint">
					${ __( 'Brings back the one-time announcements you have dismissed, such as the welcome dialog.' ) }
				</p>
				<os-button variant="secondary" ?disabled=${ ui.resetting } @click=${ () => void resetIntros( ctx ) }>
					${ ui.resetting ? __( 'Resetting…' ) : __( 'Reset what’s-new dialogs' ) }
				</os-button>
			</div>
		</os-section>
	`;
};

/** The beta switches: one row per opt-in native window. */
const betaSection: Section = ( s ) => {
	const beta = ( key: keyof typeof s & string, label: string, hint: string ) =>
		item( label, s[ key ] === true, ( e ) => update( { [ key ]: pickedChecked( e ) } ), hint );
	return html`
		<os-section
			heading=${ __( 'Beta features' ) }
			description=${ __( 'Experimental redesigns of core admin screens, off by default. Each toggle affects only your account and takes effect immediately.' ) }
		>
			${ beta(
				'stationHomeEnabled',
				__( 'Use Station Home as your Dashboard' ),
				__( 'Opens Station Home instead of the classic WordPress Dashboard: recent work, site pulse, and quick actions in one native window. Leave off to keep the classic Dashboard, including any customizations plugins have made to it.' ),
			) }
			${ beta(
				'nativePostsEnabled',
				__( 'Use the native Posts window' ),
				__( 'Replaces the classic Posts list with a native table window: sticky header, paginated rows, bulk actions, and a row preview.' ),
			) }
			${ beta(
				'nativePagesEnabled',
				__( 'Use the native Pages window' ),
				__( 'The Posts table experience for Pages, with a Parent column, hierarchical sort, and edit-lock indicators.' ),
			) }
			${ beta(
				'nativeUsersEnabled',
				__( 'Use the native Users window' ),
				__( 'A native Users list with bulk role changes, online indicators, and one-click password resets.' ),
			) }
			${ beta(
				'nativePluginsEnabled',
				__( 'Use the native Plugins window' ),
				__( 'A native Plugins window with an Installed list, bulk actions, and a Browse gallery from the WordPress.org directory.' ),
			) }
			${ beta(
				'nativeCommentsEnabled',
				__( 'Use the native Comments window' ),
				__( 'A native two-pane Comments window: a list of conversations beside the full reply thread.' ),
			) }
			${ beta(
				'windowPrewarmEnabled',
				__( 'Prewarm windows on hover (experimental)' ),
				__( 'Starts loading a page in a hidden window while you hover its dock icon, so the window appears already rendered when you click. Uses extra memory for one speculative window at a time.' ),
			) }
			${ beta(
				'adminAssetCacheEnabled',
				__( 'Shared asset cache (experimental)' ),
				__( 'Serves the admin’s stylesheets and scripts from one cache shared by every window, so opening a window skips the network for files any window has already loaded. Unlike the other toggles here, this one takes effect after your next reload.' ),
			) }
		</os-section>
	`;
};

/**
 * Save the site-wide options through the `extended` action. The
 * server merges over the stored set, spends a menu refresh (every
 * option here gates a server-side registration — `games` decides
 * whether the games module loads at all), and comes back with the
 * saved set; the announcement lets every window already on screen
 * reconcile against it.
 */
/** Active save count to keep the saving state accurate across overlapping dispatches. */
let inFlightExtendedSaves = 0;

async function saveExtended( ctx: Ctx, options: ExtendedOptions ): Promise< void > {
	const ui = uiOf( ctx ).features;
	ui.extendedSaving = true;
	ui.extendedError = '';
	if ( ctx.data.extendedOptions ) {
		Object.assign( ctx.data.extendedOptions, options );
	}
	ctx.repaint();
	inFlightExtendedSaves++;
	try {
		const ok = await ctx.dispatch( 'extended', { options } );
		if ( ok && ctx.data.extendedOptions ) {
			try {
				doAction( HOOKS.EXTENDED_OPTIONS_CHANGED, { options: ctx.data.extendedOptions } );
			} catch {
				// A surface that fails to reconcile is its own problem; the
				// option is saved either way.
			}
		} else if ( ! ok ) {
			ui.extendedError = __( 'The options could not be saved.' );
		}
	} finally {
		inFlightExtendedSaves--;
		ui.extendedSaving = inFlightExtendedSaves > 0;
		ctx.repaint();
	}
}

/** Admin-only, platform-wide toggles — stored in `wp_options`. */
const extendedSection: Section = ( _s, ctx ) => {
	const options = ctx.data.extendedOptions;
	if ( ! options ) {
		return html``;
	}
	const ui = uiOf( ctx ).features;
	const toggle = ( key: keyof ExtendedOptions, label: string, hint: string ) =>
		item(
			label,
			options[ key ],
			( e ) => void saveExtended( ctx, { ...options, [ key ]: pickedChecked( e ) } ),
			hint,
		);
	return html`
		<os-section
			heading=${ __( 'Extended options' ) }
			description=${ __( 'Site-wide enhancements that apply to every user. Toggling requires the affected page to be reloaded for the change to take effect.' ) }
		>
			${ toggle(
				'media_library_enhanced',
				__( 'Enable drag-and-drop in the Media Library' ),
				__( 'Makes every item in the WordPress Media Library draggable. Drop a media item into text fields, rich-text editors, Gutenberg blocks, or any target that accepts images or files. No replacement of the library — just a drag-and-drop layer on top of the one you already know.' ),
			) }
			${ toggle(
				'games',
				__( 'Enable games' ),
				__( 'Adds a Games app for every user: built-in games, scoreboards, and player-to-player challenges. Off by default — while off, nothing game-related runs anywhere, on the server or in the browser. Saved scores are kept across a disable and reappear when re-enabled.' ),
			) }
			${ toggle(
				'agents',
				__( 'Enable AI agents' ),
				__( 'Adds an Agents section to WP Explorer: durable AI workers that live on the site as login-blocked users, act through the WordPress Abilities API under their own role, and answer in a chat window. Requires a configured AI connector to run. Off by default — while off, nothing agent-related loads. Agent definitions are kept across a disable and reappear when re-enabled.' ),
			) }
			${ ui.extendedError ? html`<p class="os-ext__error">${ ui.extendedError }</p>` : '' }
			${ ui.extendedSaving ? html`<p class="os-ext__saving">${ __( 'Saving…' ) }</p>` : '' }
		</os-section>
	`;
};

/** The Features page, top to bottom. */
export const renderFeatures: Section = ( s, ctx ) => html`
	${ featuresSection( s, ctx ) }
	${ betaSection( s, ctx ) }
	${ ctx.data.isAdmin ? extendedSection( s, ctx ) : '' }
`;
