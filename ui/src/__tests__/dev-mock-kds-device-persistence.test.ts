// ── Dev-mock: a registered KDS device must appear in the device list ──────
//
// WHY THIS FILE EXISTS
//
// Third instance of one defect shape, after the KDS order create stub
// (0e2ddc7ac) and refund persistence (515ff1644): a command that returns a
// success value whose read-back disagrees with it.
//
// kdsDeviceHandlers (handlers/kds-devices.ts) did this:
//   register_kds_device_scoped  -> returns a full device object with a fresh id
//   list_kds_devices_scoped     -> () => []
//   get_kds_device_scoped       -> null
//   deactivate_kds_device_scoped-> {}
//
// So KdsEnrollmentModal reported success, and KdsDeviceStatusIndicator — which
// polls listKdsDevicesScoped (KdsDeviceStatusIndicator.tsx:97) — kept rendering
// 0/0. The kitchen enrolls a display and is told it has none.
//
// The handler file's own header says the bodies need "no shared-state seam"
// because each is a pure copy. That was true of the drafts and is exactly what
// made the pair disagree; these tests pin the seam.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type KdsDevice = {
  id: string;
  name: string;
  restaurant_pos_id: string;
  station_ids: string[];
  is_active: boolean;
  last_seen_at: string;
  connection_status: string;
  created_at: string;
  updated_at: string;
};

const register = (name: string): Promise<KdsDevice> =>
  invoke<KdsDevice>('register_kds_device_scoped', {
    sessionToken: 'mock-token',
    input: { name, restaurant_pos_id: 'resto-1', station_ids: ['grill'] },
  });

const list = (): Promise<KdsDevice[]> =>
  invoke<KdsDevice[]>('list_kds_devices_scoped', { sessionToken: 'mock-token' });

describe('dev-mock KDS device registration', () => {
  it('lists the device it just registered', async () => {
    const name = `Grill Display ${Date.now()}`;
    const created = await register(name);
    expect(created.id, 'register must return the new device id').toBeTruthy();

    const devices = await list();
    const found = devices.find((d) => d.id === created.id);
    expect(
      found,
      'register_kds_device_scoped returned ' +
        created.id +
        ' but list_kds_devices_scoped does not contain it — the command and ' +
        'the read-back disagree (the status indicator will render 0/0)',
    ).toBeTruthy();
    expect(found!.name).toBe(name);
  });

  it('answers with every field the device contract declares', async () => {
    // api/kds.ts KdsDevice. A dropped/renamed key typechecks against the
    // untyped mock literal and then renders undefined in the device dropdown.
    const created = await register('Cold Line Display');
    expect(Object.keys(created).sort()).toEqual([
      'connection_status',
      'created_at',
      'id',
      'is_active',
      'last_seen_at',
      'name',
      'restaurant_pos_id',
      'station_ids',
      'updated_at',
    ]);
    expect(created.is_active).toBe(true);
    expect(created.station_ids).toEqual(['grill']);
  });

  it('finds a registered device by id', async () => {
    const created = await register('Expo Display');
    const fetched = await invoke<KdsDevice | null>('get_kds_device_scoped', {
      sessionToken: 'mock-token',
      id: created.id,
    });
    expect(
      fetched,
      'get_kds_device_scoped must return a device that was just registered',
    ).toBeTruthy();
    expect(fetched!.id).toBe(created.id);
  });

  it('drops a deactivated device from the default listing', async () => {
    const created = await register('Spare Display');
    await invoke('deactivate_kds_device_scoped', { sessionToken: 'mock-token', id: created.id });

    const devices = await list();
    expect(
      devices.find((d) => d.id === created.id),
      'a deactivated device must not still list as active',
    ).toBeFalsy();
  });
});
