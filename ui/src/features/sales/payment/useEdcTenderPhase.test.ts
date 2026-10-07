import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEdcTenderPhase } from './useEdcTenderPhase';
import * as edcApi from '@/api/edc';
import type { CompleteSaleResult } from '@/api/sales';
import type { requiredLocalized } from '@/components';

vi.mock('@/api/edc', () => ({
  listEdcTerminalsScoped: vi.fn(),
  edcTerminalStatusScoped: vi.fn(),
  edcSale: vi.fn(),
}));

describe('useEdcTenderPhase', () => {
  const mockBuildGatewaySale = vi.fn();
  const mockSettleGatewaySale = vi.fn();
  const mockAddToast = vi.fn();
  const mockSetProcessing = vi.fn();
  const mockL10n = {
    getString: (key: string, args?: Record<string, unknown>) => `${key}:${JSON.stringify(args ?? {})}`,
  };
  const mockL10nRef = { current: mockL10n as unknown as Parameters<typeof requiredLocalized>[0] };

  const defaultProps = {
    sessionToken: 'test-session-token',
    effectiveTotalInCartCurrency: 50000,
    cartCurrency: 'IDR',
    buildGatewaySale: mockBuildGatewaySale,
    settleGatewaySale: mockSettleGatewaySale,
    l10nRef: mockL10nRef,
    addToast: mockAddToast,
    setProcessing: mockSetProcessing,
  };

  const sampleTerminals: edcApi.EdcTerminalDto[] = [
    {
      id: 'term-lane-1',
      name: 'Counter Lane 1',
      connectionType: 'wired',
      transport: 'serial',
      address: 'COM3',
      vendor: 'ingenico',
      model: 'iCT250',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'term-lane-2',
      name: 'Counter Lane 2',
      connectionType: 'wireless',
      transport: 'tcp',
      address: '192.168.1.102:8000',
      vendor: 'pax',
      model: 'A920',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'term-lane-inactive',
      name: 'Old Broken Terminal',
      connectionType: 'wired',
      transport: 'usb',
      address: 'USB001',
      vendor: null,
      model: null,
      isActive: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(edcApi.listEdcTerminalsScoped).mockResolvedValue(sampleTerminals);
    vi.mocked(edcApi.edcTerminalStatusScoped).mockResolvedValue({ status: 'ready' });
    vi.mocked(edcApi.edcSale).mockResolvedValue({
      success: true,
      transactionId: 'tx-123',
      authCode: 'AUTH999',
      cardScheme: 'Visa',
      cardLast4: '4321',
      message: 'APPROVED',
    });
    mockBuildGatewaySale.mockResolvedValue({ sale_id: 'sale-1' } as unknown as CompleteSaleResult);
    mockSettleGatewaySale.mockResolvedValue(undefined);
  });

  it('loads only active terminals and auto-selects preferred default terminal', async () => {
    const { result } = renderHook(() =>
      useEdcTenderPhase({
        ...defaultProps,
        defaultTerminalId: 'term-lane-2',
      }),
    );

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(2);
    });

    expect(result.current.terminals.map((t) => t.id)).toEqual(['term-lane-1', 'term-lane-2']);
    expect(result.current.selectedTerminalId).toBe('term-lane-2');
  });

  it('defaults to the first active terminal if defaultTerminalId is omitted', async () => {
    const { result } = renderHook(() => useEdcTenderPhase(defaultProps));

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(2);
    });

    expect(result.current.selectedTerminalId).toBe('term-lane-1');
  });

  it('allows switching selected terminal', async () => {
    const { result } = renderHook(() => useEdcTenderPhase(defaultProps));

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(2);
    });

    act(() => {
      result.current.setSelectedTerminalId('term-lane-2');
    });

    expect(result.current.selectedTerminalId).toBe('term-lane-2');
  });

  it('routes explicit terminalId to edcTerminalStatusScoped and edcSale', async () => {
    const { result } = renderHook(() =>
      useEdcTenderPhase({
        ...defaultProps,
        defaultTerminalId: 'term-lane-2',
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedTerminalId).toBe('term-lane-2');
    });

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(edcApi.edcTerminalStatusScoped).toHaveBeenCalledWith('test-session-token', 'term-lane-2');
    expect(edcApi.edcSale).toHaveBeenCalledWith('test-session-token', 50000, 'IDR', 'term-lane-2');
    expect(mockBuildGatewaySale).toHaveBeenCalledWith({
      method: 'CARD',
      gatewayReference: 'tx-123',
      gatewayStatus: 'captured',
      gatewayResponse: JSON.stringify({
        auth_code: 'AUTH999',
        card_scheme: 'Visa',
        card_last4: '4321',
        message: 'APPROVED',
      }),
    });
    expect(mockSettleGatewaySale).toHaveBeenCalledWith({ sale_id: 'sale-1' }, false, {
      method: 'Card',
      reference: 'AUTH999',
      cardLastFour: '4321',
    });
    expect(result.current.edc).toBeNull();
  });

  it('fails closed when terminal is offline and displays error toast without fallback', async () => {
    vi.mocked(edcApi.edcTerminalStatusScoped).mockResolvedValue({ status: 'offline' });

    const { result } = renderHook(() =>
      useEdcTenderPhase({
        ...defaultProps,
        defaultTerminalId: 'term-lane-1',
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedTerminalId).toBe('term-lane-1');
    });

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(edcApi.edcTerminalStatusScoped).toHaveBeenCalledWith('test-session-token', 'term-lane-1');
    // Fail closed: edcSale must NOT be called
    expect(edcApi.edcSale).not.toHaveBeenCalled();
    expect(result.current.edc).toBeNull();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
      }),
    );
  });

  it('transitions to declined phase when card is declined', async () => {
    vi.mocked(edcApi.edcSale).mockResolvedValue({
      success: false,
      transactionId: null,
      authCode: null,
      cardScheme: null,
      cardLast4: null,
      message: 'INSUFFICIENT FUNDS',
    });

    const { result } = renderHook(() => useEdcTenderPhase(defaultProps));

    await waitFor(() => {
      expect(result.current.selectedTerminalId).toBe('term-lane-1');
    });

    await act(async () => {
      await result.current.handleTerminalPay();
    });

    expect(result.current.edc).toEqual({
      phase: 'declined',
      reason: 'INSUFFICIENT FUNDS',
    });
    expect(mockSettleGatewaySale).not.toHaveBeenCalled();

    // Dismiss returns to null
    act(() => {
      result.current.handleTerminalDismiss();
    });
    expect(result.current.edc).toBeNull();
  });
});
