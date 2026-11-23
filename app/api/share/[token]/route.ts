import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A board shared by link, for someone with no account. The token in the link is the
 * whole permission, so the server reads the board itself and hands out nothing else:
 * no member list, no comments, and no other project.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const token = String(params.token || '');
  if (token.length < 8) return NextResponse.json({ project: null, columns: [] }, { status: 404 });

  const { data: project } = await adminDb
    .from('projects')
    .select('id, name, description, slug, created_at')
    .eq('public_share_token', token)
    .maybeSingle();
  if (!project) return NextResponse.json({ project: null, columns: [] }, { status: 404 });

  const { data: columns } = await adminDb.from('columns').select('*').eq('project_id', project.id).order('position');
  const ids = (columns || []).map((column: any) => column.id);
  const { data: tasks } = ids.length
    ? await adminDb.from('tasks').select('*').in('column_id', ids).order('position')
    : { data: [] };
  return NextResponse.json({
    project,
    columns: (columns || []).map((column: any) => ({
      ...column,
      tasks: (tasks || []).filter((task: any) => task.column_id === column.id),
    })),
  });
}
