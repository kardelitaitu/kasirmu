import React, { useEffect, useRef } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  idPrefix?: string;
  error?: boolean;
}

export default function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  idPrefix = 'otp-digit',
  error = false,
}: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Split the value string into array of single characters
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus && inputsRef.current[0] && !value) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus, value]);

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '');
    if (!val) {
      // Empty/cleared
      const newDigits = [...digits];
      newDigits[index] = '';
      const newVal = newDigits.join('');
      onChange(newVal);
      return;
    }

    // Handle single or multiple digits entered
    const newDigits = [...digits];
    const incomingChars = val.slice(0, length - index).split('');
    incomingChars.forEach((ch, idx) => {
      if (index + idx < length) {
        newDigits[index + idx] = ch;
      }
    });

    const newVal = newDigits.join('').slice(0, length);
    onChange(newVal);

    // Advance focus
    const nextIndex = Math.min(index + incomingChars.length, length - 1);
    if (nextIndex < length && inputsRef.current[nextIndex]) {
      inputsRef.current[nextIndex]?.focus();
    }

    if (newVal.length === length) {
      onComplete?.(newVal);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Current box is empty, jump to previous box and delete
        e.preventDefault();
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        const newVal = newDigits.join('');
        onChange(newVal);
        inputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pastedData) return;

    onChange(pastedData);

    const focusIdx = Math.min(pastedData.length, length - 1);
    inputsRef.current[focusIdx]?.focus();

    if (pastedData.length === length) {
      onComplete?.(pastedData);
    }
  };

  return (
    <div
      role="group"
      aria-label="One-time verification code"
      className="flex items-center justify-between gap-2"
    >
      {Array.from({ length }, (_, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputsRef.current[idx] = el;
          }}
          id={`${idPrefix}-${idx}`}
          type="text"
          // The group above names the widget; each box still needs its own
          // name, or a screen reader announces six unnamed text fields.
          aria-label={`Digit ${idx + 1} of ${length}`}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
          value={digits[idx] || ''}
          disabled={disabled}
          onChange={(e) => handleChange(idx, e)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className={`h-12 w-full text-center font-mono text-xl font-bold rounded-lg border bg-primary text-ink transition-all duration-150 ${
            error ? 'border-red-500' : 'border-ink/15'
          } disabled:opacity-50`}
        />
      ))}
    </div>
  );
}
