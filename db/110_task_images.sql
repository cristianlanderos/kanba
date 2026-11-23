-- Images on tasks. A row says which file a task shows; the file itself is on the server's
-- disk (see lib/server/uploads.ts), named by the hash of its content.

CREATE TABLE IF NOT EXISTS public.task_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file         text NOT NULL,
  name         text,
  content_type text NOT NULL,
  size         integer NOT NULL,
  uploaded_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_images_by_task ON public.task_images (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_images_by_file ON public.task_images (file);

ALTER TABLE public.task_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_images FROM anon;
GRANT ALL ON public.task_images TO authenticated, service_role;

-- Whoever may see a task may see, add and remove its images. The check reads `tasks` as
-- the person asking, so the policies of that table decide, and this one cannot drift from them.
CREATE POLICY task_images_select ON public.task_images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_images.task_id));
CREATE POLICY task_images_insert ON public.task_images FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_images.task_id));
CREATE POLICY task_images_delete ON public.task_images FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_images.task_id));
