'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { TextField, type TextFieldProps } from '@/components/ui/TextField';

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'endAdornment'>;

// Password input with a show/hide toggle (Spec 04 §4.10: <button aria-pressed> "Show password").
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <TextField
        ref={ref}
        {...props}
        type={visible ? 'text' : 'password'}
        endAdornment={
          <button
            type="button"
            aria-label="Show password"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            className="flex size-8 items-center justify-center rounded-sm text-text-secondary transition-colors duration-fast ease-out hover:bg-bg-subtle hover:text-text-primary"
          >
            {visible ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </button>
        }
      />
    );
  },
);
