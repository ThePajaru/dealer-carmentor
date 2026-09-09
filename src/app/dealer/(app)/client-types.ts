export interface VehicleProfile {
  make: string | null;
  model: string | null;
  /** Trim the customer named ("GTI"). Already baked into `mobile_url`. */
  variant?: string | null;
  /** Engine designations the customer asked for (428i, 320d) — headline the card. */
  engines?: string[] | null;
  max_price: number | null;
  max_km: number | null;
  min_year: number | null;
  max_year?: number | null;
  min_cv?: number | null;
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  body_type?: string | null;
  drive_type?: string | null;
  interior_type?: string | null;
  doors?: string | null;
  seats?: number | null;
  emission_class?: string | null;
  /** mobile.de `fe` codes the customer called innegociable — these DO filter. */
  features?: string[] | null;
  /** Wanted but not filtered on. Use them to rank, never to discard. */
  nice_to_have?: string[] | null;
  mobile_url: string | null;
}

export interface ClientRequest {
  id: string;
  client_name: string;
  client_phone: string | null;
  // One operación, N vehicle profiles the customer has in mind. Flat fields
  // below mirror vehicles[0] for backward-compatible reads.
  vehicles: VehicleProfile[] | null;
  make: string | null;
  model: string | null;
  max_price: number | null;
  max_km: number | null;
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  min_year: number | null;
  mobile_url: string | null;
  status: string;
  created_at: string;
  lead_count: number;
  presupuesto_count: number;
  sold_price?: number | null;
  purchase_price?: number | null;
  margin?: number | null;
}
