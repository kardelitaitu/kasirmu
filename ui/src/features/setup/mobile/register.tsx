import { lazy } from 'react';
import { registerPage } from '@/registries/page-registry';

const MobileWelcomeFlow = lazy(() => import('./MobileWelcomeFlow'));

export function registerMobileSetupFeature() {
  registerPage({
    route: 'mobile-setup',
    component: MobileWelcomeFlow,
    label: 'Mobile Setup Wizard',
    fullscreen: true,
  });
}
