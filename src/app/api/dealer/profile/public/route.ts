import { NextRequest, NextResponse } from 'next/server';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  const profile = await getDealerProfileBySlug(slug);
  if (!profile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    dealer: {
      business_name: profile.business_name,
      logo_url: profile.logo_url,
      whatsapp: profile.whatsapp,
      phone: profile.phone,
    },
  });
}
