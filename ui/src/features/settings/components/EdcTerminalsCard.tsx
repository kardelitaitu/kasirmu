import { useState, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { plainErrorMessage } from '@/utils/app-error';
import {
  listEdcTerminalsScoped,
  createEdcTerminalScoped,
  updateEdcTerminalScoped,
  deleteEdcTerminalScoped,
  edcTerminalStatusScoped,
  type EdcTerminalDto,
} from '@/api/edc';
import SettingsSelect from '../SettingsSelect';
import './EdcTerminalsCard.css';

export interface EdcTerminalsCardProps {
  /** If provided, allows selecting a terminal as the register default. */
  terminalId?: string;
  /** Currently designated default terminal id for this register. */
  defaultTerminalId?: string;
  /** Called when this register sets or changes its default EDC terminal. */
  onSelectDefaultTerminal?: (terminalId: string) => void;
}

export function EdcTerminalsCard({
  defaultTerminalId,
  onSelectDefaultTerminal,
}: EdcTerminalsCardProps) {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [terminals, setTerminals] = useState<EdcTerminalDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});

  // Modal form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState<EdcTerminalDto | null>(null);
  const [name, setName] = useState('');
  const [connectionType, setConnectionType] = useState<'wired' | 'wireless'>('wired');
  const [transport, setTransport] = useState<'serial' | 'usb' | 'bluetooth' | 'tcp'>('serial');
  const [address, setAddress] = useState('');
  const [vendor, setVendor] = useState('');
  const [model, setModel] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTerminals = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const list = await listEdcTerminalsScoped(sessionToken);
      // Defend the state at the boundary: the render path reads
      // `terminals.length` and `terminals.map` unguarded (:248-:258), so a
      // backend that answers with a null/undefined body — or a caller whose
      // session predates the field — would crash the whole screen on
      // "Cannot read properties of undefined". Normalising once here keeps that
      // shape out of React state instead of scattering `?.` through the JSX.
      setTerminals(Array.isArray(list) ? list : []);
    } catch (err) {
      addToast({
        message: plainErrorMessage(err),
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, addToast]);

  useEffect(() => {
    fetchTerminals();
  }, [fetchTerminals]);

  const handleTestConnection = useCallback(
    async (id: string) => {
      if (!sessionToken) return;
      setTestingId(id);
      try {
        const result = await edcTerminalStatusScoped(sessionToken, id);
        setStatusMap((prev) => ({ ...prev, [id]: result.status }));
      } catch (err) {
        setStatusMap((prev) => ({ ...prev, [id]: 'error' }));
        addToast({
          message: plainErrorMessage(err),
          type: 'error',
        });
      } finally {
        setTestingId(null);
      }
    },
    [sessionToken, addToast],
  );

  const handleOpenAdd = () => {
    setEditingTerminal(null);
    setName('');
    setConnectionType('wired');
    setTransport('serial');
    setAddress('');
    setVendor('');
    setModel('');
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (t: EdcTerminalDto) => {
    setEditingTerminal(t);
    setName(t.name);
    setConnectionType(t.connectionType);
    setTransport(t.transport);
    setAddress(t.address);
    setVendor(t.vendor ?? '');
    setModel(t.model ?? '');
    setIsActive(t.isActive);
    setFormError(null);
    setModalOpen(true);
  };

  const handleConnectionTypeChange = (val: string) => {
    const ct = val as 'wired' | 'wireless';
    setConnectionType(ct);
    if (ct === 'wired') {
      setTransport('serial');
    } else {
      setTransport('tcp');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToken) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Terminal name is required');
      return;
    }
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setFormError('Device address / port is required');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (editingTerminal) {
        await updateEdcTerminalScoped(sessionToken, {
          id: editingTerminal.id,
          name: trimmedName,
          connectionType,
          transport,
          address: trimmedAddress,
          vendor: vendor.trim() || null,
          model: model.trim() || null,
          isActive,
        });
        addToast({
          message: l10n.getString('settings-edc-saved'),
          type: 'success',
        });
      } else {
        await createEdcTerminalScoped(sessionToken, {
          name: trimmedName,
          connectionType,
          transport,
          address: trimmedAddress,
          vendor: vendor.trim() || null,
          model: model.trim() || null,
          isActive,
        });
        addToast({
          message: l10n.getString('settings-edc-saved'),
          type: 'success',
        });
      }
      setModalOpen(false);
      await fetchTerminals();
    } catch (err) {
      setFormError(plainErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!sessionToken || !deleteConfirmId) return;
    setDeleting(true);
    try {
      await deleteEdcTerminalScoped(sessionToken, deleteConfirmId);
      addToast({
        message: l10n.getString('settings-edc-deleted'),
        type: 'success',
      });
      setDeleteConfirmId(null);
      await fetchTerminals();
    } catch (err) {
      addToast({
        message: plainErrorMessage(err),
        type: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  const transportOptions =
    connectionType === 'wired'
      ? [
          { value: 'serial', label: 'Serial (COM / tty)' },
          { value: 'usb', label: 'USB' },
        ]
      : [
          { value: 'tcp', label: 'TCP/IP (Network)' },
          { value: 'bluetooth', label: 'Bluetooth' },
        ];

  return (
    <Card className="edc-terminals-card">
      <div className="edc-terminals-header">
        <div>
          <h2 className="edc-terminals-title">
            <Localized id="settings-edc-title">EDC Card Terminals</Localized>
          </h2>
          <p className="edc-terminals-desc">
            <Localized id="settings-edc-description">
              Configure physical EDC payment terminals for card processing.
            </Localized>
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleOpenAdd}
          aria-label={l10n.getString('settings-edc-add')}
        >
          <Localized id="settings-edc-add">Add EDC Terminal</Localized>
        </Button>
      </div>

      {loading && terminals.length === 0 ? (
        <div className="edc-terminals-empty">Loading…</div>
      ) : terminals.length === 0 ? (
        <div className="edc-terminals-empty">
          <Localized id="settings-edc-empty">
            No EDC card terminals configured yet.
          </Localized>
        </div>
      ) : (
        <div className="edc-terminals-list">
          {terminals.map((t) => {
            const isDefault = defaultTerminalId === t.id;
            const currentStatus = statusMap[t.id];
            const isTesting = testingId === t.id;

            return (
              <div
                key={t.id}
                className={`edc-terminal-item ${isDefault ? 'edc-terminal-item--default' : ''}`}
              >
                <div className="edc-terminal-top">
                  <div className="edc-terminal-info">
                    <span className="edc-terminal-name">{t.name}</span>
                    <span className={`edc-badge edc-badge--${t.connectionType}`}>
                      {t.connectionType}
                    </span>
                    <span className="edc-badge">{t.transport}</span>
                    <span
                      className={`edc-badge edc-badge--${t.isActive ? 'active' : 'inactive'}`}
                    >
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {isDefault && (
                      <span className="edc-badge edc-badge--default">
                        Register Default
                      </span>
                    )}
                  </div>

                  <div className="edc-terminal-actions">
                    {currentStatus && (
                      <span
                        className={`edc-status-indicator edc-status-indicator--${currentStatus}`}
                      >
                        {currentStatus === 'ready' && (
                          <Localized id="settings-edc-status-ready">Ready</Localized>
                        )}
                        {currentStatus === 'busy' && (
                          <Localized id="settings-edc-status-busy">Busy</Localized>
                        )}
                        {currentStatus === 'offline' && (
                          <Localized id="settings-edc-status-offline">Offline</Localized>
                        )}
                        {currentStatus === 'error' && (
                          <Localized id="settings-edc-status-error">Error</Localized>
                        )}
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleTestConnection(t.id)}
                      disabled={isTesting}
                      aria-label={`${l10n.getString('settings-edc-test')} ${t.name}`}
                    >
                      {isTesting ? (
                        <Localized id="settings-edc-testing">Testing…</Localized>
                      ) : (
                        <Localized id="settings-edc-test">Test Connection</Localized>
                      )}
                    </Button>
                    {onSelectDefaultTerminal && !isDefault && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onSelectDefaultTerminal(t.id)}
                      >
                        Set as Default
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenEdit(t)}
                      aria-label={`${l10n.getString('settings-edc-edit')} ${t.name}`}
                    >
                      <Localized id="settings-edc-edit">Edit</Localized>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteConfirmId(t.id)}
                      aria-label={`${l10n.getString('settings-edc-delete')} ${t.name}`}
                    >
                      <Localized id="settings-edc-delete">Delete</Localized>
                    </Button>
                  </div>
                </div>

                <div className="edc-terminal-details">
                  <span>
                    <strong>Address:</strong> {t.address}
                  </span>
                  {t.vendor && (
                    <span>
                      <strong>Vendor:</strong> {t.vendor}
                    </span>
                  )}
                  {t.model && (
                    <span>
                      <strong>Model:</strong> {t.model}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Terminal Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingTerminal
            ? l10n.getString('settings-edc-edit')
            : l10n.getString('settings-edc-add')
        }
      >
        <form onSubmit={handleSubmit} className="edc-form">
          {formError && <div className="edc-form-error">{formError}</div>}

          <div className="settings-field">
            <label htmlFor="edc-name" className="settings-label">
              <Localized id="settings-edc-field-name">Terminal Name</Localized>
            </label>
            <Localized id="settings-edc-name-placeholder" attrs={{ placeholder: true }}>
              <input
                id="edc-name"
                type="text"
                className="settings-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. BCA Counter 1"
                required
                maxLength={120}
              />
            </Localized>
          </div>

          <div className="settings-field">
            <label htmlFor="edc-conn-type" className="settings-label">
              <Localized id="settings-edc-field-connection">Connection Type</Localized>
            </label>
            <SettingsSelect
              id="edc-conn-type"
              value={connectionType}
              onChange={handleConnectionTypeChange}
              options={[
                { value: 'wired', label: l10n.getString('settings-edc-conn-wired') },
                { value: 'wireless', label: l10n.getString('settings-edc-conn-wireless') },
              ]}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="edc-transport" className="settings-label">
              <Localized id="settings-edc-field-transport">Transport</Localized>
            </label>
            <SettingsSelect
              id="edc-transport"
              value={transport}
              onChange={(v) =>
                setTransport(v as 'serial' | 'usb' | 'bluetooth' | 'tcp')
              }
              options={transportOptions}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="edc-address" className="settings-label">
              <Localized id="settings-edc-field-address">Device Address / Port</Localized>
            </label>
            <Localized
              id={
                connectionType === 'wired'
                  ? 'settings-edc-address-wired-placeholder'
                  : 'settings-edc-address-wireless-placeholder'
              }
              attrs={{ placeholder: true }}
            >
              <input
                id="edc-address"
                type="text"
                className="settings-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={
                  connectionType === 'wired'
                    ? 'COM3, /dev/ttyUSB0, or loopback'
                    : '192.168.1.188:9000, MAC, or loopback'
                }
                required
                maxLength={255}
              />
            </Localized>
          </div>

          <div className="settings-field">
            <label htmlFor="edc-vendor" className="settings-label">
              <Localized id="settings-edc-field-vendor">Hardware Vendor</Localized>
            </label>
            <Localized id="settings-edc-vendor-placeholder" attrs={{ placeholder: true }}>
              <input
                id="edc-vendor"
                type="text"
                className="settings-input"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="e.g. ingenico, verifone, pax, loopback"
              />
            </Localized>
          </div>

          <div className="settings-field">
            <label htmlFor="edc-model" className="settings-label">
              <Localized id="settings-edc-field-model">Terminal Model</Localized>
            </label>
            <Localized id="settings-edc-model-placeholder" attrs={{ placeholder: true }}>
              <input
                id="edc-model"
                type="text"
                className="settings-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. iPP320, A920"
              />
            </Localized>
          </div>

          <div className="settings-field settings-field--horizontal">
            <label htmlFor="edc-active" className="settings-label">
              <Localized id="settings-edc-field-active">Active for Payment</Localized>
            </label>
            <span className="settings-toggle">
              <span className="sr-only">Toggle</span>
              <span className="settings-toggle-switch">
                <input
                  id="edc-active"
                  type="checkbox"
                  role="switch"
                  checked={isActive}
                  aria-checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Terminal'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={handleDelete}
        title={l10n.getString('settings-edc-delete')}
        message={l10n.getString('settings-edc-delete-confirm')}
        loading={deleting}
      />
    </Card>
  );
}
