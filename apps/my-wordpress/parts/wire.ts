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

import { __ } from '@openstation/app';
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
