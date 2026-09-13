//! A stable `getString(id, args?)` for chart modules. The extracted
//! option-builders take Fluent lookup as a prop (so series names stay
//! translatable and the i18n gates can still see the keys at their call
//! sites); this adapts `l10n.getString`'s overload pair to one callback
//! with a stable identity for `useMemo` deps.

import { useCallback } from 'react';
import { useLocalization } from '@fluent/react';

export function useGetString() {
  const { l10n } = useLocalization();
  return useCallback(
    (id: string, args?: Record<string, string>) =>
      args ? l10n.getString(id, args) : l10n.getString(id),
    [l10n],
  );
}
