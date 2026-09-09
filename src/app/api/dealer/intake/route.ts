import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDealerProfileBySlug, canDealerAnalyze } from '@/lib/dealer-auth';
import { logDealerEvent } from '@/lib/dealer/events';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  let body: { slug: string; source_url: string; client_name?: string; client_phone?: string; client_email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.slug?.trim() || !body.source_url?.trim()) {
    return NextResponse.json({ error: 'slug y source_url son obligatorios' }, { status: 400 });
  }

  const dealer = await getDealerProfileBySlug(body.slug.trim());
  if (!dealer) {
    return NextResponse.json({ error: 'Dealer no encontrado' }, { status: 404 });
  }

  if (!canDealerAnalyze(dealer)) {
    return NextResponse.json({ error: 'El dealer ha alcanzado su límite de análisis' }, { status: 429 });
  }

  const { data: lead, error: leadError } = await supabase
    .from('dealer_leads')
    .insert({
      dealer_id: dealer.id,
      source_url: body.source_url.trim(),
      client_name: body.client_name?.trim() || null,
      client_phone: body.client_phone?.trim() || null,
      client_email: body.client_email?.trim() || null,
      source: 'intake',
    })
    .select()
    .single();

  if (leadError) {
    console.error('Error creating intake lead:', JSON.stringify(leadError));
    return NextResponse.json({ error: 'Error al crear la solicitud' }, { status: 500 });
  }

  logDealerEvent(supabase, {
    dealer_id: dealer.id,
    type: 'lead_captacion',
    payload: { client_name: body.client_name?.trim() || null, source: 'captacion' },
  });

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  try {
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const dealerUser = users?.find((u: any) => u.id === dealer.user_id);

    if (dealerUser) {
      const { data: sessionData } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: dealerUser.email!,
      });

      if (sessionData) {
        fetch(`${baseUrl}/api/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Role': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          },
          body: JSON.stringify({
            url: body.source_url.trim(),
            userId: dealer.user_id,
          }),
        }).then(async (res) => {
          if (res.ok) {
            const reader = res.body?.getReader();
            if (!reader) return;
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const parsed = JSON.parse(line.slice(6));
                    if (parsed.type === 'complete' && parsed.analysisId) {
                      await supabase
                        .from('dealer_leads')
                        .update({ analysis_id: parsed.analysisId, updated_at: new Date().toISOString() })
                        .eq('id', lead.id);
                      await supabase
                        .from('dealer_profiles')
                        .update({ analyses_used: dealer.analyses_used + 1, updated_at: new Date().toISOString() })
                        .eq('id', dealer.id);
                    }
                  } catch {}
                }
              }
            }
          }
        }).catch(err => console.error('Background analysis failed:', err));
      }
    }
  } catch (err) {
    console.error('Failed to trigger background analysis:', err);
  }

  return NextResponse.json({
    success: true,
    message: 'Tu solicitud ha sido enviada. Te contactaremos pronto.',
    lead_id: lead.id,
  }, { status: 201 });
}
