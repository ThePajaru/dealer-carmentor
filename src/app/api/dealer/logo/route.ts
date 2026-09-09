import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const formData = await request.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Solo PNG, JPG o WebP' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'El archivo no puede superar 2MB' }, { status: 400 });
    }

    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
    const fileName = `${dealerProfile.id}/logo.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('dealer-logos')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('Logo upload error:', JSON.stringify(uploadError));
      return NextResponse.json({ error: 'Error al subir el logo' }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from('dealer-logos')
      .getPublicUrl(fileName);

    const logoUrl = urlData.publicUrl;

    await supabase
      .from('dealer_profiles')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', dealerProfile.id);

    return NextResponse.json({ logo_url: logoUrl });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
