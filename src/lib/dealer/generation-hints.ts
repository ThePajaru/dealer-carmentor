import type { SupabaseClient } from '@supabase/supabase-js';

export interface GenerationHint {
  make: string;
  model: string;
  generation: string;
}

/**
 * Generaciones (chasis) que el cliente eligió en el cuestionario de esta
 * operación — T0 de la cascada de `resolveGeneration`, la fuente más fiable que
 * existe: el cliente dijo "quiero un F30", no hay nada que adivinar.
 *
 * Importa justo donde adivinar falla: un Serie 3 de 2012 puede ser F30 o E90 y
 * el año no lo distingue. Sin esto, los comparables de coches.net podían salir
 * del chasis equivocado y el margen con ellos.
 *
 * Van varias porque una operación admite hasta 4 coches (MAX_VEHICLES); quien
 * las consume casa por marca+modelo con el coche realmente analizado.
 *
 * Nunca revienta el análisis: ante cualquier fallo devuelve [] y la cascada
 * sigue como siempre (código de chasis del anuncio → mes → huella → año).
 */
export async function fetchGenerationHints(
  supabase: SupabaseClient,
  clientRequestId?: string | null,
): Promise<GenerationHint[]> {
  if (!clientRequestId) return [];
  try {
    const { data, error } = await supabase
      .from('dealer_client_requests')
      .select('vehicles')
      .eq('id', clientRequestId)
      .single();
    if (error || !data?.vehicles || !Array.isArray(data.vehicles)) return [];
    return (data.vehicles as Array<Record<string, unknown>>)
      .filter((v) => v?.make && v?.model && v?.generation)
      .map((v) => ({
        make: String(v.make),
        model: String(v.model),
        generation: String(v.generation),
      }))
      .slice(0, 8);
  } catch (err) {
    console.warn('[generation-hints] no se pudieron leer las generaciones del cuestionario:', (err as Error).message);
    return [];
  }
}
