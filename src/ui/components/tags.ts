/**
 * Pure list of `<wpd-*>` tag names — no side effects, no class imports.
 *
 * Split out from `index.ts` so consumers that only need the tag list
 * (the COMPONENTS_REGISTERED action payload, the help-screen iterator,
 * tooling) do not drag every component module into their bundle.
 *
 * Keep in sync with the components actually defined under
 * `src/ui/components/`. The order matches `index.ts`.
 *
 * @since 0.8.4
 */

export const WPD_COMPONENT_TAGS = [
	'wpd-section',
	'wpd-button',
	'wpd-swatch',
	'wpd-swatch-grid',
	'wpd-segmented',
	'wpd-segment',
	'wpd-select',
	'wpd-option',
	'wpd-multiselect',
	'wpd-color-field',
	'wpd-range-field',
	'wpd-text-field',
	'wpd-number-field',
	'wpd-checkbox',
	'wpd-checkbox-label',
	'wpd-toast',
	'wpd-toast-container',
	'wpd-tabs',
	'wpd-tab',
	'wpd-tabpanel',
	'wpd-window-button',
	'wpd-menu',
	'wpd-menu-item',
	'wpd-context-menu',
	'wpd-context-menu-option',
	'wpd-confirm-dialog',
	'wpd-modal',
	'wpd-user-search',
	'wpd-role-picker',
	'wpd-flyout',
	'wpd-tab-chip',
	'wpd-stack',
	'wpd-cluster',
	'wpd-icon',
	'wpd-body',
	'wpd-panel',
	'wpd-row',
	'wpd-grid',
	'wpd-display',
	'wpd-empty-state',
	'wpd-key',
	'wpd-code',
	'wpd-badge',
	'wpd-log',
	'wpd-steps',
	'wpd-step',
	'wpd-table',
	'wpd-spinner',
	'wpd-relative-time',
	'wpd-avatar',
	'wpd-textarea',
	'wpd-chip',
	'wpd-tag-input',
	'wpd-form',
	'wpd-save-status',
	'wpd-category-picker',
	'wpd-crumb-chain',
	'wpd-card',
	'wpd-notice',
] as const;
