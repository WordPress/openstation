/**
 * wpd-ui components barrel.
 *
 * Importing this file side-effect-registers every component in the
 * first batch with `customElements.define()`. After this import,
 * any `<wpd-*>` tag in the DOM upgrades automatically.
 *
 * Each component lives in its own folder with co-located styles
 * (`*.styles.ts`) and tests (`*.test.ts`), so a future refactor of
 * one component doesn't require touching any shared file.
 */

export { WpdSection } from './wpd-section/wpd-section';
export { WpdButton } from './wpd-button/wpd-button';
export { WpdSwatch } from './wpd-swatch/wpd-swatch';
export { WpdSwatchGrid } from './wpd-swatch-grid/wpd-swatch-grid';
export { WpdSegmented, WpdSegment } from './wpd-segmented/wpd-segmented';
export { WpdSelect, WpdOption } from './wpd-select/wpd-select';
export { WpdMultiselect } from './wpd-multiselect/wpd-multiselect';
export { WpdColorField } from './wpd-color-field/wpd-color-field';
export { WpdRangeField } from './wpd-range-field/wpd-range-field';
export { WpdTextField } from './wpd-text-field/wpd-text-field';
export { WpdNumberField } from './wpd-number-field/wpd-number-field';
export { WpdCheckbox } from './wpd-checkbox/wpd-checkbox';
export { WpdCheckboxLabel } from './wpd-checkbox-label/wpd-checkbox-label';
export { WpdToast, WpdToastContainer } from './wpd-toast/wpd-toast';
export { WpdTabs, WpdTab, WpdTabPanel } from './wpd-tabs/wpd-tabs';
export { WpdWindowButton } from './wpd-window-button/wpd-window-button';
export { WpdMenu, WpdMenuItem } from './wpd-menu/wpd-menu';
export { WpdContextMenu, WpdContextMenuOption } from './wpd-context-menu/wpd-context-menu';
export { WpdConfirmDialog, wpdConfirm } from './wpd-confirm-dialog/wpd-confirm-dialog';
export { WpdModal } from './wpd-modal/wpd-modal';
export { WpdUserSearch } from './wpd-user-search/wpd-user-search';
export { WpdRolePicker } from './wpd-role-picker/wpd-role-picker';
export { WpdFlyout } from './wpd-flyout/wpd-flyout';
export type { WpdFlyoutPlacement } from './wpd-flyout/wpd-flyout';
export { WpdTabChip } from './wpd-tab-chip/wpd-tab-chip';
export { WpdStack } from './wpd-stack/wpd-stack';
export { WpdCluster } from './wpd-cluster/wpd-cluster';
export { WpdIcon } from './wpd-icon/wpd-icon';
export { WpdBody } from './wpd-body/wpd-body';
export { WpdPanel } from './wpd-panel/wpd-panel';
export { WpdRow } from './wpd-row/wpd-row';
export { WpdGrid } from './wpd-grid/wpd-grid';
export { WpdDisplay } from './wpd-display/wpd-display';
export { WpdEmptyState } from './wpd-empty-state/wpd-empty-state';
export { WpdKey } from './wpd-key/wpd-key';
export { WpdCode } from './wpd-code/wpd-code';
export { WpdBadge } from './wpd-badge/wpd-badge';
export type { WpdBadgeTone } from './wpd-badge/wpd-badge';
export { WpdRibbon } from './wpd-ribbon/wpd-ribbon';
export type { WpdRibbonPlacement, WpdRibbonTone } from './wpd-ribbon/wpd-ribbon';
export { WpdTile } from './wpd-tile/wpd-tile';
export { WpdLog } from './wpd-log/wpd-log';
export type { WpdLogRowRenderer } from './wpd-log/wpd-log';
export { WpdSteps, WpdStep } from './wpd-steps/wpd-steps';
export { WpdTable } from './wpd-table/wpd-table';
export type {
	WpdTableColumn,
	WpdTableFilters,
	WpdTableGetRowId,
	WpdTableRowId,
	WpdTableSort,
	WpdTableSubTableFn,
	WpdTableSubTableResult,
} from './wpd-table/wpd-table';
export { WpdSpinner, WPD_SPINNER_PRESETS } from './wpd-spinner/wpd-spinner';
export type {
	WpdSpinnerConfig,
	WpdSpinnerPreset,
	WpdSpinnerPulse,
} from './wpd-spinner/wpd-spinner';
export { WpdRelativeTime } from './wpd-relative-time/wpd-relative-time';
export { WpdAvatar } from './wpd-avatar/wpd-avatar';
export type { WpdAvatarPresence } from './wpd-avatar/wpd-avatar';
export { WpdTextarea } from './wpd-textarea/wpd-textarea';
export { WpdChip } from './wpd-chip/wpd-chip';
export type { WpdChipTone, WpdChipSize } from './wpd-chip/wpd-chip';
export { WpdTagInput } from './wpd-tag-input/wpd-tag-input';
export type { WpdTagItem } from './wpd-tag-input/wpd-tag-input';
export { WpdForm } from './wpd-form/wpd-form';
export { WpdSaveStatus } from './wpd-save-status/wpd-save-status';
export type {
	WpdSaveStatusPhase,
	WpdSaveStatusMode,
	WpdSaveStatusLifecycleDetail,
} from './wpd-save-status/wpd-save-status';
export { WpdCategoryPicker } from './wpd-category-picker/wpd-category-picker';
export type { WpdCategoryItem } from './wpd-category-picker/wpd-category-picker';
export { WpdCrumbChain } from './wpd-crumb-chain/wpd-crumb-chain';
export type { WpdCrumbSegment } from './wpd-crumb-chain/wpd-crumb-chain';
export { WpdCard } from './wpd-card/wpd-card';
export { WpdRatingSummary } from './wpd-rating-summary/wpd-rating-summary';
export type { WpdRatingBuckets } from './wpd-rating-summary/wpd-rating-summary';
export { WpdNotice } from './wpd-notice/wpd-notice';
export type { WpdNoticeTone } from './wpd-notice/wpd-notice';
export { WpdReleaseCard } from './wpd-release-card/wpd-release-card';
export { WpdProgressBar } from './wpd-progress-bar/wpd-progress-bar';
export type { WpdProgressTone } from './wpd-progress-bar/wpd-progress-bar';

// List of tags registered by this barrel. Defined in `./tags`
// (the single source of truth, kept side-effect-free so tag-only
// consumers don't drag every component module into their bundle)
// and re-exported here for convenience. `doAction(
// COMPONENTS_REGISTERED, { tags } )` fires once from
// `src/desktop.ts` after the module graph settles, so
// subscribers needing to defer work until every `<wpd-*>` is
// callable have a single signal to latch onto.
export { WPD_COMPONENT_TAGS } from './tags';
