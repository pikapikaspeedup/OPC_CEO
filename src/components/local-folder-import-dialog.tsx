'use client';

import { Loader2, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LocalFolderImportDialogProps {
  open: boolean;
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  helperText?: string;
  confirmLabel: string;
  value: string;
  error?: string | null;
  submitting?: boolean;
  supportsNativeBrowse?: boolean;
  browseLabel?: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  onBrowse?: () => void | Promise<void>;
}

export default function LocalFolderImportDialog({
  open,
  title,
  description,
  inputLabel,
  placeholder,
  helperText,
  confirmLabel,
  value,
  error,
  submitting = false,
  supportsNativeBrowse = false,
  browseLabel = '浏览本机文件夹',
  onValueChange,
  onOpenChange,
  onConfirm,
  onBrowse,
}: LocalFolderImportDialogProps) {
  const confirmDisabled = submitting || !value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--app-text-soft)]">{inputLabel}</label>
            <Input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              placeholder={placeholder}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !confirmDisabled) {
                  event.preventDefault();
                  void onConfirm();
                }
              }}
            />
            {helperText ? (
              <p className="text-xs leading-5 text-[var(--app-text-muted)]">{helperText}</p>
            ) : null}
          </div>

          {supportsNativeBrowse && onBrowse ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void onBrowse()}
              disabled={submitting}
              className="gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              {browseLabel}
            </Button>
          ) : null}

          {error ? (
            <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void onConfirm()} disabled={confirmDisabled}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? '处理中…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
