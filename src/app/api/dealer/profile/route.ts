import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError, getDealerProfile, dealerServiceClient } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function getUserFromAuth(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.replace('Bearer ', '');
}

async function verifyToken(token: string) {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function GET(request: NextRequest) {
  const token = getUserFromAuth(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const profile = await getDealerProfile(user.id);
  return NextResponse.json({ profile });
}

export async function POST(request: NextRequest) {
  const token = getUserFromAuth(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const existing = await getDealerProfile(user.id);
  if (existing) return NextResponse.json({ error: 'Ya tienes un perfil de dealer' }, { status: 409 });

  let body: { business_name: string; slug: string; phone?: string | null; whatsapp?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.business_name?.trim() || !body.slug?.trim()) {
    return NextResponse.json({ error: 'business_name y slug son obligatorios' }, { status: 400 });
  }

  const slug = body.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ error: 'Slug inválido: solo letras, números y guiones, 3-30 caracteres' }, { status: 400 });
  }

  const reserved = ['api', 'dashboard', 'settings', 'onboarding', 'login', 'signup', 'admin', 'presupuesto', 'leads', 'nuevo'];
  if (reserved.includes(slug)) {
    return NextResponse.json({ error: 'Ese slug está reservado' }, { status: 400 });
  }

  const { data: existingSlug } = await supabase
    .from('dealer_profiles')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (existingSlug) {
    return NextResponse.json({ error: 'Ese slug ya está en uso' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('dealer_profiles')
    .insert({
      user_id: user.id,
      business_name: body.business_name.trim(),
      slug,
      phone: body.phone || null,
      whatsapp: body.whatsapp || null,
      email: user.email || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating dealer profile:', JSON.stringify(error));
    return NextResponse.json({ error: 'Error al crear el perfil' }, { status: 500 });
  }

  return NextResponse.json({ profile: data }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const allowedFields = [
      'business_name', 'phone', 'whatsapp', 'email', 'address',
      'default_transport', 'default_gestoria', 'default_itv', 'default_plates', 'default_margin_pct',
      'deduct_import_vat', 'dealers_only_comps',
    ];

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (body.slug && body.slug !== dealerProfile.slug) {
      const slug = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
        return NextResponse.json({ error: 'Slug inválido' }, { status: 400 });
      }
      const { data: existingSlug } = await supabase
        .from('dealer_profiles')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (existingSlug && existingSlug.id !== dealerProfile.id) {
        return NextResponse.json({ error: 'Ese slug ya está en uso' }, { status: 409 });
      }
      updates.slug = slug;
    }

    const { data, error } = await supabase
      .from('dealer_profiles')
      .update(updates)
      .eq('id', dealerProfile.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating dealer profile:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
