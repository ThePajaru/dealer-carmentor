export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_search_logs: {
        Row: {
          analysis_id: string | null
          created_at: string | null
          id: string
          search_duration_ms: number | null
          search_progress: Json | null
          search_query: string
          search_query_id: string | null
          search_results: Json | null
          search_sources: Json | null
          search_status: string | null
          search_timestamp: string | null
          search_type: string
          user_id: string | null
        }
        Insert: {
          analysis_id?: string | null
          created_at?: string | null
          id?: string
          search_duration_ms?: number | null
          search_progress?: Json | null
          search_query: string
          search_query_id?: string | null
          search_results?: Json | null
          search_sources?: Json | null
          search_status?: string | null
          search_timestamp?: string | null
          search_type: string
          user_id?: string | null
        }
        Update: {
          analysis_id?: string | null
          created_at?: string | null
          id?: string
          search_duration_ms?: number | null
          search_progress?: Json | null
          search_query?: string
          search_query_id?: string | null
          search_results?: Json | null
          search_sources?: Json | null
          search_status?: string | null
          search_timestamp?: string | null
          search_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_search_logs_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "car_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      car_analyses: {
        Row: {
          created_at: string | null
          id: string
          opened_at: string | null
          result_json: Json
          source_url: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          opened_at?: string | null
          result_json?: Json
          source_url?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          opened_at?: string | null
          result_json?: Json
          source_url?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      car_inspection_checklists: {
        Row: {
          analysis_id: string
          checklist_data: Json
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis_id: string
          checklist_data?: Json
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis_id?: string
          checklist_data?: Json
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_inspection_checklists_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "car_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_inspection_checklists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      car_listings: {
        Row: {
          brand: string | null
          created_at: string | null
          external_id: number | null
          id: string
          listing_data: Json
          model: string | null
          price_amount: number | null
          price_currency: string | null
          search_id: string | null
          title: string | null
        }
        Insert: {
          brand?: string | null
          created_at?: string | null
          external_id?: number | null
          id?: string
          listing_data: Json
          model?: string | null
          price_amount?: number | null
          price_currency?: string | null
          search_id?: string | null
          title?: string | null
        }
        Update: {
          brand?: string | null
          created_at?: string | null
          external_id?: number | null
          id?: string
          listing_data?: Json
          model?: string | null
          price_amount?: number | null
          price_currency?: string | null
          search_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "car_listings_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "user_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      makes: {
        Row: {
          created_at: string | null
          id: number
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      models: {
        Row: {
          created_at: string | null
          id: number
          make_id: number
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          make_id: number
          name: string
        }
        Update: {
          created_at?: string | null
          id?: number
          make_id?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "models_make_id_fkey"
            columns: ["make_id"]
            isOneToOne: false
            referencedRelation: "makes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_searches: {
        Row: {
          created_at: string | null
          id: string
          mileage_range_max: number
          mileage_range_min: number
          power_range_max: number
          power_range_min: number
          price_range_max: number
          price_range_min: number
          search_term: string
          total_results: number | null
          updated_at: string | null
          user_id: string | null
          year_range_max: number
          year_range_min: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          mileage_range_max: number
          mileage_range_min: number
          power_range_max: number
          power_range_min: number
          price_range_max: number
          price_range_min: number
          search_term: string
          total_results?: number | null
          updated_at?: string | null
          user_id?: string | null
          year_range_max: number
          year_range_min: number
        }
        Update: {
          created_at?: string | null
          id?: string
          mileage_range_max?: number
          mileage_range_min?: number
          power_range_max?: number
          power_range_min?: number
          price_range_max?: number
          price_range_min?: number
          search_term?: string
          total_results?: number | null
          updated_at?: string | null
          user_id?: string | null
          year_range_max?: number
          year_range_min?: number
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          plan: string
          status: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_user_analyze: {
        Args: { user_uuid: string }
        Returns: boolean
      }
      cleanup_expired_analyses: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      get_user_usage: {
        Args: { user_uuid: string }
        Returns: {
          analyses_limit: number
          analyses_remaining: number
          analyses_used: number
          current_period_end: string
          plan: string
          status: string
        }[]
      }
      plan_monthly_limit: {
        Args: { plan_in: string }
        Returns: number
      }
      stripe_price_to_plan: {
        Args: { stripe_price_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const