/**
 * My WordPress — the after-render wiring.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. This part owns everything that touches
 * the LIVE DOM after a paint: `wire()` runs once per window (drag-out,
 * marquee selection, infinite scroll, the extended-options
 * subscription, Escape), `afterRender()` runs after every render
 * (observer re-aim, scroll re-arm, menu clamping, server-rendered
 * content injection), and `agentsAfterRender()` is the Agents
 * section's slice of it (drop targets, drag-out, the face backfill,
 * the roster signal, the create-then-chat hand-off).
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import {
	faceFromSeed,
	hasFace,
} from '../../../src/my-wordpress/agents-face';
import {
	agentAcceptsDrop,
	describeDragEntity,
	dispatchAgentDrop,
	dragKindsFromTriggers,
} from '../../../src/agents-dispatch';
import { shell, uiOf, type Ctx } from './types';
import { sectionOf } from './helpers';
import { agentsMountIdOf, agentsRosterStamp, openChatWindow } from './agents';

/** Marquee + drag-out + infinite scroll + Escape, wired once per window. */
export function wire( ctx: Ctx ): () => void {
	const { root } = ctx;
	const ui = uiOf( root );
	const teardowns: Array< () => void > = [];

	// --- drag-out: rows lift into the shell DragManager -----------------
	const onPointerDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey ) {
			return;
		}
		const row = ( e.target as Element | null )?.closest< HTMLElement >( '[data-mywp-drag][data-item-id]' );
		if ( ! row ) {
			return;
		}
		const manager = shell().dragManager;
		if ( ! manager ) {
			return;
		}
		const id = Number( row.getAttribute( 'data-item-id' ) );
		const kind = row.getAttribute( 'data-mywp-drag' ) ?? '';
		const all = Array.from( ui.pages.values() ).flat();
		const item = all.find( ( i ) => i.id === id );
		if ( ! item ) {
			return;
		}
		const selectedItems = ctx.state.selected.includes( id )
			? all.filter( ( i ) => ctx.state.selected.includes( i.id ) )
			: [ item ];
		manager.start( {
			payload: {
				type: 'shortcut',
				source: row,
				data: {
					kind,
					ref: String( item.id ),
					title: item.title,
					icon: item.thumb || '',
					...( selectedItems.length > 1
						? {
							items: selectedItems.map( ( i ) => ( {
								kind,
								ref: String( i.id ),
								title: i.title,
								icon: i.thumb || '',
							} ) ),
						}
						: {} ),
				},
			},
			origin: e,
		} );
	};
	root.addEventListener( 'pointerdown', onPointerDown );
	teardowns.push( () => root.removeEventListener( 'pointerdown', onPointerDown ) );

	// --- marquee selection on the list canvas ---------------------------
	let marquee: { x: number; y: number; box: HTMLDivElement } | null = null;
	const onMarqueeDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		const canvas = ( e.target as Element | null )?.closest< HTMLElement >( '.os-mywp__canvas' );
		// Only a press on empty canvas starts a marquee — a press on a
		// row is a click or a drag-out.
		if ( ! canvas || ( e.target as Element ).closest( '[data-item-id]' ) ) {
			return;
		}
		const box = document.createElement( 'div' );
		box.className = 'os-mywp__marquee';
		document.body.appendChild( box );
		marquee = { x: e.clientX, y: e.clientY, box };
		if ( ! e.ctrlKey && ! e.metaKey && ! e.shiftKey ) {
			ctx.local( 'select-set', { ids: [] } );
		}
	};
	const onMarqueeMove = ( e: PointerEvent ): void => {
		if ( ! marquee ) {
			return;
		}
		const left = Math.min( marquee.x, e.clientX );
		const top = Math.min( marquee.y, e.clientY );
		const width = Math.abs( e.clientX - marquee.x );
		const height = Math.abs( e.clientY - marquee.y );
		Object.assign( marquee.box.style, {
			left: `${ left }px`,
			top: `${ top }px`,
			width: `${ width }px`,
			height: `${ height }px`,
		} );
		const ids: number[] = [];
		for ( const row of Array.from( root.querySelectorAll< HTMLElement >( '[data-item-id]' ) ) ) {
			const r = row.getBoundingClientRect();
			if ( r.left < left + width && r.right > left && r.top < top + height && r.bottom > top ) {
				ids.push( Number( row.getAttribute( 'data-item-id' ) ) );
			}
		}
		ctx.local( 'select-set', { ids } );
	};
	const onMarqueeUp = (): void => {
		if ( marquee ) {
			marquee.box.remove();
			marquee = null;
		}
	};
	root.addEventListener( 'pointerdown', onMarqueeDown );
	document.addEventListener( 'pointermove', onMarqueeMove );
	document.addEventListener( 'pointerup', onMarqueeUp );
	teardowns.push( () => {
		root.removeEventListener( 'pointerdown', onMarqueeDown );
		document.removeEventListener( 'pointermove', onMarqueeMove );
		document.removeEventListener( 'pointerup', onMarqueeUp );
		onMarqueeUp();
	} );

	// --- infinite scroll ------------------------------------------------
	// One page per scroll gesture: firing disarms the sentinel, the
	// canvas's next scroll re-arms it (see afterRender()), so a window
	// parked at the bottom never chain-loads every remaining page.
	ui.observer = new IntersectionObserver( ( entries ) => {
		if ( ! entries.some( ( entry ) => entry.isIntersecting ) || ui.loadingMore || ! ui.armed ) {
			return;
		}
		ui.armed = false;
		ui.loadingMore = true;
		ui.loadingPage = Math.max( 1, ...Array.from( ui.pages.keys() ) ) + 1;
		// Repaint now so the skeleton tiles appear while the page loads.
		ctx.local( 'repaint' );
		void ctx.dispatch( 'more' ).finally( () => {
			ui.loadingMore = false;
			ui.loadingPage = 0;
			ctx.local( 'repaint' );
		} );
	} );
	teardowns.push( () => ui.observer?.disconnect() );

	// --- agents: live re-render when the framework is toggled -----------
	// Agents can be switched off in Preferences while this very window
	// is open; the next dispatch is a fresh request, so the server
	// reads the flag anew and the section repaints its other state.
	const hooksApi = shell().hooks;
	const optionsNs = `openstation-apps/my-wordpress/${ agentsMountIdOf( root ) }`;
	hooksApi?.addAction?.(
		'os.extended-options.changed',
		optionsNs,
		( changePayload: unknown ) => {
			const next = ( changePayload as { options?: Record< string, boolean > } )?.options;
			if ( next && typeof next.agents === 'boolean' ) {
				void ctx.dispatch( 'refresh' );
			}
		},
	);
	teardowns.push( () => {
		hooksApi?.removeAction?.( 'os.extended-options.changed', optionsNs );
		for ( const deregister of ui.agentDropTargets.values() ) {
			deregister();
		}
		ui.agentDropTargets.clear();
	} );

	// --- hover card ------------------------------------------------------
	// WP Explorer's tile tooltip: a floating card with the title, the
	// lock banner, the thumbnail and the clamped excerpt. Same class
	// names as the original, so the palette-level
	// `--os-my-wordpress-card-*` family themes both windows' cards
	// identically. Appended to document.body because the window clips.
	let hoverTip: HTMLElement | null = null;
	let hoverFor = 0;
	const hideTip = (): void => {
		hoverTip?.remove();
		hoverTip = null;
		hoverFor = 0;
	};
	const positionTip = ( tip: HTMLElement, ev: MouseEvent ): void => {
		const offset = 16;
		let x = ev.clientX + offset;
		let y = ev.clientY + offset;
		const rect = tip.getBoundingClientRect();
		if ( x + rect.width > window.innerWidth - 8 ) {
			x = Math.max( 8, ev.clientX - rect.width - offset );
		}
		if ( y + rect.height > window.innerHeight - 8 ) {
			y = Math.max( 8, ev.clientY - rect.height - offset );
		}
		tip.style.left = `${ x }px`;
		tip.style.top = `${ y }px`;
	};
	const buildTip = ( item: {
		title: string;
		lockedBy: string;
		thumb: string;
		excerpt: string;
		subtitle: string;
	} ): HTMLElement => {
		const tip = document.createElement( 'div' );
		tip.className = 'os-my-wordpress__tooltip';
		tip.setAttribute( 'role', 'tooltip' );
		const heading = document.createElement( 'div' );
		heading.className = 'os-my-wordpress__tooltip-title';
		heading.textContent = item.title;
		tip.appendChild( heading );
		if ( item.lockedBy ) {
			const banner = document.createElement( 'div' );
			banner.className = 'os-my-wordpress__tooltip-lock';
			const icon = document.createElement( 'span' );
			icon.className = 'dashicons dashicons-lock';
			icon.setAttribute( 'aria-hidden', 'true' );
			banner.appendChild( icon );
			const text = document.createElement( 'span' );
			text.textContent = sprintf(
				/* translators: %s: the user name currently editing the post. */
				__( '%s is currently editing' ),
				item.lockedBy,
			);
			banner.appendChild( text );
			tip.appendChild( banner );
		}
		if ( item.thumb ) {
			const img = document.createElement( 'img' );
			img.className = 'os-my-wordpress__tooltip-thumb';
			img.src = item.thumb;
			img.alt = '';
			tip.appendChild( img );
		}
		// Posts quote their excerpt; users and media (which have none)
		// show their subtitle line, the fact their tile abbreviates.
		const excerpt = item.excerpt || item.subtitle;
		if ( excerpt ) {
			const p = document.createElement( 'p' );
			p.className = 'os-my-wordpress__tooltip-excerpt';
			p.textContent =
				excerpt.length > 240 ? excerpt.slice( 0, 237 ) + '…' : excerpt;
			tip.appendChild( p );
		}
		return tip;
	};
	const onTipOver = ( e: MouseEvent ): void => {
		const cell = ( e.target as Element | null )?.closest< HTMLElement >(
			'[data-mywp-drag][data-item-id]',
		);
		if ( ! cell ) {
			return;
		}
		const id = Number( cell.getAttribute( 'data-item-id' ) );
		if ( id === hoverFor ) {
			return;
		}
		const item = Array.from( ui.pages.values() )
			.flat()
			.find( ( i ) => i.id === id );
		if ( ! item ) {
			return;
		}
		hideTip();
		hoverTip = buildTip( item );
		hoverFor = id;
		document.body.appendChild( hoverTip );
		positionTip( hoverTip, e );
	};
	const onTipMove = ( e: MouseEvent ): void => {
		if ( ! hoverTip ) {
			return;
		}
		const cell = ( e.target as Element | null )?.closest(
			'[data-mywp-drag][data-item-id]',
		);
		if ( ! cell ) {
			hideTip();
			return;
		}
		positionTip( hoverTip, e );
	};
	root.addEventListener( 'mouseover', onTipOver );
	root.addEventListener( 'mousemove', onTipMove );
	root.addEventListener( 'mouseleave', hideTip );
	// A press means a click, a drag-out or the context menu — the card
	// must not sit over any of them.
	root.addEventListener( 'pointerdown', hideTip );
	root.addEventListener( 'contextmenu', hideTip );
	teardowns.push( () => {
		root.removeEventListener( 'mouseover', onTipOver );
		root.removeEventListener( 'mousemove', onTipMove );
		root.removeEventListener( 'mouseleave', hideTip );
		root.removeEventListener( 'pointerdown', hideTip );
		root.removeEventListener( 'contextmenu', hideTip );
		hideTip();
	} );

	// --- Escape closes menu → zoom → pane -------------------------------
	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key !== 'Escape' ) {
			return;
		}
		const state = uiOf( root );
		if ( state.menu ) {
			state.menu = null;
			ctx.local( 'repaint' );
		} else if ( state.zoom ) {
			state.zoom = false;
			ctx.local( 'repaint' );
		} else if ( ctx.state.item > 0 ) {
			void ctx.dispatch( 'open', { item: 0 } );
		}
	};
	root.addEventListener( 'keydown', onKey );
	teardowns.push( () => root.removeEventListener( 'keydown', onKey ) );

	return () => teardowns.forEach( ( off ) => off() );
}

/**
 * Fire WP Explorer's plugin seams over the freshly rendered DOM:
 *
 *   - `os.my-wordpress.group-extras` — once per open plugin folder,
 *     with a container above the folder tiles for whole-folder
 *     context (store totals on a shop folder, sync status on an
 *     importer's). Appended empty when nothing subscribes.
 *   - `os.my-wordpress.preview-extras` — once per named slot on the
 *     preview article (`header` / `meta` / `footer`), with the row so
 *     subscribers can paint their facts (the AllTerrain Work board
 *     meta, Woo's order analytics, …). Slots carry `os-preserve`, so
 *     the morph leaves whatever a plugin appended alone; the stamp
 *     keeps one firing per item, however many repaints follow.
 *   - `os.my-wordpress.list-tile` — once per rendered tile, after it
 *     is in the DOM (decorations added earlier are wiped when the
 *     tile paints on connect), with the row it stands for.
 */
function pluginSeamsAfterRender( ctx: Ctx ): void {
	const hooks = shell().hooks;
	if ( ! hooks?.doAction ) {
		return;
	}

	// --- group-extras -------------------------------------------------
	const groupHost = ctx.root.querySelector< HTMLElement >( '[data-mywp-group-extras]' );
	if ( groupHost ) {
		const groupId = groupHost.dataset.mywpGroupExtras ?? '';
		if ( groupHost.dataset.mywpExtrasFor !== groupId ) {
			groupHost.dataset.mywpExtrasFor = groupId;
			groupHost.replaceChildren();
			try {
				hooks.doAction( 'os.my-wordpress.group-extras', {
					container: groupHost,
					groupId,
					group: ctx.data.groups.find( ( g ) => g.id === groupId ) ?? null,
					entityIds: ctx.data.sections
						.filter( ( s ) => s.group === groupId )
						.map( ( s ) => s.id ),
				} );
			} catch ( err ) {
				// Plugin code — contained.
				// eslint-disable-next-line no-console
				console.error( '[my-wordpress] a group-extras subscriber threw.', err );
			}
		}
	}

	const section = sectionOf( ctx.data, ctx.state.section );
	if ( ! section || section.kind === 'agent' ) {
		return;
	}
	const rows = new Map< number, Record< string, unknown > >();
	for ( const row of Array.from( uiOf( ctx.root ).pages.values() ).flat() ) {
		rows.set( row.id, row as Record< string, unknown > );
	}

	// --- preview-extras ----------------------------------------------
	const detail = ctx.data.detail;
	const folder = ctx.data.folder;
	for ( const host of Array.from(
		ctx.root.querySelectorAll< HTMLElement >( '[data-mywp-slot]' ),
	) ) {
		const slot = host.dataset.mywpSlot ?? '';
		const itemId = Number( host.dataset.mywpExtrasItem ?? 0 );
		const stamp = `${ section.id }:${ slot }:${ itemId }`;
		if ( host.dataset.mywpExtrasFor === stamp ) {
			continue;
		}
		host.dataset.mywpExtrasFor = stamp;
		host.replaceChildren();
		// The richest row we hold: the list row (REST-visible meta and
		// taxonomy fields included) under the dossier's own fields.
		let item: Record< string, unknown > | null = null;
		if ( detail && detail.id === itemId ) {
			item = { ...( rows.get( itemId ) ?? {} ), ...detail };
		} else if ( folder && folder.id === itemId ) {
			item = { ...( rows.get( itemId ) ?? {} ), id: folder.id, title: folder.title, status: folder.status };
		}
		if ( ! item ) {
			continue;
		}
		try {
			hooks.doAction( 'os.my-wordpress.preview-extras', {
				slot,
				container: host,
				entityId: section.id,
				kind: section.kind,
				item,
			} );
		} catch ( err ) {
			// Plugin code — contained. One throwing subscriber must not
			// take the other slots (or the rest of the render wiring)
			// down with it.
			// eslint-disable-next-line no-console
			console.error( '[my-wordpress] a preview-extras subscriber threw.', err );
		}
	}

	// --- list-tile ----------------------------------------------------
	for ( const cell of Array.from(
		ctx.root.querySelectorAll< HTMLElement >( '[data-mywp-drag][data-item-id]' ),
	) ) {
		const tile = cell.querySelector< HTMLElement >( 'os-tile' );
		const id = Number( cell.getAttribute( 'data-item-id' ) );
		const item = rows.get( id );
		if ( ! tile || ! item || tile.dataset.mywpDecorated === String( id ) ) {
			continue;
		}
		tile.dataset.mywpDecorated = String( id );
		try {
			hooks.doAction( 'os.my-wordpress.list-tile', {
				tile,
				entityId: section.id,
				kind: section.kind,
				item,
			} );
		} catch ( err ) {
			// Plugin code — contained, per tile.
			// eslint-disable-next-line no-console
			console.error( '[my-wordpress] a list-tile subscriber threw.', err );
		}
	}
}

/** Runs after every render — the `updated()` half of the app. */
export function afterRender( ctx: Ctx ): void {
	const ui = uiOf( ctx.root );
	// Agents wiring: drop targets, drag-out, the face backfill, the
	// roster signal, the create-then-chat hand-off.
	agentsAfterRender( ctx );
	// Re-aim the infinite-scroll observer at the freshly rendered
	// sentinel — the morph may have replaced the element.
	ui.observer?.disconnect();
	const sentinel = ctx.root.querySelector( '[data-mywp-sentinel]' );
	if ( sentinel ) {
		ui.observer?.observe( sentinel );
	}
	// The tile canvas is rebuilt across renders; keep a scroll
	// listener on the current one to re-arm the sentinel — scroll
	// does not bubble, so delegation on the root cannot hear it.
	const canvas = ctx.root.querySelector< HTMLElement >( '.os-mywp__tiles' );
	if ( canvas !== ui.scrollEl ) {
		ui.scrollEl = canvas;
		canvas?.addEventListener(
			'scroll',
			() => {
				ui.armed = true;
			},
			{ passive: true },
		);
	}
	// The context menu paints hidden, then is measured, clamped
	// inside the viewport and revealed in one frame — the shell's
	// own placement pattern. Without the hidden frame the menu's
	// unclamped first paint flashes at the raw pointer position
	// before jumping into place.
	const menuEl = ctx.root.querySelector< HTMLElement >( 'os-context-menu.os-mywp__menu' );
	if ( menuEl && ui.menu ) {
		requestAnimationFrame( () => {
			if ( ! menuEl.isConnected ) {
				return;
			}
			const rect = menuEl.getBoundingClientRect();
			const margin = 8;
			if ( rect.right > window.innerWidth ) {
				menuEl.style.left = `${ Math.max( margin, window.innerWidth - rect.width - margin ) }px`;
			}
			if ( rect.bottom > window.innerHeight ) {
				menuEl.style.top = `${ Math.max( margin, window.innerHeight - rect.height - margin ) }px`;
			}
			menuEl.style.visibility = 'visible';
		} );
	}
	// A list shorter than the viewport can never be scrolled, so the
	// scroll-gesture re-arm would deadlock it at one page: while the
	// canvas has no scrollbar, keep the sentinel armed and let it
	// fill the viewport; once it overflows, gestures take over.
	if ( canvas && canvas.scrollHeight <= canvas.clientHeight + 4 ) {
		ui.armed = true;
	}
	// Inject the server-rendered post body — the preview pane's and
	// the detail folder's article alike. Trusted admin content from
	// our own dispatch, marked os-preserve so the diff never
	// touches it.
	const picked = ctx.data.subDetail;
	let pickedContent: string | undefined;
	if ( picked?.kind === 'revision' ) {
		pickedContent = picked.content;
	} else if ( picked?.kind === 'comment' ) {
		pickedContent = String( picked.stats.comment?.content ?? '' );
	}
	const subContent = picked ? { id: ctx.state.item, content: pickedContent } : null;
	for ( const [ where, source ] of [
		[ 'detail', ctx.data.detail ],
		[ 'folder', ctx.data.folder ],
		[ 'sub', subContent ],
	] as Array< [ string, { id: number; content?: string } | null ] > ) {
		const slot = ctx.root.querySelector< HTMLElement >( `[data-mywp-content="${ where }"]` );
		if ( slot && source?.content !== undefined ) {
			const stamp = `${ source.id }:${ source.content.length }`;
			if ( slot.dataset.mywpStamp !== stamp ) {
				slot.dataset.mywpStamp = stamp;
				slot.innerHTML = source.content;
			}
		}
	}
	// WP Explorer's preview-extras + list-tile seams over the new DOM —
	// LAST, so a throwing subscriber can never break the app's own
	// wiring above (each fire is also try/caught individually).
	pluginSeamsAfterRender( ctx );
}

/**
 * The after-render wiring for the Agents section: drop targets and
 * drag-out on the cast cards, the face backfill, the "Send to" roster
 * signal, and the create-then-chat hand-off.
 */
function agentsAfterRender( ctx: Ctx ): void {
	const ui = uiOf( ctx.root );
	const payload = ctx.data.agents;
	const section = sectionOf( ctx.data, ctx.state.section );
	const active = !! payload && section?.kind === 'agent';

	if ( ! active || ! payload ) {
		// The section closed — release every drop target it registered.
		for ( const deregister of ui.agentDropTargets.values() ) {
			deregister();
		}
		ui.agentDropTargets.clear();
		return;
	}

	// The roster signal: WP Explorer's "Send to" menu cache re-warms on
	// this action, so a trigger edit made here reaches its menus
	// without a reload. First sight only stamps.
	const stamp = agentsRosterStamp( payload.list );
	if ( ui.rosterStamp !== stamp ) {
		const first = ui.rosterStamp === '' && payload.list.length > 0;
		ui.rosterStamp = stamp || '·';
		if ( ! first && stamp !== '' ) {
			shell().hooks?.doAction?.( 'os.agents.roster-changed' );
		}
	}

	// Create-then-chat: the pending create landed (the wizard closed
	// onto the new agent) — open the chat window it asked for.
	if ( ui.chatAfterCreate && ! ctx.state.casting && ctx.state.item > 0 ) {
		const created = payload.list.find( ( a ) => a.id === ctx.state.item );
		if ( created ) {
			ui.chatAfterCreate = false;
			openChatWindow( payload, created );
		}
	}
	if ( ui.chatAfterCreate && ctx.state.casting && ctx.state.agentNotice !== '' ) {
		// The create failed — do not open a chat for the NEXT success.
		ui.chatAfterCreate = false;
	}

	// (Re)register every cast card as a drop target, and prune targets
	// whose agent left the list — re-registering the same id replaces
	// the element binding in place, so repaints never leak targets.
	const dragManager = shell().dragManager;
	const mountId = agentsMountIdOf( ctx.root );
	const seen = new Set< number >();
	if ( dragManager?.registerDropTarget ) {
		ctx.root
			.querySelectorAll< HTMLElement >( '.dm-agents__cast-card[data-agent-id]' )
			.forEach( ( row ) => {
				const agentId = Number.parseInt( row.dataset.agentId ?? '', 10 );
				const agent = payload.list.find( ( a ) => a.id === agentId );
				if ( ! agent ) {
					return;
				}
				seen.add( agentId );
				// Drag-out: lifting a card drops the agent anywhere the
				// files layer accepts a `user` shortcut — the same
				// `'shortcut'` payload `attachTileDragOut` emits, inlined
				// so the app bundle does not pull the os-tile module in.
				// Guarded per element — the card may survive a repaint,
				// and a second listener would double-start the drag.
				if ( ! row.dataset.dmAgentDragOut ) {
					row.dataset.dmAgentDragOut = '1';
					row.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
						if ( e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey ) {
							return;
						}
						const manager = shell().dragManager;
						if ( ! manager ) {
							return;
						}
						manager.start( {
							payload: {
								type: 'shortcut',
								source: row,
								data: {
									kind: 'user',
									ref: String( agentId ),
									title: agent.name,
									icon: 'dashicons-admin-users',
									entityId: 'agents',
								},
							},
							origin: e,
						} );
					} );
				}
				ui.agentDropTargets.set(
					agentId,
					dragManager.registerDropTarget!( {
						id: `dm-agents-row-${ mountId }-${ agentId }`,
						element: row,
						accept: ( dropPayload: unknown ) =>
							agentAcceptsDrop(
								dragKindsFromTriggers( agent.triggers ),
								describeDragEntity( dropPayload as never ),
								agent.id,
							),
						acceptLabel: __( 'Send to agent' ),
						onDrop: ( session: { payload: unknown } ) => {
							const entity = describeDragEntity( session.payload as never );
							if ( ! entity ) {
								return;
							}
							void dispatchAgentDrop(
								{
									id: agent.id,
									name: agent.name,
									description: agent.description,
									avatarUrl: agent.avatarUrl,
								},
								entity,
								{
									restRoot: payload.restRoot,
									restNonce: payload.restNonce,
								},
							);
						},
					} as never ),
				);
			} );
	}
	for ( const [ agentId, deregister ] of ui.agentDropTargets ) {
		if ( ! seen.has( agentId ) ) {
			deregister();
			ui.agentDropTargets.delete( agentId );
		}
	}

	// Give a face to every agent that has a seed but no look — one per
	// pass, so concurrent dispatches never race the state. Rolling it
	// here keeps one implementation of the randomizer; storing it is
	// what gets the portrait onto disk for `get_avatar()`. A backfill
	// is a courtesy: one refusal must not take the grid down, so each
	// id is attempted once per window.
	if ( payload.canManage && ! ui.agentBusy ) {
		const faceless = payload.list.find(
			( a ) => ! hasFace( a.face ) && a.faceSeed > 0 && ! ui.agentBackfilled.has( a.id ),
		);
		if ( faceless ) {
			ui.agentBackfilled.add( faceless.id );
			void ctx.dispatch( 'agent-update', {
				id: faceless.id,
				face: faceFromSeed( faceless.faceSeed ),
				faceSeed: faceless.faceSeed,
			} );
		}
	}
}
