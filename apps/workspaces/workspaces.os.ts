/**
 * Workspaces — the client view.
 *
 * The desks are the shell's, so this view reads them live from
 * `wp.os.workspaces` and writes them back through it: a rename, a
 * glyph, "Hide settings", a delete — none of those is a request, and
 * the session saver persists them like any other desk change. The view
 * repaints whenever the shell says a desk changed (created, renamed,
 * closed, or its profile updated), whoever changed it.
 *
 * The share half is server truth (`data.shares`), reached with
 * `ctx.dispatch()`. Its one piece of client logic is noticing that a
 * shared workspace changed since it was published: the client hashes
 * the profile when it publishes, and compares against that hash after.
 *
 * @public
 */

import { __, _n, copyText, defineApp, html, sprintf, type TemplateResult } from '@openstation/app';
import type { ViewContext } from '@openstation/app';
import type { Desktop } from '../../src/types';
import { DESKTOP_LABEL_MAX_LENGTH } from '../../src/window-manager/desktops';
import type { WorkspaceProfile } from '../../src/workspaces/types';
import type { WorkspacesApi } from '../../src/workspaces/api';
import type { MioWindowLease } from '../../src/mio/assistant/types';
import { commitDraft, listWidgets, mountWorkspacesMio, scanApps } from './parts/mio';
import type { DraftStep, WorkspaceDraft } from './parts/draft';
import { renderDraft } from './parts/preview';

const APP_ID = 'openstation-workspaces';

interface AppState extends Record< string, unknown > {
	/** The desk the window was opened on; its card leads. */
	focus: string;
	/** Opened asking for MIO's chat (the dock's "Build with MIO…"). */
	mio: boolean;
}

/** Client-only chat, disclosure and request state for this window. */
interface AppUi {
	lease: MioWindowLease | null;
	/** The workspace MIO is building with the user, shown as a preview. */
	draft: WorkspaceDraft | null;
	/** The workspace a chat was opened on; '' for a new one. */
	target: string;
	/** Whether the open-with-MIO request has been honoured. */
	asked: boolean;
	/** Expanded card sections, kept through shell and server repaints. */
	expanded: Set< string >;
	/** Desks whose share is being published; prevents duplicate creation. */
	publishing: Set< string >;
	/** A newly saved desk whose name should be selected once rendered. */
	nameFocus: string;
}

function appUi( ctx: Ctx ): AppUi {
	return ctx.ui< AppUi >( () => ( { lease: null, draft: null, target: '', asked: false, expanded: new Set(), publishing: new Set(), nameFocus: '' } ) );
}

/**
 * Whether MIO can chat here: MIO on, the AI assistant on, and a
 * provider configured — the same three gates the shell puts on its
 * own Ask MIO button. Without them the MIO buttons are not offered.
 */
function mioAvailable(): boolean {
	const os = window.wp?.os as { getOsSettings?: () => { mioEnabled?: boolean; ai?: { enabled?: boolean } } } | undefined;
	const settings = os?.getOsSettings?.();
	const ai = ( window as unknown as {
		openStationConfig?: { aiAssistant?: { available?: boolean; assistantProviderConfigured?: boolean } };
	} ).openStationConfig?.aiAssistant;
	return !! ( settings?.mioEnabled && settings.ai?.enabled && ai?.available && ai.assistantProviderConfigured );
}

/** Open MIO's chat in this window, about a workspace or a new one. */
function askMio( ctx: Ctx, target = '' ): void {
	const ui = appUi( ctx );
	ui.target = target;
	void ui.lease?.openChat();
}

interface Claimant {
	user: number;
	name: string;
	email: string;
	pinned: boolean;
	at: number;
}

interface Share {
	id: number;
	label: string;
	desktop: string;
	url: string;
	version: number;
	disabled: boolean;
	mine: boolean;
	authorName: string;
	hash: string;
	claimants: Claimant[];
}

interface AppData {
	canShare: boolean;
	shares: Share[];
}

type Ctx = ViewContext< AppState, AppData >;

/** The glyphs a workspace can wear. */
const ICONS: ReadonlyArray< { id: string; label: string } > = [
	{ id: 'dashicons-desktop', label: __( 'Desktop' ) },
	{ id: 'dashicons-cart', label: __( 'Store' ) },
	{ id: 'dashicons-edit-page', label: __( 'Writing' ) },
	{ id: 'dashicons-format-image', label: __( 'Media' ) },
	{ id: 'dashicons-admin-users', label: __( 'People' ) },
	{ id: 'dashicons-chart-bar', label: __( 'Reports' ) },
	{ id: 'dashicons-admin-comments', label: __( 'Conversations' ) },
	{ id: 'dashicons-welcome-learn-more', label: __( 'Learning' ) },
	{ id: 'dashicons-megaphone', label: __( 'Marketing' ) },
	{ id: 'dashicons-portfolio', label: __( 'Projects' ) },
	{ id: 'dashicons-groups', label: __( 'Team' ) },
	{ id: 'dashicons-sos', label: __( 'Support' ) },
];

/** The colours a workspace can wear; '' is the shell accent. */
const COLORS: ReadonlyArray< { value: string; label: string } > = [
	{ value: '', label: __( 'Shell accent' ) },
	{ value: '#2271b1', label: __( 'Blue' ) },
	{ value: '#00a32a', label: __( 'Green' ) },
	{ value: '#dba617', label: __( 'Yellow' ) },
	{ value: '#d63638', label: __( 'Red' ) },
	{ value: '#8c5fc7', label: __( 'Purple' ) },
	{ value: '#e26f56', label: __( 'Coral' ) },
];

/** The shell's workspace API. Present whenever this window can be. */
function api(): WorkspacesApi | null {
	return ( window.wp?.os as { workspaces?: WorkspacesApi } | undefined )?.workspaces ?? null;
}

/**
 * The profile as a stable string: what "has this changed since it was
 * published?" compares.
 *
 * Canonical rather than raw, because the same workspace comes back from
 * the server shaped a little differently from how the client wrote it:
 * PHP turns an empty object into an empty list, fills `widgets` in as
 * `all`, and rounds positions to four places. So empties and defaults
 * are dropped, keys sorted, and numbers rounded the way the server
 * rounds them. `provisioned` is the desk's own bookkeeping, not part of
 * what it IS, so it stays out.
 */
export function profileFingerprint( profile: WorkspaceProfile ): string {
	const isEmpty = ( v: unknown ): boolean =>
		undefined === v ||
		null === v ||
		'' === v ||
		false === v ||
		( Array.isArray( v ) && v.length === 0 ) ||
		( !! v && 'object' === typeof v && ! Array.isArray( v ) && Object.keys( v ).length === 0 );
	const canonical = ( value: unknown ): unknown => {
		if ( 'number' === typeof value ) {
			return Math.round( value * 1e4 ) / 1e4;
		}
		if ( Array.isArray( value ) ) {
			return value.map( canonical );
		}
		if ( value && 'object' === typeof value ) {
			const out: Record< string, unknown > = {};
			for ( const key of Object.keys( value as Record< string, unknown > ).sort() ) {
				const v = canonical( ( value as Record< string, unknown > )[ key ] );
				if ( ! isEmpty( v ) ) {
					out[ key ] = v;
				}
			}
			return out;
		}
		return value;
	};
	const { provisioned, widgets, apps, ...rest } = profile;
	void provisioned;
	const text = JSON.stringify(
		canonical( {
			...rest,
			// `all` is the default either way, whatever ids ride along.
			apps: 'only' === apps.mode ? apps : undefined,
			widgets: 'only' === widgets?.mode ? widgets : undefined,
		} ),
	);
	// A polynomial rolling hash, modulo the largest 32-bit prime:
	// short, stable, and only ever compared with itself.
	let h = 7;
	for ( let i = 0; i < text.length; i++ ) {
		h = ( h * 31 + text.charCodeAt( i ) ) % 4294967291;
	}
	return h.toString( 16 );
}

/** The workspace desks, focus first; the main desk is never one. */
function workspaceDesks( state: AppState ): Desktop[] {
	const all = api()?.list() ?? [];
	const desks = all.slice( 1 ).filter( ( d ) => !! d.profile );
	return desks.sort( ( a, b ) => Number( b.id === state.focus ) - Number( a.id === state.focus ) );
}

/** Write one change onto a desk's profile. */
function patchProfile( desk: Desktop, patch: Partial< WorkspaceProfile > ): void {
	if ( desk.profile ) {
		api()?.setProfile( desk.id, { ...desk.profile, ...patch } );
	}
}

/** Copy a link and say whether it worked. */
async function copyLink( ctx: Ctx, url: string ): Promise< void > {
	const ok = await copyText( url );
	ctx.host.toast?.( {
		message: ok ? __( 'Link copied.' ) : __( 'Could not copy — select the link and copy it.' ),
		type: ok ? 'success' : 'warning',
	} );
}

/** Share a desk, or publish its changes, and copy the link the first time. */
async function publish( ctx: Ctx, desk: Desktop, first: boolean ): Promise< void > {
	if ( ! desk.profile ) {
		return;
	}
	const ui = appUi( ctx );
	if ( ui.publishing.has( desk.id ) ) {
		return;
	}
	ui.publishing.add( desk.id );
	ctx.repaint();
	try {
		const ok = await ctx.dispatch( 'share', {
			desktop: desk.id,
			label: desk.label,
			profile: JSON.stringify( desk.profile ),
			hash: profileFingerprint( desk.profile ),
		} );
		const share = ok ? ctx.data.shares.find( ( s ) => s.mine && s.desktop === desk.id ) : undefined;
		if ( ! share ) {
			return;
		}
		if ( first ) {
			await copyLink( ctx, share.url );
		} else {
			ctx.host.toast?.( {
				message: sprintf(
					// translators: %s is the workspace name.
					__( 'Published. Everyone using %s gets the change the next time they load it.' ),
					desk.label,
				),
				type: 'success',
			} );
		}
	} finally {
		ui.publishing.delete( desk.id );
		ctx.repaint();
	}
}

function recipients( share: Share ): TemplateResult {
	if ( share.claimants.length === 0 ) {
		return html`<p class="os-workspaces__hint">${ __( 'Nobody has opened this link yet.' ) }</p>`;
	}
	const pinned = share.claimants.filter( ( c ) => c.pinned ).length;
	return html`
		<ul class="os-workspaces__people">
			${ share.claimants.map(
				( c ) => html`
					<li class="os-workspaces__person" os-key=${ String( c.user ) }>
						<span class="os-workspaces__person-name">${ c.name }</span>
						<span class="os-workspaces__person-email">${ c.email }</span>
						<os-badge tone=${ c.pinned ? 'info' : 'neutral' }>
							${ c.pinned ? __( 'Using it' ) : __( 'Released' ) }
						</os-badge>
						${ c.pinned
							? html`<os-button
									variant="ghost"
									os-action="release"
									os-arg-share=${ String( share.id ) }
									os-arg-user=${ String( c.user ) }
									os-confirm=${ sprintf(
										// translators: %s is a person's name.
										__( 'Release %s? Their own desks come back, and they keep this workspace as an ordinary desk they can change.' ),
										c.name,
									) }
									os-confirm-label=${ __( 'Release' ) }
								>${ __( 'Release' ) }</os-button>`
							: '' }
					</li>
				`,
			) }
		</ul>
		${ pinned > 1
			? html`<os-button
					variant="ghost"
					os-action="release"
					os-arg-share=${ String( share.id ) }
					os-arg-user="0"
					os-confirm=${ sprintf(
						// translators: %d is a number of people.
						_n( 'Release %d person?', 'Release all %d people?', pinned ),
						pinned,
					) }
					os-confirm-label=${ __( 'Release everyone' ) }
				>${ __( 'Release everyone' ) }</os-button>`
			: '' }
	`;
}

function linkControls( ctx: Ctx, share: Share ): TemplateResult {
	return html`
		<div class="os-workspaces__link">
			<os-text-field id=${ `${ ctx.windowId }-share-${ share.id }-link` } readonly label=${ __( 'Link' ) } value=${ share.url }></os-text-field>
			<os-button variant="secondary" @click=${ () => copyLink( ctx, share.url ) }>${ __( 'Copy link' ) }</os-button>
			<os-button
				variant="ghost"
				os-action="new_link"
				os-arg-share=${ String( share.id ) }
				os-confirm=${ __( 'Make a new link? The current one stops working at once. People already using the workspace keep it.' ) }
				os-confirm-label=${ __( 'New link' ) }
			>${ __( 'New link' ) }</os-button>
		</div>
		<p class="os-workspaces__hint">
			${ __( 'Only people who can write content on this site (contributors and up) can use it. Anyone else who opens it is told it is not for them.' ) }
		</p>
		<os-switch
			label=${ __( 'Link is on' ) }
			description=${ __( 'Turning it off stops new people claiming it. People already using it keep their desk.' ) }
			?checked=${ ! share.disabled }
			@os-switch-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
				void ctx.dispatch( 'set_disabled', { share: share.id, disabled: ! e.detail.checked } ) }
		></os-switch>
	`;
}

/** Remember disclosure state without sending it to the server. */
function rememberSection( ctx: Ctx, key: string, open: boolean ): void {
	const expanded = appUi( ctx ).expanded;
	if ( open ) {
		expanded.add( key );
	} else {
		expanded.delete( key );
	}
}

function shareSection( ctx: Ctx, desk: Desktop, share: Share | undefined ): TemplateResult {
	const key = `${ desk.id }-sharing`;
	const busy = appUi( ctx ).publishing.has( desk.id );
	const changed = !! share && !! desk.profile && profileFingerprint( desk.profile ) !== share.hash;
	const using = share?.claimants.filter( ( c ) => c.pinned ).length ?? 0;
	const status = share
		? `${ share.disabled ? __( 'Link off' ) : __( 'Link on' ) } · ${ sprintf(
			// translators: %d is a number of people using a shared workspace.
			_n( '%d person using it', '%d people using it', using ), using,
		) }`
		: __( 'Not shared' );
	return html`
		<div class="os-workspaces__share">
			${ changed
				? html`<div class="os-workspaces__changed" role="status">
						<os-badge tone="warning">${ __( 'Unpublished changes' ) }</os-badge>
						<os-button variant="secondary" ?disabled=${ busy } ?busy=${ busy } @click=${ () => publish( ctx, desk, false ) }>
							${ busy ? __( 'Publishing…' ) : __( 'Publish changes' ) }
						</os-button>
					</div>`
				: '' }
			<os-disclosure
				class="os-workspaces__details"
				heading=${ __( 'Sharing' ) }
				hint=${ status }
				?open=${ appUi( ctx ).expanded.has( key ) }
				@os-disclosure-toggle=${ ( e: CustomEvent< { open: boolean } > ) => rememberSection( ctx, key, e.detail.open ) }
			>
				<div class="os-workspaces__details-body">
					${ share
						? html`${ linkControls( ctx, share ) }
							<h4 class="os-workspaces__subhead">${ __( 'Who uses it' ) }</h4>
							${ recipients( share ) }`
						: html`<p class="os-workspaces__hint">
								${ __( 'Eligible contributors, authors and editors who open the link get this as their only desk until you release them. Their own desks are kept and return when released. Administrators get an ordinary copy.' ) }
							</p>
							<os-button variant="secondary" ?disabled=${ busy } ?busy=${ busy } @click=${ () => publish( ctx, desk, true ) }>
								${ busy ? __( 'Creating link…' ) : __( 'Create link' ) }
							</os-button>` }
				</div>
			</os-disclosure>
		</div>
	`;
}

function card( ctx: Ctx, desk: Desktop ): TemplateResult {
	const profile = desk.profile as WorkspaceProfile;
	const share = ctx.data.shares.find( ( s ) => s.mine && s.desktop === desk.id );
	const current = api()?.active()?.id === desk.id;
	const customizeKey = `${ desk.id }-customize`;
	const commitName = ( field: HTMLElement, value: string ): void => {
		const label = value.trim().slice( 0, DESKTOP_LABEL_MAX_LENGTH );
		if ( ! label ) {
			field.setAttribute( 'value', desk.label );
			ctx.host.toast?.( { message: __( 'A workspace needs a name. Your previous name was kept.' ), type: 'warning' } );
			return;
		}
		field.setAttribute( 'value', label );
		if ( label === desk.label ) {
			return;
		}
		if ( ! api()?.rename( desk.id, label ) ) {
			field.setAttribute( 'value', desk.label );
			ctx.host.toast?.( { message: __( 'Could not rename this workspace. Your previous name was kept.' ), type: 'warning' } );
			return;
		}
		if ( share ) {
			void ctx.dispatch( 'rename', { share: share.id, label } );
		}
	};
	const onName = ( e: CustomEvent< { value: string } > ): void => commitName( e.currentTarget as HTMLElement, e.detail.value );
	const remove = async (): Promise< void > => {
		const message = share
			? __( 'Your copy is deleted. The link keeps working, and the people using it keep theirs — you can still manage them here.' )
			: __( 'Its windows close with it.' );
		const ok = await ctx.host.confirm?.( {
			// translators: %s is the workspace name.
			title: sprintf( __( 'Delete %s?' ), desk.label ),
			message,
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ok ) {
			api()?.remove( desk.id );
		}
	};
	return html`
		<section
			class="os-workspaces__card"
			aria-label=${ desk.label }
			os-key=${ desk.id }
			style=${ profile.color ? `--os-workspace-accent: ${ profile.color }` : '' }
		>
			<header class="os-workspaces__card-head">
				<span class="os-workspaces__glyph dashicons ${ profile.icon || 'dashicons-desktop' }" aria-hidden="true"></span>
				<os-text-field
					id=${ `${ ctx.windowId }-${ desk.id }-name` }
					label=${ __( 'Workspace name' ) }
					maxlength=${ String( DESKTOP_LABEL_MAX_LENGTH ) }
					value=${ desk.label }
					@os-input-commit=${ onName }
					@os-submit=${ onName }
					@focusout=${ ( e: FocusEvent ) => {
						const field = e.currentTarget as HTMLElement & { value: string };
						commitName( field, field.value );
					} }
				></os-text-field>
				${ current ? html`<os-badge tone="info">${ __( 'Current desk' ) }</os-badge>` : '' }
			</header>

			<div class="os-workspaces__summary">
				<p class="os-workspaces__hint">${ sprintf(
					// translators: %d is a number of saved windows.
					_n( '%d saved window', '%d saved windows', profile.windows.length ), profile.windows.length,
				) }</p>
				${ profile.windows.length
					? html`<div class="os-workspaces__chips">${ profile.windows.slice( 0, 4 ).map(
						( win ) => html`<span class="os-workspaces__chip">${ win.title || api()?.apps().find( ( a ) => a.id === win.match )?.title || win.match }</span>`,
					) }${ profile.windows.length > 4 ? html`<span class="os-workspaces__chip">+${ profile.windows.length - 4 }</span>` : '' }</div>`
					: html`<p class="os-workspaces__hint">${ __( 'Open apps on this desk, then save its layout to keep them here.' ) }</p>` }
				${ profile.restricted ? html`<os-badge tone="neutral">${ __( 'Settings hidden' ) }</os-badge>` : '' }
			</div>

			<div class="os-workspaces__actions">
				<os-button variant="primary" ?disabled=${ current } @click=${ () => api()?.switchTo( desk.id ) }>${ current ? __( 'On this desk' ) : __( 'Go to desk' ) }</os-button>
				<os-button variant="secondary" @click=${ () => api()?.edit( desk.id ) }>${ __( 'Edit on its desk' ) }</os-button>
				${ mioAvailable()
					? html`<os-button variant="secondary" @click=${ () => askMio( ctx, desk.id ) }>✦ ${ __( 'Edit with MIO' ) }</os-button>`
					: '' }
			</div>

			<os-disclosure
				class="os-workspaces__details"
				heading=${ __( 'Customize' ) }
				hint=${ __( 'Icon, colour and settings access' ) }
				?open=${ appUi( ctx ).expanded.has( customizeKey ) }
				@os-disclosure-toggle=${ ( e: CustomEvent< { open: boolean } > ) => rememberSection( ctx, customizeKey, e.detail.open ) }
			>
				<div class="os-workspaces__details-body">
					<div class="os-workspaces__looks">
						<os-swatch-grid label=${ __( 'Icon' ) } mode="row">
							${ ICONS.map(
								( icon ) => html`<os-swatch
									size="small" variant="accent" value=${ icon.id } label=${ icon.label }
									?selected=${ icon.id === ( profile.icon || 'dashicons-desktop' ) }
									preview="var(--os-ui-surface-raised, #f0f0f1)"
									@os-pick=${ () => patchProfile( desk, { icon: icon.id } ) }
								><span class="dashicons ${ icon.id }" aria-hidden="true"></span></os-swatch>`,
							) }
						</os-swatch-grid>
						<os-swatch-grid label=${ __( 'Colour' ) } mode="row">
							${ COLORS.map(
								( color ) => html`<os-swatch
									size="small" variant="accent" value=${ color.value } label=${ color.label }
									?selected=${ color.value === ( profile.color || '' ) }
									preview=${ color.value || 'var(--os-ui-accent, #f252fc)' }
									@os-pick=${ () => patchProfile( desk, { color: color.value } ) }
								></os-swatch>`,
							) }
						</os-swatch-grid>
					</div>

					<os-checkbox
						id=${ `${ ctx.windowId }-${ desk.id }-restricted` }
						block
						label=${ __( 'Hide settings' ) }
						?checked=${ !! profile.restricted }
						@os-checkbox-change=${ ( e: CustomEvent< { checked: boolean } > ) =>
							patchProfile( desk, { restricted: e.detail.checked } ) }
					></os-checkbox>
					<p class="os-workspaces__hint os-workspaces__hint--indent">
						${ __( 'Leaves out Settings, OpenStation Preferences, plugins, themes, the Customizer, tools, users and updates. For people using your link, those screens are blocked, not just hidden.' ) }
					</p>

					<div class="os-workspaces__actions">
						<os-button variant="danger" @click=${ remove }>${ __( 'Delete workspace' ) }</os-button>
					</div>
				</div>
			</os-disclosure>

			${ ctx.data.canShare ? shareSection( ctx, desk, share ) : '' }
		</section>
	`;
}

/** A window, as far as the capture card needs one. */
interface ShellWindow {
	id: string;
	config: { title?: string; baseId?: string; desktopId?: string };
}

/**
 * The windows on the main desk that a save would keep — the same rule
 * the capture uses: every window, except this app.
 */
function mainDeskWindows( mainId: string ): ShellWindow[] {
	const manager = ( window.wp?.os as { windowManager?: { getAll(): ShellWindow[]; getActiveDesktopId(): string } } | undefined )?.windowManager;
	if ( ! manager ) {
		return [];
	}
	const active = manager.getActiveDesktopId();
	return manager
		.getAll()
		.filter( ( win ) => ( win.config.baseId || win.id ) !== APP_ID && ( win.config.desktopId || active ) === mainId );
}

/**
 * The main desk, as the workspace it would become.
 *
 * Not a button in the header: a card at the head of the list, in the
 * shape of the cards below it, dashed because it does not exist yet.
 * It says what saving keeps — the desk's name and the windows on it —
 * so pressing Save is never a guess, and the workspace it makes lands
 * right under it.
 */
function captureCard( ctx: Ctx, main: Desktop ): TemplateResult {
	const windows = mainDeskWindows( main.id );
	const shown = windows.slice( 0, 4 );
	const more = windows.length - shown.length;
	const summary =
		windows.length === 0
			? __( 'No windows open — the workspace would start empty. Open what the job needs first.' )
			: sprintf(
				// translators: %d is a number of windows.
				_n( '%d window, where it is, plus the widgets, apps and look.', '%d windows, where they are, plus the widgets, apps and look.', windows.length ),
				windows.length,
			);
	return html`
		<section class="os-workspaces__capture" aria-label=${ __( 'Save the main desk as a new workspace' ) }>
			<span class="os-workspaces__capture-glyph dashicons dashicons-images-alt2" aria-hidden="true"></span>
			<div class="os-workspaces__capture-body">
				<strong class="os-workspaces__capture-title">${ main.label }</strong>
				<span class="os-workspaces__hint">${ summary }</span>
				${ shown.length
					? html`<span class="os-workspaces__chips">
							${ shown.map( ( win ) => html`<span class="os-workspaces__chip">${ win.config.title || win.id }</span>` ) }
							${ more > 0 ? html`<span class="os-workspaces__chip os-workspaces__chip--more">+${ more }</span>` : '' }
						</span>`
					: '' }
			</div>
			<div class="os-workspaces__capture-actions">
				<os-button variant="secondary" @click=${ () => {
						const created = api()?.saveAs( main.id );
						if ( created ) {
							appUi( ctx ).nameFocus = created.id;
							ctx.repaint();
						}
					} }>
					${ __( 'Save as new workspace' ) }
				</os-button>
				<os-button
					variant="ghost"
					title=${ __( 'Back to how it was when OpenStation was installed. Your other workspaces are not touched.' ) }
					@click=${ () => void api()?.restoreMain() }
				>${ __( 'Restore main desk' ) }</os-button>
			</div>
		</section>
	`;
}

/** What the user "says" to MIO when they accept a step in the preview. */
function acceptedMessage( step: DraftStep ): string {
	switch ( step ) {
		case 'layout':
			return __( 'I accepted the layout.' );
		case 'apps':
			return __( 'I accepted the dock apps.' );
		case 'widgets':
			return __( 'I accepted the widgets.' );
		default:
			return __( 'I accepted the notes.' );
	}
}

/** The draft MIO is building, drawn — or nothing when there is none. */
function draftCard( ctx: Ctx ): TemplateResult | string {
	const ui = appUi( ctx );
	const draft = ui.draft;
	if ( ! draft ) {
		return '';
	}
	const apps = scanApps().map( ( a ) => ( { id: a.id, title: a.title, icon: a.icon, dock: a.dock } ) );
	return renderDraft( {
		draft,
		apps,
		widgets: listWidgets().map( ( w ) => ( { id: w.id, title: w.label, icon: w.icon } ) ),
		changed: () => ctx.repaint(),
		accepted: ( step ) => {
			ui.lease?.send( acceptedMessage( step ) );
		},
		create: () => {
			const result = commitDraft( draft, new Map() ) as { status?: string; created?: { name?: string }; saved?: { name?: string } };
			if ( 'confirmed' === result.status ) {
				ui.draft = null;
				ctx.host.toast?.( {
					message: sprintf(
						// translators: %s is the workspace name.
						__( '%s is ready.' ),
						result.created?.name ?? result.saved?.name ?? '',
					),
					type: 'success',
				} );
			}
			ctx.repaint();
		},
		discard: () => {
			ui.draft = null;
			ctx.repaint();
		},
	} );
}

/** Shares with no desk here: another admin's, or one whose desk was deleted. */
function orphanShares( ctx: Ctx, desks: Desktop[] ): TemplateResult {
	const here = new Set( desks.map( ( d ) => d.id ) );
	const orphans = ctx.data.shares.filter( ( s ) => ! s.mine || ! here.has( s.desktop ) );
	if ( ! ctx.data.canShare || orphans.length === 0 ) {
		return html``;
	}
	return html`
		<h3 class="os-workspaces__heading">${ __( 'Other shared links' ) }</h3>
		<p class="os-workspaces__hint">
			${ __( 'Links another admin made, or whose workspace you deleted. The people using them are still pinned until someone releases them.' ) }
		</p>
		${ orphans.map(
			( share ) => html`
				<section class="os-workspaces__card" os-key=${ `share-${ share.id }` }>
					<header class="os-workspaces__card-head">
						<span class="os-workspaces__glyph dashicons dashicons-admin-links" aria-hidden="true"></span>
						<div>
							<strong>${ share.label }</strong>
							<div class="os-workspaces__hint">
								${ share.mine
									? __( 'Shared by you' )
									: sprintf(
										// translators: %s is an admin's name.
										__( 'Shared by %s' ),
										share.authorName,
									) }
							</div>
						</div>
					</header>
					${ linkControls( ctx, share ) }
					<h4 class="os-workspaces__subhead">${ __( 'Who uses it' ) }</h4>
					${ recipients( share ) }
					<div class="os-workspaces__actions">
						<span class="os-app__spacer"></span>
						<os-button
							variant="danger"
							os-action="delete_share"
							os-arg-share=${ String( share.id ) }
							os-confirm=${ __( 'Delete this link? Everyone it pinned is released first, with their own desks back.' ) }
							os-confirm-label=${ __( 'Delete link' ) }
							os-confirm-danger
						>${ __( 'Delete link' ) }</os-button>
					</div>
				</section>
			`,
		) }
	`;
}

export default defineApp< AppState, AppData >( APP_ID, {
	placeholder: () => ( { canShare: false, shares: [] } ),

	view: ( ctx ) => {
		const desks = workspaceDesks( ctx.state );
		const main = api()?.list()[ 0 ];
		return html`
			<div class="os-workspaces" aria-busy=${ ctx.loading ? 'true' : 'false' }>
				<header class="os-workspaces__intro">
					<div class="os-workspaces__intro-text">
						<h2 class="os-workspaces__title">${ __( 'Workspaces' ) }</h2>
						<p class="os-workspaces__hint">
							${ mioAvailable()
								? __( 'Save your main desk as one below — or describe the desk you want and MIO builds it.' )
								: __( 'Save a desk for each job, then switch between them. Each workspace keeps its windows, apps, widgets and appearance.' ) }
						</p>
					</div>
					${ mioAvailable()
						? html`<os-button variant="holo" @click=${ () => askMio( ctx ) }>✦ ${ __( 'Build with MIO' ) }</os-button>`
						: '' }
				</header>

				${ draftCard( ctx ) }

				${ main ? captureCard( ctx, main ) : '' }

				${ desks.length === 0
					? html`<p class="os-workspaces__hint os-workspaces__none">
							${ __( 'No workspaces yet. The first one starts from the card above.' ) }
						</p>`
					: desks.map( ( desk ) => card( ctx, desk ) ) }

				${ orphanShares( ctx, desks ) }
			</div>
		`;
	},

	updated: ( ctx ) => {
		// Opened from the dock's "Build a workspace with MIO…": open the
		// chat once the window (and so its lease) is up.
		const ui = appUi( ctx );
		if ( ui.nameFocus ) {
			const id = `${ ctx.windowId }-${ ui.nameFocus }-name`;
			const field = Array.from( ctx.root.querySelectorAll( 'os-text-field' ) ).find( ( el ) => el.id === id );
			ui.nameFocus = '';
			field?.scrollIntoView?.( { block: 'nearest' } );
			// Kit fields paint on a microtask after the view.
			queueMicrotask( () => {
				const input = field?.shadowRoot?.querySelector< HTMLInputElement >( 'input' );
				input?.focus();
				input?.select();
			} );
		}
		if ( ctx.state.mio && ! ui.asked && ui.lease ) {
			ui.asked = true;
			askMio( ctx, ctx.state.focus );
		}
	},

	mounted: ( ctx ) => {
		const ui = appUi( ctx );
		ui.lease = mountWorkspacesMio(
			{
				host: ctx.root,
				windowId: ctx.windowId,
				target: () => ui.target,
			},
			{
				get: () => ui.draft,
				set: ( draft ) => {
					ui.draft = draft;
				},
				changed: () => ctx.repaint(),
			},
		);
		// The desks are the shell's. Repaint whenever one changes,
		// whoever changed it — this window, Overview, ⌘K, a plugin.
		const hooks = window.wp?.hooks;
		if ( ! hooks ) {
			return () => ui.lease?.dispose();
		}
		const ns = `openstation/workspaces-app/${ ctx.windowId }`;
		// Window events too: the capture card shows what the main desk
		// holds right now.
		const events = [
			'os.os.created',
			'os.os.closed',
			'os.os.renamed',
			'os.os.switched',
			'os.workspaces.updated',
			'os.window.opened',
			'os.window.closed',
		];
		for ( const event of events ) {
			hooks.addAction( event, ns, () => ctx.repaint() );
		}
		// MIO's availability can change while the window is open: the
		// MIO and AI switches in Preferences, and the AI status itself.
		const os = window.wp?.os as { subscribeOsSettings?: ( cb: () => void ) => ( () => void ) | void } | undefined;
		const unsubscribe = os?.subscribeOsSettings?.( () => ctx.repaint() );
		const onAi = (): void => ctx.repaint();
		document.addEventListener( 'os-ai-status-changed', onAi );
		return () => {
			for ( const event of events ) {
				hooks.removeAction( event, ns );
			}
			if ( 'function' === typeof unsubscribe ) {
				unsubscribe();
			}
			document.removeEventListener( 'os-ai-status-changed', onAi );
			ui.lease?.dispose();
			ui.lease = null;
		};
	},
} );
