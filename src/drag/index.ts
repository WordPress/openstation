/**
 * OpenStation — Drag module barrel.
 *
 * `wp.os.dragManager` is the public surface. Plugin authors
 * register drop targets via `dragManager.registerDropTarget()` and
 * (rarely) start sessions via `dragManager.start()` for plugin-defined
 * draggable surfaces.
 *
 * Cross-iframe Media Library drags continue to flow through
 * `wp.os.dragBridge` (`src/drag-bridge.ts`) — that's a payload
 * channel, separate from this gesture manager.
 */

export { DragManager } from './manager';
export type {
	CancelReason,
	DragManagerApi,
	DragPayload,
	DragSession,
	DropTarget,
	GhostConfig,
	GhostHintConfig,
	StartOpts,
} from './types';
export { DRAG_EVENTS, DRAG_THRESHOLD_PX } from './types';
