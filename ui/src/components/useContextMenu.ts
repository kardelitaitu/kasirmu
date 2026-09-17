import { useState, useCallback, useRef, useEffect } from 'react';

export interface ContextMenuState {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const open = useCallback((e: React.MouseEvent, target: HTMLInputElement | HTMLTextAreaElement) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  const handleCopy = useCallback(async () => {
    if (!menu) return;
    try {
      const start = menu.target.selectionStart ?? 0;
      const end = menu.target.selectionEnd ?? 0;
      const text = menu.target.value.slice(Math.min(start, end), Math.max(start, end));
      if (text) {
        await navigator.clipboard.writeText(text);
      } else {
        await navigator.clipboard.writeText(menu.target.value);
      }
    } catch {
      // clipboard write denied
    }
    setMenu(null);
  }, [menu]);

  const handlePaste = useCallback(async () => {
    if (!menu) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const start = menu.target.selectionStart ?? menu.target.value.length;
        const before = menu.target.value.slice(0, start);
        const after = menu.target.value.slice(menu.target.selectionEnd ?? start);
        menu.target.value = before + text + after;

        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value',
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(menu.target, before + text + after);
        }
        menu.target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch {
      // clipboard read denied
    }
    setMenu(null);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu]);

  return { menu, menuRef, open, close, handleCopy, handlePaste };
}
