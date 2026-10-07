import { __, createMarquee, sprintf } from '@openstation/app';
import { clampToViewport } from '../../../src/ui/util/menu-position';
import {
	clearFootprintTarget,
	readFootprintTarget,
	subscribeFootprintTarget,
} from '../../../src/open-targets/footprint-target';
import {
	clearExplorerOpenTarget,
	readExplorerOpenTarget,
	subscribeExplorerOpenTarget,
	type ExplorerOpenTarget,
} from '../../../src/open-targets/explorer-open';
import {
	clearAgentEditorTarget,
	readAgentEditorTarget,
	subscribeAgentEditorTarget,
} from '../../../src/agents-editor-target';
import {
	registerSendToMenuFilter,
	setSendToEnabled,
} from './agents-send-to';
import {
	faceFromSeed,
	hasFace,
} from './agents-face';
import {
	agentAcceptsDrop,
	describeDragEntity,
	dispatchAgentDrop,
	dragKindsFromTriggers,
} from '../../../src/agents-dispatch';
import { isMobileStamped } from '../../../src/mode/stamp';
import type { DragBridgePayload } from '../../../src/drag-bridge';
import { shell, uiOf, type Ctx, type ListItem, type SectionDef } from './types';
import { openPreview, previewDetail } from './optimistic';
import { sectionOf } from './helpers';
import { agentsMountIdOf, agentsRosterStamp, openChatWindow } from './agents';

function bridgePayloadOf( section: SectionDef | null, item: ListItem ): DragBridgePayload | undefined {
	if ( ! section || ! item.link ) {
		return undefined;
	}
	if ( section.kind === 'media' ) {
		return {
			kind: 'attachment',
			id: item.id,
			url: item.link,
			title: item.title,
			alt: item.alt ?? '',
			mime: item.mime,
			thumbnailUrl: item.thumb || undefined,
		};
	}
	if ( section.kind === 'user' ) {
		return { kind: 'user', id: item.id, url: item.link, title: item.title };
	}

	if ( section.kind === 'post' && ! section.flat ) {
		return { kind: 'post', id: item.id, postType: section.post_type, url: item.link, title: item.title };
	}
	return undefined;
}

export function wire( ctx: Ctx ): () => void {
	const { root } = ctx;
	const ui = uiOf( ctx );
	const teardowns: Array< () => void > = [];

	const onPointerDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || isMobileStamped() ) {
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
		const all = ui.list.items();
		const item = all.find( ( i ) => i.id === id );
		if ( ! item ) {
			return;
		}

		const section = sectionOf( ctx.data, ctx.state.section );
		const entityId = section?.id ?? '';
		const restPath = String( section?.restPath ?? '' );
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
					entityId,
					restPath,
					bridgePayload: bridgePayloadOf( section, item ),
					...( selectedItems.length > 1
						? {
							items: selectedItems.map( ( i ) => ( {
								kind,
								ref: String( i.id ),
								title: i.title,
								icon: i.thumb || '',
								entityId,
								restPath,
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

	if ( ! isMobileStamped() ) {
		teardowns.push(
			createMarquee( {
				root,
				canvas: '.os-mywp__canvas',
				className: 'os-mywp__marquee',
				select: ( ids ) => ctx.local( 'select-set', { ids } ),
			} ),
		);
	}

	teardowns.push( () => ui.list.dispose() );

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

		if ( ! cell || cell.closest( '[data-mywp-list]' ) ) {
			return;
		}
		const id = Number( cell.getAttribute( 'data-item-id' ) );
		if ( id === hoverFor ) {
			return;
		}
		const item = ui.list.items().find( ( i ) => i.id === id );
		if ( ! item ) {
			return;
		}
		hideTip();

		hoverFor = id;
		const card = hooksApi?.applyFilters(
			'os.my-wordpress.hover-card',
			null,
			item,
			{ build: buildTip, cell, event: e },
		);
		if ( ! ( card instanceof HTMLElement ) ) {
			return;
		}
		hoverTip = card;
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

	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key !== 'Escape' ) {
			return;
		}
		const state = uiOf( ctx );
		if ( state.menu ) {
			state.menu = null;
			ctx.repaint();
		} else if ( state.columnsMenu ) {
			state.columnsMenu = null;
			ctx.repaint();
		} else if ( state.zoom ) {
			state.zoom = false;
			ctx.repaint();
		} else if ( ctx.state.footprint > 0 ) {
			void ctx.dispatch( 'back' );
		} else if ( ctx.state.item > 0 ) {
			openPreview( ctx, 0 );
		}
	};
	root.addEventListener( 'keydown', onKey );
	teardowns.push( () => root.removeEventListener( 'keydown', onKey ) );

	const consumeFootprintTarget = ( target: { userId: number | null; userName: string } ): void => {
		const userId = Number( target.userId );
		if ( ! Number.isFinite( userId ) || userId <= 0 ) {
			return;
		}
		clearFootprintTarget();
		if ( Number( ctx.state.footprint ) === userId ) {
			return;
		}
		void ctx.dispatch( 'footprint', { user: userId, name: target.userName } );
	};
	consumeFootprintTarget( readFootprintTarget() );
	teardowns.push( subscribeFootprintTarget( consumeFootprintTarget ) );

	const consumeOpenTarget = ( target: ExplorerOpenTarget ): void => {
		if ( ! target.kind || ! ( Number( target.id ) > 0 ) ) {
			return;
		}
		clearExplorerOpenTarget();
		void ctx.dispatch( 'go', { section: target.entityId } );
		if ( target.kind === 'media' ) {
			void ctx.dispatch( 'open', { item: target.id } );
		} else {
			void ctx.dispatch( 'into', { item: target.id } );
		}
	};
	consumeOpenTarget( readExplorerOpenTarget() );
	teardowns.push( subscribeExplorerOpenTarget( consumeOpenTarget ) );

	const consumeAgentTarget = ( target: { agentId: number | null } ): void => {
		const agentId = Number( target.agentId );
		if ( ! Number.isFinite( agentId ) || agentId <= 0 ) {
			return;
		}
		clearAgentEditorTarget();
		void ctx.dispatch( 'go', { section: 'agents' } );
		void ctx.dispatch( 'open', { item: agentId } );
	};
	consumeAgentTarget( readAgentEditorTarget() );
	teardowns.push( subscribeAgentEditorTarget( consumeAgentTarget ) );

	setSendToEnabled( ctx.data.agentsEnabled === true );
	if ( ( window.wp as { hooks?: unknown } | undefined )?.hooks ) {
		registerSendToMenuFilter();
	}

	return () => teardowns.forEach( ( off ) => off() );
}

function pluginSeamsAfterRender( ctx: Ctx ): void {
	const hooks = shell().hooks;
	if ( ! hooks?.doAction ) {
		return;
	}

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
				console.error( '[my-wordpress] a group-extras subscriber threw.', err );
			}
		}
	}

	const section = sectionOf( ctx.data, ctx.state.section );
	if ( ! section || section.kind === 'agent' ) {
		return;
	}
	const rows = new Map< number, Record< string, unknown > >();
	for ( const row of uiOf( ctx ).list.items() ) {
		rows.set( row.id, row as unknown as Record< string, unknown > );
	}

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
			console.error( '[my-wordpress] a preview-extras subscriber threw.', err );
		}
	}

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
			console.error( '[my-wordpress] a list-tile subscriber threw.', err );
		}
	}
}

export function afterRender( ctx: Ctx ): void {
	const ui = uiOf( ctx );

	setSendToEnabled( ctx.data.agentsEnabled === true );

	agentsAfterRender( ctx );

	ui.list.sync( {
		sentinel: ctx.root.querySelector( '[data-mywp-sentinel]' ),

		canvas: ctx.root.querySelector< HTMLElement >( '.os-mywp__canvas' ),
		load: () => ctx.dispatch( 'more' ),
		repaint: () => ctx.repaint(),
	} );

	if ( ui.revealSelection ) {
		ui.revealSelection = false;
		const target = ctx.state.item > 0 ? ctx.state.item : ( ctx.state.selected[ 0 ] ?? 0 );
		if ( target > 0 ) {
			ctx.root
				.querySelector< HTMLElement >( `[data-item-id="${ target }"]` )
				?.scrollIntoView?.( { block: 'nearest' } );
		}
	}

	for ( const menuEl of Array.from(
		ctx.root.querySelectorAll< HTMLElement >( 'os-context-menu.os-mywp__menu' ),
	) ) {
		if ( ui.menu || ui.columnsMenu ) {
			clampToViewport( menuEl );
		}
	}

	const picked = ctx.data.subDetail;
	let pickedContent: string | undefined;
	if ( picked?.kind === 'revision' ) {
		pickedContent = picked.content;
	} else if ( picked?.kind === 'comment' ) {
		pickedContent = String( picked.stats.comment?.content ?? '' );
	}
	const subContent = picked ? { id: ctx.state.item, content: pickedContent } : null;
	for ( const [ where, source ] of [
		[ 'detail', previewDetail( ctx ) ],
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

	pluginSeamsAfterRender( ctx );
}

function agentsAfterRender( ctx: Ctx ): void {
	const ui = uiOf( ctx );
	const payload = ctx.data.agents;
	const section = sectionOf( ctx.data, ctx.state.section );
	const active = !! payload && section?.kind === 'agent';

	if ( ! active || ! payload ) {
		for ( const deregister of ui.agentDropTargets.values() ) {
			deregister();
		}
		ui.agentDropTargets.clear();
		return;
	}

	const stamp = agentsRosterStamp( payload.list );
	if ( ui.rosterStamp !== stamp ) {
		const first = ui.rosterStamp === '' && payload.list.length > 0;
		ui.rosterStamp = stamp || '·';
		if ( ! first && stamp !== '' ) {
			shell().hooks?.doAction?.( 'os.agents.roster-changed' );
		}
	}

	if ( ui.chatAfterCreate && ! ctx.state.casting && ctx.state.item > 0 ) {
		const created = payload.list.find( ( a ) => a.id === ctx.state.item );
		if ( created ) {
			ui.chatAfterCreate = false;
			openChatWindow( payload, created );
		}
	}
	if ( ui.chatAfterCreate && ctx.state.casting && ctx.state.agentNotice !== '' ) {
		ui.chatAfterCreate = false;
	}

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

				if ( ! row.dataset.dmAgentDragOut ) {
					row.dataset.dmAgentDragOut = '1';
					row.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
						if ( e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || isMobileStamped() ) {
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
