import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode, ReactElement } from 'react';
import { LocalizationProvider } from '@fluent/react';
import CardTenderPanel from './CardTenderPanel';
import type { EdcTerminalDto } from '@/api/edc';

const testL10n = {
  bundles: [],
  areBundlesEmpty: () => true,
  parseMarkup: (str: string) => [{ nodeName: '#text', textContent: str } as unknown as Node],
  getElement: (sourceElement: ReactElement) => sourceElement,
  getString: (id: string) => {
    const defaults: Record<string, string> = {
      'payment-edc-description': 'Charge the total on the connected card terminal — tap, insert or swipe.',
      'payment-edc-pay': 'Pay on card terminal',
      'payment-edc-select-terminal': 'Select Card Terminal',
    };
    return defaults[id] ?? id;
  },
  reportError: () => {},
  getBundle: () => null,
  getChildren: (str: string) => str,
};

function Wrapper({ children }: { children: ReactNode }) {
  return <LocalizationProvider l10n={testL10n}>{children}</LocalizationProvider>;
}

describe('CardTenderPanel', () => {
  const sampleTerminals: EdcTerminalDto[] = [
    {
      id: 'term-1',
      name: 'Counter 1 Terminal',
      connectionType: 'wired',
      transport: 'serial',
      address: 'COM1',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'term-2',
      name: 'Mobile Pax A920',
      connectionType: 'wireless',
      transport: 'tcp',
      address: '192.168.1.150:8000',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('renders nothing when terminalOffered is false', () => {
    const { container } = render(
      <Wrapper>
        <CardTenderPanel
          terminalOffered={false}
          processing={false}
          terminalPending={false}
          autoQrPending={false}
          onTerminalPay={vi.fn()}
        />
      </Wrapper>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders pay button and description when terminalOffered is true', () => {
    render(
      <Wrapper>
        <CardTenderPanel
          terminalOffered={true}
          processing={false}
          terminalPending={false}
          autoQrPending={false}
          onTerminalPay={vi.fn()}
        />
      </Wrapper>,
    );

    expect(screen.getByRole('button', { name: /Pay on card terminal/i })).toBeInTheDocument();
    expect(screen.getByText(/Charge the total on the connected card terminal/i)).toBeInTheDocument();
  });

  it('does not render terminal selection chips when single terminal', () => {
    render(
      <Wrapper>
        <CardTenderPanel
          terminalOffered={true}
          processing={false}
          terminalPending={false}
          autoQrPending={false}
          onTerminalPay={vi.fn()}
          terminals={[sampleTerminals[0]!]}
          selectedTerminalId="term-1"
        />
      </Wrapper>,
    );

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('renders terminal chips and allows selecting terminal when multiple terminals exist', () => {
    const onSelectTerminal = vi.fn();

    render(
      <Wrapper>
        <CardTenderPanel
          terminalOffered={true}
          processing={false}
          terminalPending={false}
          autoQrPending={false}
          onTerminalPay={vi.fn()}
          terminals={sampleTerminals}
          selectedTerminalId="term-1"
          onSelectTerminal={onSelectTerminal}
        />
      </Wrapper>,
    );

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const btn1 = screen.getByRole('radio', { name: /Counter 1 Terminal/i });
    const btn2 = screen.getByRole('radio', { name: /Mobile Pax A920/i });

    expect(btn1).toHaveAttribute('aria-checked', 'true');
    expect(btn2).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(btn2);
    expect(onSelectTerminal).toHaveBeenCalledWith('term-2');
  });
});
