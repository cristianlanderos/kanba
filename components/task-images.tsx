'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

export interface TaskImage {
  id: string;
  file: string;
  name?: string | null;
}

export const imageUrl = (file: string) => `/api/images/${file}`;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

interface TaskImagesProps {
  taskId: string;
  /** Called after an image is added or removed, so the board can show it. */
  onChange?: () => void;
}

/** The images of one task: see them, add more by button, paste or drop, and remove them. */
export function TaskImages({ taskId, onChange }: TaskImagesProps) {
  const [images, setImages] = useState<TaskImage[]>([]);
  const [uploading, setUploading] = useState(0);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('task_images').select('id, file, name').eq('task_id', taskId).order('created_at');
    setImages(data || []);
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(
    async (files: File[]) => {
      const pictures = files.filter((file) => ACCEPTED.includes(file.type));
      if (!pictures.length) {
        if (files.length) toast.error('Add a PNG, JPEG, GIF or WebP image');
        return;
      }
      setUploading((count) => count + pictures.length);
      for (const picture of pictures) {
        try {
          const response = await fetch(`/api/tasks/${taskId}/images`, {
            method: 'POST',
            headers: { 'Content-Type': picture.type, 'X-File-Name': encodeURIComponent(picture.name || '') },
            credentials: 'same-origin',
            body: picture,
          });
          if (!response.ok) {
            const answer = await response.json().catch(() => ({}));
            toast.error(answer.error || 'Could not add the image');
          }
        } catch {
          toast.error('Could not add the image');
        }
        setUploading((count) => count - 1);
      }
      await load();
      onChange?.();
    },
    [taskId, load, onChange]
  );

  const remove = async (image: TaskImage) => {
    const response = await fetch(`/api/task-images/${image.id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!response.ok) {
      toast.error('Could not remove the image');
      return;
    }
    setImages((current) => current.filter((other) => other.id !== image.id));
    onChange?.();
  };

  // A screenshot pasted anywhere in the open dialog lands on the task.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      add(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [add]);

  return (
    <div
      className={`space-y-2 rounded-md ${over ? 'outline outline-2 outline-primary outline-offset-4' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        add(Array.from(event.dataTransfer.files));
      }}
    >
      <Label>Images</Label>
      <div className="flex flex-wrap gap-2">
        {images.map((image) => (
          <div key={image.id} className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
            <a href={imageUrl(image.file)} target="_blank" rel="noopener noreferrer" title={image.name || 'Open the image'}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(image.file)} alt={image.name || 'Task image'} className="h-full w-full object-cover" />
            </a>
            <button
              type="button"
              aria-label="Remove image"
              title="Remove image"
              onClick={() => remove(image)}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-20 w-20 flex-col gap-1 text-xs text-muted-foreground"
          disabled={uploading > 0}
          onClick={() => picker.current?.click()}
        >
          {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {uploading > 0 ? 'Adding' : 'Add'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Paste or drop an image here too. PNG, JPEG, GIF or WebP, up to 10 MB.</p>
      <input
        ref={picker}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        hidden
        onChange={(event) => {
          add(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
    </div>
  );
}
