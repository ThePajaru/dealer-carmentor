import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// Lee los papeles que el runner fotografio en la inspeccion y saca de ahi los
// datos que decide el modelo 576: CO2 y fecha de primera matriculacion, que son
// los que mueven el tramo del impuesto, mas cilindrada, potencia y combustible.
//
// Trabaja SOBRE LAS FOTOS QUE YA EXISTEN. No pide nada nuevo al runner: el
// permiso de circulacion aleman y la placa del fabricante ya son parte del
// expediente de la ficha reducida.
//
// Lo que este documento NO puede dar, y por eso no se inventa:
//   · la valoracion de Hacienda (sale de sus tablas, no del papel);
//   · la potencia fiscal CVF española (se calcula aparte, la pone el gestor).

const GEMINI_TIMEOUT_MS = 25000;
const MAX_FOTOS = 3;
const MAX_BYTES_FOTO = 6 * 1024 * 1024;

/** Etiquetas del checklist del runner que llevan datos fiscales utiles. */
const ETIQUETAS_UTILES = ['Documentación', 'Placa del fabricante'];

// Los campos son los del formulario 576 de la AEAT, con sus nombres, para que
// el gestor pueda pasarlos a la sede sin traducir nada por el camino.
interface CamposLeidos {
  /** 576: "Fecha puesta en servicio". Permiso alemán campo B. */
  fecha_puesta_servicio: string | null;
  /** 576: "Emisiones CO2 (gr./Km)". Campo V.7. */
  co2_g_km: number | null;
  /** 576: "Clase de Combustible" — gasolina | diesel | otros. Campo P.3. */
  combustible: string | null;
  /** 576: "Cilindrada (CC)". Campo P.1. */
  cilindrada_cc: number | null;
  /** 576: "Clasificación (70/156/CEE)" — M1, N1… Campo J. */
  categoria_cee: string | null;
  /** 576: "Nº identificación (bastidor)". Campo E. */
  bastidor: string | null;
  /** 576: "Marca". Campo D.1. */
  marca: string | null;
  /** 576: "Modelo - Tipo". Campos D.2 y D.3. */
  modelo_tipo: string | null;
  /** No va en el 576, pero cuadra la potencia fiscal y el epígrafe. Campo P.2. */
  potencia_kw: number | null;
  notas: string | null;
}

const VACIO: CamposLeidos = {
  fecha_puesta_servicio: null, co2_g_km: null, combustible: null,
  cilindrada_cc: null, categoria_cee: null, bastidor: null, marca: null,
  modelo_tipo: null, potencia_kw: null, notas: null,
};

const PROMPT = `Eres un gestor administrativo español especializado en matriculación de vehículos importados. Estás rellenando el modelo 576 (Impuesto Especial sobre Determinados Medios de Transporte) en la sede de la Agencia Tributaria. Te doy fotos de la documentación de un coche comprado en Alemania: normalmente el permiso de circulación alemán (Zulassungsbescheinigung Teil I) y/o la placa del fabricante.

Tu único trabajo es LEER lo que pone y devolverlo. No calcules nada, no estimes nada, no completes con conocimiento general del modelo.

Campos del permiso alemán y la casilla del 576 a la que van:
- B = fecha de primera matriculación → "Fecha puesta en servicio"
- D.1 = marca → "Marca"
- D.2 y D.3 = tipo y denominación comercial → "Modelo - Tipo"
- E = número de bastidor (17 caracteres) → "Nº identificación (bastidor)"
- P.1 = cilindrada en cm³ → "Cilindrada (CC)"
- P.2 = potencia en kW (no va en el 576, pero cuadra el epígrafe)
- P.3 = combustible → "Clase de Combustible"
- V.7 = emisiones de CO2 en g/km → "Emisiones CO2 (gr./Km)"
- J = categoría del vehículo (M1, N1…) → "Clasificación (70/156/CEE)"

Combustible: el 576 solo admite tres opciones. Devuelve exactamente "gasolina" (Benzin/Otto), "diesel" (Diesel) u "otros" (híbrido, eléctrico, GLP, GNC o cualquier otra cosa).

REGLAS CRÍTICAS:
- Si un campo no se lee con seguridad en la foto, devuelve null. NUNCA lo deduzcas del modelo del coche ni lo rellenes "a ojo": esto acaba en una declaración de impuestos firmada.
- La fecha va en formato AAAA-MM-DD.
- co2_g_km, cilindrada_cc y potencia_kw son números, sin unidades.
- El bastidor, en mayúsculas y sin espacios.
- En "notas" escribe en español, en una frase, cualquier cosa que el gestor deba saber: foto borrosa, documento que no es un permiso alemán, campo tachado o ilegible. Si todo está limpio, null.

Devuelve SOLO este JSON:
{"fecha_puesta_servicio":null,"co2_g_km":null,"combustible":null,"cilindrada_cc":null,"categoria_cee":null,"bastidor":null,"marca":null,"modelo_tipo":null,"potencia_kw":null,"notas":null}`;

async function descargarFoto(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES_FOTO) return null;
    return {
      data: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: { request_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body.request_id) {
      return NextResponse.json({ error: 'Falta la operación' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY no configurada: no se pueden leer documentos');
      return NextResponse.json({ error: 'La lectura de documentos no está disponible' }, { status: 503 });
    }

    const { data: job } = await dealerServiceClient
      .from('dealer_client_requests')
      .select('id, runner_report, agreed_price')
      .eq('id', body.request_id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });

    const fotos: { label: string; url: string }[] = Array.isArray((job.runner_report as { photos?: unknown })?.photos)
      ? ((job.runner_report as { photos: { label?: string; url?: string }[] }).photos)
        .filter((f): f is { label: string; url: string } => !!f?.url && !!f?.label)
      : [];

    const candidatas = fotos.filter(f => ETIQUETAS_UTILES.includes(f.label)).slice(0, MAX_FOTOS);
    if (candidatas.length === 0) {
      return NextResponse.json({
        error: 'La inspección del runner no trae la foto del permiso de circulación ni la de la placa del fabricante.',
      }, { status: 422 });
    }

    const imagenes = (await Promise.all(candidatas.map(f => descargarFoto(f.url))))
      .map((img, i) => (img ? { img, label: candidatas[i].label } : null))
      .filter((x): x is { img: { data: string; mimeType: string }; label: string } => x !== null);

    if (imagenes.length === 0) {
      return NextResponse.json({ error: 'No se pudieron descargar las fotos de la inspección' }, { status: 502 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      // temperatura 0: esto es transcribir un documento, no redactar.
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), GEMINI_TIMEOUT_MS);
    let texto: string;
    try {
      const resultado = await model.generateContent([
        PROMPT,
        ...imagenes.map(({ img }) => ({ inlineData: { data: img.data, mimeType: img.mimeType } })),
      ]);
      texto = resultado.response.text();
    } catch (e) {
      console.error('Lectura de documentos falló:', e);
      return NextResponse.json({ error: 'No se pudieron leer los documentos. Inténtalo de nuevo.' }, { status: 502 });
    } finally {
      clearTimeout(reloj);
    }

    let campos: CamposLeidos;
    try {
      campos = { ...VACIO, ...(JSON.parse(texto) as Partial<CamposLeidos>) };
    } catch {
      console.error('Respuesta no parseable de la lectura de documentos');
      return NextResponse.json({ error: 'La lectura devolvió algo que no se entiende' }, { status: 502 });
    }

    // Saneado: un numero fuera de rango es un error de lectura, no un dato.
    const num = (v: unknown, min: number, max: number): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
    };
    campos.co2_g_km = num(campos.co2_g_km, 1, 600);
    campos.cilindrada_cc = num(campos.cilindrada_cc, 400, 9000);
    campos.potencia_kw = num(campos.potencia_kw, 5, 1000);
    if (campos.fecha_puesta_servicio && !/^\d{4}-\d{2}-\d{2}$/.test(campos.fecha_puesta_servicio)) {
      campos.fecha_puesta_servicio = null;
    }
    if (campos.bastidor) {
      const vin = campos.bastidor.replace(/\s/g, '').toUpperCase();
      campos.bastidor = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
    }
    if (campos.combustible && !['gasolina', 'diesel', 'otros'].includes(campos.combustible)) {
      campos.combustible = 'otros';
    }

    // "Kms/Horas de utilización" del 576 no está en el permiso: lo trae el
    // runner, que leyó el cuadro con el coche delante.
    const kmRunner = (job.runner_report as { real_km?: number } | null)?.real_km ?? null;

    return NextResponse.json({
      campos,
      km_utilizacion: typeof kmRunner === 'number' ? kmRunner : null,
      leidas: imagenes.map(i => i.label),
      // Casillas del 576 que este papel NO puede dar, para que la interfaz no
      // las prometa: la tarjeta ITV nace de la ficha técnica reducida (que aún
      // no existe cuando el coche está en Alemania) y la base imponible sale de
      // las tablas de valoración de Hacienda.
      faltan_en_576: [
        'Código ITV',
        'Número de serie tarjeta ITV',
        'Tipo de tarjeta ITV',
        'Base imponible (valoración de Hacienda)',
      ],
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
