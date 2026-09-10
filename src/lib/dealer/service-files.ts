import { dealerServiceClient } from '@/lib/dealer-auth';

// Ficheros que el colaborador devuelve en un trámite: justificantes del 576 y
// del IVTM, y la ficha técnica firmada.
//
// El bucket es PRIVADO (los demás del proyecto son públicos a propósito: fotos
// del runner y logos). Estos papeles llevan datos fiscales y del titular, así
// que en la base solo se guarda la RUTA y la API entrega una URL firmada corta.
// Nunca se persiste una URL firmada: caducaría dentro del JSON.

export const TRAMITES_BUCKET = 'dealer-tramites';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 h

export interface ServiceFile {
  label: string;
  path: string;
  uploaded_at: string;
}

export interface ServiceResult {
  nota?: string;
  files?: ServiceFile[];
}

/** Igual que ServiceFile pero ya servible al navegador. */
export interface SignedServiceFile extends ServiceFile {
  url: string | null;
}

const MAX_BYTES = 20 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export const ALLOWED_FILE_TYPES = Object.keys(EXT_BY_TYPE);

/**
 * Sube un fichero (data URL en base64) al bucket privado y devuelve su entrada.
 * No toca la fila del encargo: eso lo hace quien llama, junto al resto del
 * `result`, para que subir y guardar sean una sola escritura.
 */
export async function uploadServiceFile(
  orderId: string,
  dataUrl: string,
  label: string,
): Promise<{ file: ServiceFile } | { error: string; status: number }> {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { error: 'Fichero inválido', status: 400 };

  const contentType = m[1];
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) return { error: 'Solo se aceptan PDF o imagen', status: 415 };

  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_BYTES) return { error: 'El fichero pasa de 20 MB', status: 413 };

  const path = `${orderId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await dealerServiceClient.storage
    .from(TRAMITES_BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    console.error('Trámite file upload failed:', JSON.stringify(error));
    return { error: 'No se pudo subir el fichero', status: 500 };
  }

  return {
    file: {
      label: label.trim().slice(0, 120) || (ext === 'pdf' ? 'Documento' : 'Imagen'),
      path,
      uploaded_at: new Date().toISOString(),
    },
  };
}

export async function deleteServiceFile(path: string): Promise<void> {
  const { error } = await dealerServiceClient.storage.from(TRAMITES_BUCKET).remove([path]);
  if (error) console.error('Trámite file delete failed:', JSON.stringify(error));
}

/**
 * Cambia rutas por URLs firmadas para devolvérselas al navegador. Un fichero que
 * ya no exista sale con `url: null` en vez de tumbar la respuesta entera.
 */
export async function signResult(result: unknown): Promise<ServiceResult & { files: SignedServiceFile[] }> {
  const r = (result && typeof result === 'object' ? result : {}) as ServiceResult;
  const files = Array.isArray(r.files) ? r.files : [];
  if (files.length === 0) return { ...r, files: [] };

  const { data, error } = await dealerServiceClient.storage
    .from(TRAMITES_BUCKET)
    .createSignedUrls(files.map(f => f.path), SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error('Trámite signed URLs failed:', JSON.stringify(error));
    return { ...r, files: files.map(f => ({ ...f, url: null })) };
  }

  const byPath = new Map(data.map(d => [d.path, d.signedUrl]));
  return {
    ...r,
    files: files.map(f => ({ ...f, url: byPath.get(f.path) ?? null })),
  };
}
