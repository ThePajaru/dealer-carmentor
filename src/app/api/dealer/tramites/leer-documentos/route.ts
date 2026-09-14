import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// Lee los papeles que el runner fotografio en la inspeccion y saca de ahi los
// datos que decide el modelo 576: CO2 y fecha de primera matriculacion, que son
// los que mueven el tramo del impuesto, mas cilindrada, potencia y combustible.
//
// Trabaja SOBRE LAS FOTOS QUE YA EXISTEN: las del expediente de la ficha
// reducida. La documentacion alemana son DOS papeles distintos:
//   · Teil I (Fahrzeugschein): va en el coche. Una sola cara con TODAS las
//     casillas tecnicas, y es el UNICO que trae el CO2 (V.7), la clase de
//     emisiones (14), las plazas (S.1) y las masas. El año de B va a 2 cifras.
//   · Teil II (Fahrzeugbrief): la hoja grande que acredita la propiedad. Trae
//     marca, bastidor, P.1/P.2/P.3, B con año a 4 cifras y el numero de
//     titulares anteriores, pero NO el CO2.
//
// Lo que estos papeles NO pueden dar, y por eso no se inventa:
//   · la valoracion de Hacienda (sale de sus tablas, no del papel);
//   · la potencia fiscal CVF española: su formula necesita el numero de
//     cilindros, que no figura en ninguno de los dos papeles.

const GEMINI_TIMEOUT_MS = 25000;
const MAX_FOTOS = 3;
const MAX_BYTES_FOTO = 6 * 1024 * 1024;

/** Etiquetas del checklist del runner que llevan datos fiscales utiles. */
const ETIQUETAS_UTILES = ['Documentación', 'Documentación Teil II', 'Placa del fabricante'];

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
  /** Código del fabricante (HSN). Campo 2.1. Junto al TSN identifica el tipo exacto. */
  hsn: string | null;
  /** Código de tipo (TSN). Campo 2.2. */
  tsn: string | null;
  /** Clase de emisiones (EURO5, EURO6…). Campo 14, solo en el Teil I. */
  clase_emisiones: string | null;
  /** Plazas de asiento incluido el conductor. Campo S.1, solo en el Teil I. */
  plazas: number | null;
  /** Titulares anteriores ("Anzahl der Vorhalter"). Solo en el Teil II. */
  titulares_anteriores: number | null;
  /** El bastidor (E) del Teil I y el del Teil II son el mismo. null si falta uno. */
  bastidor_coincide: boolean | null;
  notas: string | null;
}

const VACIO: CamposLeidos = {
  fecha_puesta_servicio: null, co2_g_km: null, combustible: null,
  cilindrada_cc: null, categoria_cee: null, bastidor: null, marca: null,
  modelo_tipo: null, potencia_kw: null, hsn: null, tsn: null,
  clase_emisiones: null, plazas: null, titulares_anteriores: null,
  bastidor_coincide: null, notas: null,
};

const PROMPT = `Eres un gestor administrativo español especializado en matriculación de vehículos importados. Estás rellenando el modelo 576 (Impuesto Especial sobre Determinados Medios de Transporte) en la sede de la Agencia Tributaria. Te doy fotos de la documentación de un coche comprado en Alemania. Pueden venir estos documentos:

1. Zulassungsbescheinigung Teil I (Fahrzeugschein): papel pequeño y apaisado, una cara con muchas casillas en columnas. Es el ÚNICO que trae V.7 (CO2), 14 (clase de emisiones), S.1 (plazas) y las masas. En la casilla B el año viene a 2 cifras (p. ej. 14.09.09).
2. Zulassungsbescheinigung Teil II (Fahrzeugbrief): hoja A4 vertical con titulares arriba y datos del vehículo abajo. Trae D, E, J, P.1, P.2/P.4, P.3, K y B con el año a 4 cifras, y la casilla "(1) Anzahl der Vorhalter" (titulares anteriores). NO trae el CO2.
3. Placa del fabricante: placa física con número de homologación, bastidor y masas.

Tu único trabajo es LEER lo que pone y devolverlo. No calcules nada, no estimes nada, no completes con conocimiento general del modelo.

Campos y la casilla del 576 a la que van:
- B = fecha de primera matriculación → "Fecha puesta en servicio". Si el Teil I la trae con año a 2 cifras y el Teil II con 4, usa la del Teil II. Si solo está el Teil I, el año de 2 cifras es 20AA si da una fecha no futura; si no, 19AA.
- D.1 = marca → "Marca"
- D.2 y D.3 = tipo y denominación comercial → "Modelo - Tipo"
- E = número de bastidor (17 caracteres) → "Nº identificación (bastidor)"
- P.1 = cilindrada en cm³ → "Cilindrada (CC)"
- P.2 = potencia en kW (en el papel va como "294/6500": kW / revoluciones; devuelve solo los kW)
- P.3 = combustible → "Clase de Combustible"
- V.7 = emisiones de CO2 en g/km → "Emisiones CO2 (gr./Km)". Solo en el Teil I.
- J = categoría del vehículo (M1, N1…) → "Clasificación (70/156/CEE)"
- 2.1 = código del fabricante (HSN, 4 caracteres) y 2.2 = código de tipo (TSN, los primeros 3 caracteres son los que identifican el tipo; devuélvelo tal cual está impreso)
- 14 = clase de emisiones (EURO5, EURO6…): devuelve solo la clase, p. ej. "EURO5"
- S.1 = plazas de asiento
- "Anzahl der Vorhalter" del Teil II = titulares anteriores. Si hay una raya o está vacío, null.

Combustible: el 576 solo admite tres opciones. Devuelve exactamente "gasolina" (Benzin/Otto), "diesel" (Diesel) u "otros" (híbrido, eléctrico, GLP, GNC o cualquier otra cosa).

bastidor_coincide: true si vienen el Teil I y el Teil II y la casilla E es idéntica carácter a carácter en los dos; false si difiere en algo; null si no vienen los dos papeles o alguno no se lee.

REGLAS CRÍTICAS:
- Si un campo no se lee con seguridad en la foto, devuelve null. NUNCA lo deduzcas del modelo del coche ni lo rellenes "a ojo": esto acaba en una declaración de impuestos firmada.
- Si un dato aparece en los dos papeles y no coincide, devuelve el del Teil I y cuéntalo en "notas".
- La fecha va en formato AAAA-MM-DD.
- co2_g_km, cilindrada_cc, potencia_kw, plazas y titulares_anteriores son números, sin unidades.
- El bastidor, en mayúsculas y sin espacios.
- No copies nombres ni direcciones de titulares: no hacen falta.
- En "notas" escribe en español, en una frase, cualquier cosa que el gestor deba saber: foto borrosa, falta el Teil I (y por tanto el CO2), documento que no es alemán, campo tachado o ilegible, datos que no cuadran entre papeles. Si todo está limpio, null.

Devuelve SOLO este JSON:
{"fecha_puesta_servicio":null,"co2_g_km":null,"combustible":null,"cilindrada_cc":null,"categoria_cee":null,"bastidor":null,"marca":null,"modelo_tipo":null,"potencia_kw":null,"hsn":null,"tsn":null,"clase_emisiones":null,"plazas":null,"titulares_anteriores":null,"bastidor_coincide":null,"notas":null}`;

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
    campos.plazas = num(campos.plazas, 1, 9);
    // 0 titulares anteriores es un dato valido (coche de un solo dueño).
    campos.titulares_anteriores = num(campos.titulares_anteriores, 0, 30);
    const texto_corto = (v: unknown, re: RegExp): string | null => {
      const s = typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() : '';
      return re.test(s) ? s : null;
    };
    campos.hsn = texto_corto(campos.hsn, /^[0-9A-Z]{4}$/);
    campos.tsn = texto_corto(campos.tsn, /^[0-9A-Z]{3,10}$/);
    campos.clase_emisiones = texto_corto(campos.clase_emisiones, /^EURO[0-9][A-Z0-9-]{0,6}$/);
    if (typeof campos.bastidor_coincide !== 'boolean') campos.bastidor_coincide = null;

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
