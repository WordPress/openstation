/**
 * Desktop Mode — Folder share-settings modal.
 *
 * Imperative `openShareSettingsModal( folderId )` — mounts a
 * `<wpd-modal>` on `document.body` configured to manage the
 * folder's share list. Owner-only; the caller is expected to
 * have gated on ownership before calling.
 *
 * @since 0.18.0
 */

import { showToast } from '../toast';
import {
	acceptShare,
	denyShare,
	inviteShare,
	listPlacements,
	listShares,
	revokeShare,
	updateShareCapability,
	type RestShareShape,
} from './rest';
import { setFolderPlacements } from './store';
import { setSharesForFolder, sharesStore, upsertShare, removeShare } from './shares-store';

// Side-effect-import every component the modal renders so it
// upgrades the moment the modal is mounted — no waiting on the
// shell-overlays lazy bundle, no race-y "missing import" warning.
import '../ui/components/wpd-modal/wpd-modal';
import '../ui/components/wpd-user-search/wpd-user-search';
import '../ui/components/wpd-role-picker/wpd-role-picker';
import '../ui/components/wpd-segmented/wpd-segmented';
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-toast/wpd-toast';
import '../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';

interface OpenOptions {
	folderId: number;
	folderName: string;
	ownerName?: string;
}

/**
 * Build a Read / Read+Write segmented control wired to a callback.
 * Encapsulates the two-segment layout the share modal uses
 * everywhere it needs to pick a capability.
 *
 * The component's default theme assumes a LIGHT surface (selected
 * segment = pure white, unselected text = light gray). The share
 * modal is dark, so we override the inherited theme variables on
 * the host: pill background is a translucent white slab, the
 * selected segment becomes the accent color, unselected text is
 * a high-contrast rgba(255,255,255,…) muted.
 *
 * @since 0.18.0
 */
function buildCapSegmented(
	initial: 'read' | 'write',
	onChange: ( next: 'read' | 'write' ) => void,
): HTMLElement {
	const segmented = document.createElement( 'wpd-segmented' );
	segmented.setAttribute( 'value', initial );
	segmented.setAttribute( 'label', 'Capability' );

	// Dark-theme CSS-variable overrides. These cascade through the
	// component's shadow boundary because custom properties inherit.
	segmented.style.setProperty( '--wpd-segmented-bg', 'rgba(255,255,255,0.06)' );
	segmented.style.setProperty(
		'--desktop-mode-window-bg',
		'var(--wp-admin-theme-color, #2271b1)',
	);
	segmented.style.setProperty( '--desktop-mode-text', '#fff' );
	segmented.style.setProperty( '--desktop-mode-muted', 'rgba(255,255,255,0.65)' );

	const segRead = document.createElement( 'wpd-segment' );
	segRead.setAttribute( 'value', 'read' );
	segRead.textContent = 'Read';
	segmented.appendChild( segRead );

	const segWrite = document.createElement( 'wpd-segment' );
	segWrite.setAttribute( 'value', 'write' );
	segWrite.textContent = 'Read + Write';
	segmented.appendChild( segWrite );

	segmented.addEventListener( 'wpd-pick', ( e ) => {
		const detail = ( e as CustomEvent< { value: 'read' | 'write' } > ).detail;
		onChange( detail.value );
	} );
	return segmented;
}

/**
 * Build a small "×" icon button styled for the dark modal. Uses
 * `<wpd-button>` so it inherits the rest of the design system,
 * but with explicit CSS-variable overrides for legibility on
 * the dark surface.
 *
 * @since 0.18.0
 */
function buildIconButton(
	label: string,
	onClick: () => void,
	opts: { danger?: boolean } = {},
): HTMLElement {
	const btn = document.createElement( 'wpd-button' );
	btn.setAttribute( 'variant', 'ghost' );
	btn.setAttribute( 'aria-label', opts.danger ? 'Remove' : 'Dismiss' );
	btn.textContent = label;
	const fg = opts.danger ? '#ff8080' : 'rgba(255,255,255,0.75)';
	const border = opts.danger
		? '1px solid rgba(255,128,128,0.45)'
		: '1px solid rgba(255,255,255,0.18)';
	btn.style.setProperty( '--wpd-button-fg', fg );
	btn.style.setProperty( '--wpd-button-border', border );
	// Match the segmented control's vertical metrics (~34px total
	// height) so the × button doesn't visually float above the row.
	btn.style.setProperty( '--wpd-button-padding', '6px 12px' );
	btn.style.setProperty( '--wpd-button-border-radius', '7px' );
	btn.style.setProperty( '--wpd-button-min-height', '34px' );
	btn.style.minWidth = '34px';
	btn.style.fontSize = '18px';
	btn.style.lineHeight = '1';
	btn.addEventListener( 'click', onClick );
	return btn;
}

export async function openShareSettingsModal( opts: OpenOptions ): Promise< void > {
	const modal = document.createElement( 'wpd-modal' );
	modal.setAttribute( 'open', '' );
	modal.setAttribute( 'size', 'lg' );
	modal.setAttribute( 'title', `Share "${ opts.folderName }"` );
	document.body.appendChild( modal );

	let shares: RestShareShape[] = [];
	let pendingPicks: Array< {
		kind: 'user' | 'role';
		ref: string;
		label: string;
		cap: 'read' | 'write';
	} > = [];

	const renderBody = (): void => {
		modal.innerHTML = '';

		// Owner caption.
		const owner = document.createElement( 'div' );
		owner.style.cssText = 'opacity:0.7;margin-bottom:14px;font-size:12px;';
		owner.textContent = opts.ownerName
			? `Owner: ${ opts.ownerName } — cannot be changed`
			: 'Owner cannot be changed';
		modal.appendChild( owner );

		// Add people row.
		const addPeople = document.createElement( 'div' );
		addPeople.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:14px;';
		const addPeopleLabel = document.createElement( 'div' );
		addPeopleLabel.textContent = 'Add people';
		addPeopleLabel.style.cssText = 'font-weight:600;';
		addPeople.appendChild( addPeopleLabel );

		const userSearch = document.createElement( 'wpd-user-search' );
		const excludedUserIds = shares
			.filter( ( s ) => s.principalType === 'user' )
			.map( ( s ) => s.principalRef )
			.concat( pendingPicks.filter( ( p ) => p.kind === 'user' ).map( ( p ) => p.ref ) );
		userSearch.setAttribute( 'exclude', excludedUserIds.join( ',' ) );
		userSearch.setAttribute( 'placeholder', 'Search users…' );
		userSearch.addEventListener( 'wpd-user-pick', ( e ) => {
			const detail = ( e as CustomEvent< { user: { id: number; name: string } } > ).detail;
			pendingPicks.push( {
				kind: 'user',
				ref: String( detail.user.id ),
				label: detail.user.name,
				cap: 'read',
			} );
			renderBody();
		} );
		addPeople.appendChild( userSearch );
		modal.appendChild( addPeople );

		// Add roles row.
		const addRoles = document.createElement( 'div' );
		addRoles.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:14px;';
		const addRolesLabel = document.createElement( 'div' );
		addRolesLabel.textContent = 'Add roles';
		addRolesLabel.style.cssText = 'font-weight:600;';
		addRoles.appendChild( addRolesLabel );

		const rolePicker = document.createElement( 'wpd-role-picker' );
		const grantedRoles = shares
			.filter( ( s ) => s.principalType === 'role' )
			.map( ( s ) => s.principalRef );
		const pickedRoles = pendingPicks
			.filter( ( p ) => p.kind === 'role' )
			.map( ( p ) => p.ref );
		rolePicker.setAttribute( 'selected', [ ...grantedRoles, ...pickedRoles ].join( ',' ) );
		rolePicker.addEventListener( 'wpd-role-toggle', ( e ) => {
			const detail = ( e as CustomEvent< { slug: string; selected: boolean } > ).detail;
			// If the role is already a granted share, treat toggle as a revoke.
			const existing = shares.find(
				( s ) => s.principalType === 'role' && s.principalRef === detail.slug,
			);
			if ( existing ) {
				if ( ! detail.selected ) {
					void revoke( existing );
				}
				return;
			}
			if ( detail.selected ) {
				const eligible =
					( window.desktopModeConfig?.shareEligibleRoles ?? [] ).find(
						( r ) => r.slug === detail.slug,
					);
				pendingPicks.push( {
					kind: 'role',
					ref: detail.slug,
					label: eligible ? eligible.name : detail.slug,
					cap: 'read',
				} );
			} else {
				pendingPicks = pendingPicks.filter(
					( p ) => ! ( p.kind === 'role' && p.ref === detail.slug ),
				);
			}
			renderBody();
		} );
		addRoles.appendChild( rolePicker );
		modal.appendChild( addRoles );

		// Pending picks (not yet sent to server) — show as chips with
		// per-row capability toggle + a "Send invites" action below.
		if ( pendingPicks.length > 0 ) {
			const pendingBlock = document.createElement( 'div' );
			pendingBlock.style.cssText =
				'border:1px dashed rgba(255,255,255,0.18);border-radius:8px;padding:10px;margin-bottom:14px;';
			const pendingTitle = document.createElement( 'div' );
			pendingTitle.textContent = 'New invites (not sent yet)';
			pendingTitle.style.cssText = 'font-weight:600;margin-bottom:6px;font-size:12px;';
			pendingBlock.appendChild( pendingTitle );

			for ( const pick of pendingPicks ) {
				const row = document.createElement( 'div' );
				row.style.cssText =
					'display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;';
				const tag = document.createElement( 'span' );
				tag.textContent = pick.kind === 'role' ? `Role: ${ pick.label }` : pick.label;
				tag.style.flex = '1';
				row.appendChild( tag );

				const capSeg = buildCapSegmented( pick.cap, ( next ) => {
					pick.cap = next;
				} );
				row.appendChild( capSeg );

				const removeBtn = buildIconButton( '×', () => {
					pendingPicks = pendingPicks.filter(
						( p ) => ! ( p.kind === pick.kind && p.ref === pick.ref ),
					);
					renderBody();
				} );
				row.appendChild( removeBtn );

				pendingBlock.appendChild( row );
			}

			const sendBtn = document.createElement( 'wpd-button' );
			sendBtn.setAttribute( 'variant', 'primary' );
			sendBtn.textContent = `Send ${ pendingPicks.length } invite${ pendingPicks.length === 1 ? '' : 's' }`;
			sendBtn.style.marginTop = '8px';
			sendBtn.addEventListener( 'click', async () => {
				if ( pendingPicks.length === 0 ) {
					return;
				}
				sendBtn.setAttribute( 'busy', '' );
				sendBtn.setAttribute( 'disabled', '' );
				// Snapshot the picks BEFORE any mutation. Each pick
				// already carries its `cap` so we don't reach into the
				// DOM at send time (the old code did, which broke when
				// the modal re-rendered mid-send).
				const snapshot = pendingPicks.slice();
				let succeeded = 0;
				let firstError: Error | null = null;
				for ( const pick of snapshot ) {
					try {
						// We don't trust the inline response for store
						// updates — `refresh()` below pulls the canonical
						// list. This makes us resilient to a server that
						// happens to ship a parseable-but-truncated body
						// (PHP notice, gzip glitch, etc.).
						await inviteShare( opts.folderId, {
							principalType: pick.kind,
							principalRef: pick.ref,
							capability: pick.cap,
						} );
						succeeded++;
					} catch ( err ) {
						firstError = err as Error;
						break;
					}
				}
				if ( succeeded > 0 ) {
					pendingPicks = pendingPicks.slice( succeeded );
				}
				try {
					await refresh();
				} catch ( _e ) {
					// `refresh()` swallows its own errors via toast.
				}
				if ( firstError ) {
					showToast( {
						message: `Could not send invites: ${ firstError.message }`,
					} );
				} else {
					showToast( {
						message:
							1 === succeeded
								? 'Invite sent.'
								: `${ succeeded } invites sent.`,
					} );
				}
				sendBtn.removeAttribute( 'busy' );
				sendBtn.removeAttribute( 'disabled' );
				renderBody();
			} );
			pendingBlock.appendChild( sendBtn );
			modal.appendChild( pendingBlock );
		}

		// Existing access rows.
		const listTitle = document.createElement( 'div' );
		listTitle.textContent = 'Who has access';
		listTitle.style.cssText = 'font-weight:600;margin:8px 0 6px;';
		modal.appendChild( listTitle );

		if ( shares.length === 0 ) {
			const empty = document.createElement( 'div' );
			empty.textContent = 'Only you can see this folder.';
			empty.style.cssText = 'opacity:0.6;font-size:12px;';
			modal.appendChild( empty );
		} else {
			for ( const s of shares ) {
				const row = document.createElement( 'div' );
				row.style.cssText =
					'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);';

				const label = document.createElement( 'div' );
				label.style.flex = '1';
				label.textContent =
					s.principalType === 'role' ? `Role: ${ s.displayName }` : s.displayName;
				if ( s.state === 'pending' ) {
					const tag = document.createElement( 'span' );
					tag.textContent = ' · pending';
					tag.style.cssText = 'opacity:0.6;font-size:12px;';
					label.appendChild( tag );
				} else if ( s.state === 'denied' ) {
					const tag = document.createElement( 'span' );
					tag.textContent = ' · denied';
					tag.style.cssText = 'color:#d63638;font-size:12px;';
					label.appendChild( tag );
				}
				row.appendChild( label );

				const cap = s.capability === 'write' ? 'write' : 'read';
				const capSeg = buildCapSegmented( cap, ( next ) => {
					void changeCap( s, next );
				} );
				row.appendChild( capSeg );

				const removeBtn = buildIconButton(
					'×',
					() => {
						void revoke( s );
					},
					{ danger: true },
				);
				row.appendChild( removeBtn );

				modal.appendChild( row );
			}
		}

		// Footer.
		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );
		const doneBtn = document.createElement( 'wpd-button' );
		doneBtn.setAttribute( 'variant', 'secondary' );
		doneBtn.textContent = 'Done';
		doneBtn.addEventListener( 'click', () => modal.remove() );
		footer.appendChild( doneBtn );
		modal.appendChild( footer );
	};

	const refresh = async (): Promise< void > => {
		try {
			const res = await listShares( opts.folderId );
			shares = res.shares;
			setSharesForFolder( opts.folderId, shares );
		} catch ( err ) {
			showToast( {
				message: `Could not load shares: ${ ( err as Error ).message }`,
			} );
		}
		renderBody();
	};

	const revoke = async ( s: RestShareShape ): Promise< void > => {
		try {
			await revokeShare( opts.folderId, s.id );
			removeShare( opts.folderId, s.id );
			await refresh();
			showToast( { message: 'Access revoked.' } );
		} catch ( err ) {
			showToast( {
				message: `Could not revoke: ${ ( err as Error ).message }`,
			} );
		}
	};

	const changeCap = async ( s: RestShareShape, cap: 'read' | 'write' ): Promise< void > => {
		try {
			const next = await updateShareCapability( opts.folderId, s.id, cap );
			upsertShare( next );
			await refresh();
		} catch ( err ) {
			showToast( {
				message: `Could not update capability: ${ ( err as Error ).message }`,
			} );
		}
	};

	modal.addEventListener( 'wpd-modal-cancel', () => modal.remove() );

	renderBody();
	await refresh();
}

/**
 * Recipient-facing modal: shows an invite and offers
 * Accept / Deny / Decide later. Returns when the user makes
 * a decision (or dismisses without deciding).
 *
 * @since 0.18.0
 */
export function openPendingInviteModal( invite: {
	id: number;
	folderId: number;
	folderName?: string;
	ownerName?: string;
	capability: string;
} ): Promise< 'accepted' | 'denied' | 'dismissed' > {
	return new Promise( ( resolve ) => {
		const modal = document.createElement( 'wpd-modal' );
		modal.setAttribute( 'open', '' );
		modal.setAttribute( 'title', invite.folderName
			? `${ invite.ownerName ?? 'Someone' } shared "${ invite.folderName }" with you`
			: 'Folder shared with you' );

		const body = document.createElement( 'div' );
		const capLabel = invite.capability === 'write' ? 'Read + Write' : 'Read';
		body.innerHTML = `
			<p style="margin: 0 0 12px;">Accept the invite to add this folder to your desktop.</p>
			<p style="margin: 0; opacity: 0.75;">Access level: <strong>${ capLabel }</strong></p>
		`;
		modal.appendChild( body );

		const footer = document.createElement( 'div' );
		footer.setAttribute( 'slot', 'footer' );

		const laterBtn = document.createElement( 'wpd-button' );
		laterBtn.setAttribute( 'variant', 'secondary' );
		laterBtn.textContent = 'Decide later';
		laterBtn.addEventListener( 'click', () => {
			modal.remove();
			resolve( 'dismissed' );
		} );

		const denyBtn = document.createElement( 'wpd-button' );
		denyBtn.setAttribute( 'variant', 'danger' );
		denyBtn.textContent = 'Deny';
		denyBtn.addEventListener( 'click', async () => {
			denyBtn.setAttribute( 'busy', '' );
			denyBtn.setAttribute( 'disabled', '' );
			try {
				await denyShare( invite.folderId, invite.id );
				sharesStore().state.deniedFolders.add( invite.folderId );
				sharesStore().notify();
				modal.remove();
				resolve( 'denied' );
			} catch ( err ) {
				showToast( {
					message: `Could not deny: ${ ( err as Error ).message }`,
				} );
				denyBtn.removeAttribute( 'busy' );
				denyBtn.removeAttribute( 'disabled' );
			}
		} );

		const acceptBtn = document.createElement( 'wpd-button' );
		acceptBtn.setAttribute( 'variant', 'primary' );
		acceptBtn.textContent = 'Accept';
		acceptBtn.addEventListener( 'click', async () => {
			acceptBtn.setAttribute( 'busy', '' );
			acceptBtn.setAttribute( 'disabled', '' );
			try {
				await acceptShare( invite.folderId, invite.id );
				// The server just created our placement of the
				// shared folder at parent_id=0. Pull the canonical
				// root placement list so the new tile appears on
				// the desktop without waiting for the next
				// heartbeat tick (which can take up to ~60s).
				try {
					const res = await listPlacements( 0 );
					setFolderPlacements( 0, res.placements );
				} catch ( _e ) {
					// Non-fatal — heartbeat will eventually sync.
				}
				modal.remove();
				resolve( 'accepted' );
			} catch ( err ) {
				showToast( {
					message: `Could not accept: ${ ( err as Error ).message }`,
				} );
				acceptBtn.removeAttribute( 'busy' );
				acceptBtn.removeAttribute( 'disabled' );
			}
		} );

		footer.appendChild( laterBtn );
		footer.appendChild( denyBtn );
		footer.appendChild( acceptBtn );
		modal.appendChild( footer );

		modal.addEventListener( 'wpd-modal-cancel', () => {
			modal.remove();
			resolve( 'dismissed' );
		} );

		document.body.appendChild( modal );
	} );
}
