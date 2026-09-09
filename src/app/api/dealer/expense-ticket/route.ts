import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// Authenticated ticket-photo upload for runner expenses entered on the dealer
// side (operation detail → Gastos del runner). Mirrors the runner packet's
// public upload, but gated by the dealer's session. Reuses the inspections
// bucket, namespaced per dealer under tickets/.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BUCKET = 'dealer-inspections';

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: any;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }); }

    const dataUrl: string = body?.dataUrl || '';
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return NextResponse.json({ error: 'Imagen inválida' }, { status: 400 });

    const contentType = m[1];
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 12 * 1024 * 1024) return NextResponse.json({ error: 'Imagen demasiado grande' }, { status: 413 });

    const path = `tickets/${dealerProfile.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) {
      console.error('Expense ticket upload failed:', JSON.stringify(upErr));
      return NextResponse.json({ error: 'No se pudo subir el ticket' }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
