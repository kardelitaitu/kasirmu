import type React from 'react';
import { requiredLocalized } from '@/components';
import { useState, useEffect, useRef } from 'react';
import { useLocalization, Localized } from '@fluent/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { CategoryDto } from '@/api/products';

let catCounter = 0;

export interface AddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newCategory: CategoryDto) => void;
}

export const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const { l10n } = useLocalization();
  const [name, setName] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
    }
  }, [isOpen]);

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, isOpen, onClose);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) nameInputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newCategory: CategoryDto = {
      id: `cat-${Date.now()}-${catCounter++}`,
      name: name.trim(),
      colour: '#10b981',
      icon: '',
    };

    onSave(newCategory);
    onClose();
  };

  return (
    <>
    <div className="retail-edit-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} role="presentation" tabIndex={-1}>
      <div
        ref={panelRef}
        className="retail-edit-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="retail-add-category-title"
      >
        <div className="retail-edit-modal-header">
          <Localized id="retail-add-category-title">
            <h3 id="retail-add-category-title" className="retail-edit-modal-title">
              Add New Category
            </h3>
          </Localized>
          <Localized id="retail-edit-modal-close-aria" attrs={{ 'aria-label': true }}>
            <button
              type="button"
              className="retail-edit-modal-close"
              onClick={onClose}
              aria-label={l10n.getString('close-aria')}
            >
              &times;
            </button>
          </Localized>
        </div>

        <form onSubmit={handleSubmit} className="retail-edit-modal-form">
          <div className="retail-edit-form-group">
            <Localized id="retail-add-category-field-name">
              <label htmlFor="add-category-name" className="retail-edit-label">
                Category Name
              </label>
            </Localized>
            <input
              id="add-category-name"
              type="text"
              className="retail-edit-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={requiredLocalized(l10n, 'retail-add-category-name-placeholder')}
              ref={nameInputRef}
              required
            />
          </div>

          <div className="retail-edit-modal-actions">
            <Localized id="retail-edit-cancel">
              <button
                type="button"
                className="retail-edit-modal-btn retail-edit-modal-btn--secondary"
                onClick={onClose}
              >
                Cancel
              </button>
            </Localized>
            <Localized id="retail-edit-save">
              <button
                type="submit"
                className="retail-edit-modal-btn retail-edit-modal-btn--primary"
              >
                Save Category
              </button>
            </Localized>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};
