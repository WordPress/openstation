/**
 * os-ui core — public barrel.
 *
 * Component authors import from here:
 *
 *     import { Component, html, css, defineComponent } from '../core';
 */

export { Component, defineComponent } from './component';
export { html, render } from './html';
export type { TemplateResult } from './html';
export { css } from './css';
export type { StyleDef } from './css';
export { computeAutoId, ensureAutoId } from './auto-id';
export type {
	OsHelp,
	OsHelpCssProp,
	OsHelpEvent,
	OsHelpPart,
	OsHelpProp,
	OsHelpSlot,
	OsHelpStatus,
} from './help';
