// Las generaciones vivían aquí duplicadas respecto a la tabla de
// src/app/api/analyze/route.ts, y las dos se habían ido por su lado (esta decía
// A3 8P = 2003-2013 CON solape, la otra 8P = 2004-2012 sin él). Cada una
// alimentaba una búsqueda de comparables distinta para el mismo coche.
//
// Ahora la fuente única es src/lib/generations.ts. Este fichero se queda como
// re-export para no tocar los imports del formulario dealer.
export {
  generationsFor,
  generationLabel,
  genSearchRange,
  resolveGeneration,
  searchYearWindow,
} from '../generations';
export type {
  Generation,
  ResolvedGeneration,
  ResolveInput,
  GenerationConfidence,
  GenerationSource,
} from '../generations';
