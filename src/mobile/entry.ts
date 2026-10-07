import '../ui/components/os-button/os-button';
import '../ui/components/os-confirm-dialog/os-confirm-dialog';
import '../ui/components/os-context-menu/os-context-menu';
import '../ui/components/os-text-field/os-text-field';
import { mountMobileLayer } from './layer';
import type { MobileApi } from './types';

const factory: MobileApi = {
	mount: mountMobileLayer,
};

window.openStationMobile = factory;
