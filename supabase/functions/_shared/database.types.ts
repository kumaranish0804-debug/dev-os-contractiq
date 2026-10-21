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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          cited_pages: number[]
          content: string
          created_at: string
          id: string
          query_type: Database["public"]["Enums"]["chat_query_type"] | null
          role: Database["public"]["Enums"]["chat_role"]
          session_id: string
          status: Database["public"]["Enums"]["message_status"]
          user_id: string
        }
        Insert: {
          cited_pages?: number[]
          content: string
          created_at?: string
          id?: string
          query_type?: Database["public"]["Enums"]["chat_query_type"] | null
          role: Database["public"]["Enums"]["chat_role"]
          session_id: string
          status?: Database["public"]["Enums"]["message_status"]
          user_id: string
        }
        Update: {
          cited_pages?: number[]
          content?: string
          created_at?: string
          id?: string
          query_type?: Database["public"]["Enums"]["chat_query_type"] | null
          role?: Database["public"]["Enums"]["chat_role"]
          session_id?: string
          status?: Database["public"]["Enums"]["message_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          message_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          message_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          message_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          contract_text: string
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          detected_type_mismatch: boolean
          error_code: string | null
          error_message: string | null
          file_deleted_at: string | null
          file_path: string | null
          file_size_bytes: number
          id: string
          last_accessed_at: string
          original_filename: string
          page_count: number
          processed_at: string | null
          processing_started_at: string | null
          prompt_version: string | null
          review_completed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string
          token_count: number
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          contract_text: string
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          detected_type_mismatch?: boolean
          error_code?: string | null
          error_message?: string | null
          file_deleted_at?: string | null
          file_path?: string | null
          file_size_bytes: number
          id?: string
          last_accessed_at?: string
          original_filename: string
          page_count: number
          processed_at?: string | null
          processing_started_at?: string | null
          prompt_version?: string | null
          review_completed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title: string
          token_count: number
          updated_at?: string
          user_id: string
          word_count: number
        }
        Update: {
          contract_text?: string
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          detected_type_mismatch?: boolean
          error_code?: string | null
          error_message?: string | null
          file_deleted_at?: string | null
          file_path?: string | null
          file_size_bytes?: number
          id?: string
          last_accessed_at?: string
          original_filename?: string
          page_count?: number
          processed_at?: string | null
          processing_started_at?: string | null
          prompt_version?: string | null
          review_completed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string
          token_count?: number
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "contracts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_key_terms: {
        Row: {
          contract_id: string
          created_at: string
          id: string
          is_manual: boolean
          term_name: string
          user_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          id?: string
          is_manual?: boolean
          term_name: string
          user_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          id?: string
          is_manual?: boolean
          term_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_key_terms_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_key_terms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      key_terms: {
        Row: {
          confidence_score: number
          contract_id: string
          created_at: string
          edited_at: string | null
          id: string
          is_custom: boolean
          is_edited: boolean
          original_value: string | null
          page_number: number | null
          sort_order: number
          source_sentence: string | null
          term_key: string
          term_name: string
          updated_at: string
          user_id: string
          value: string | null
        }
        Insert: {
          confidence_score: number
          contract_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_custom?: boolean
          is_edited?: boolean
          original_value?: string | null
          page_number?: number | null
          sort_order?: number
          source_sentence?: string | null
          term_key: string
          term_name: string
          updated_at?: string
          user_id: string
          value?: string | null
        }
        Update: {
          confidence_score?: number
          contract_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_custom?: boolean
          is_edited?: boolean
          original_value?: string | null
          page_number?: number | null
          sort_order?: number
          source_sentence?: string | null
          term_key?: string
          term_name?: string
          updated_at?: string
          user_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "key_terms_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_terms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_logs: {
        Row: {
          attempts: number
          cached_tokens: number
          completion_tokens: number
          contract_id: string | null
          cost_usd: number
          created_at: string
          error_code: string | null
          id: string
          kind: Database["public"]["Enums"]["log_kind"]
          model: string | null
          openai_ms: number | null
          prompt_tokens: number
          prompt_version: string | null
          success: boolean
          total_ms: number
          user_id: string
        }
        Insert: {
          attempts?: number
          cached_tokens?: number
          completion_tokens?: number
          contract_id?: string | null
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          id?: string
          kind: Database["public"]["Enums"]["log_kind"]
          model?: string | null
          openai_ms?: number | null
          prompt_tokens?: number
          prompt_version?: string | null
          success: boolean
          total_ms: number
          user_id: string
        }
        Update: {
          attempts?: number
          cached_tokens?: number
          completion_tokens?: number
          contract_id?: string | null
          cost_usd?: number
          created_at?: string
          error_code?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["log_kind"]
          model?: string | null
          openai_ms?: number | null
          prompt_tokens?: number
          prompt_version?: string | null
          success?: boolean
          total_ms?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_logs_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          feedback_opt_in: boolean
          full_name: string | null
          id: string
          onboarding_completed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          feedback_opt_in?: boolean
          full_name?: string | null
          id: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          feedback_opt_in?: boolean
          full_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          comment: string | null
          contract_id: string
          created_at: string
          id: string
          rating: Database["public"]["Enums"]["feedback_rating"]
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          contract_id: string
          created_at?: string
          id?: string
          rating: Database["public"]["Enums"]["feedback_rating"]
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          rating?: Database["public"]["Enums"]["feedback_rating"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      term_correction_samples: {
        Row: {
          confidence_score: number | null
          contract_type: Database["public"]["Enums"]["contract_type"] | null
          corrected_value: string | null
          edited_at: string | null
          key_term_id: string | null
          original_value: string | null
          page_number: number | null
          source_sentence: string | null
          term_key: string | null
          term_name: string | null
        }
        Relationships: []
      }
      term_corrections: {
        Row: {
          contract_type: Database["public"]["Enums"]["contract_type"] | null
          corrected_terms: number | null
          day: string | null
          is_custom: boolean | null
          term_key: string | null
          total_terms: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      get_dashboard_stats: { Args: never; Returns: Json }
      health_check: { Args: never; Returns: boolean }
      invoke_edge_function: {
        Args: { p_function_name: string }
        Returns: number
      }
      save_extraction_results: {
        Args: {
          p_contract_id: string
          p_detected_type_mismatch: boolean
          p_prompt_version: string
          p_terms: Json
          p_user_id: string
        }
        Returns: {
          confidence_score: number
          contract_id: string
          created_at: string
          edited_at: string | null
          id: string
          is_custom: boolean
          is_edited: boolean
          original_value: string | null
          page_number: number | null
          sort_order: number
          source_sentence: string | null
          term_key: string
          term_name: string
          updated_at: string
          user_id: string
          value: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "key_terms"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      start_processing: {
        Args: {
          p_contract_id: string
          p_contract_type: Database["public"]["Enums"]["contract_type"]
          p_custom_terms: string[]
          p_user_id: string
        }
        Returns: {
          contract_text: string
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          detected_type_mismatch: boolean
          error_code: string | null
          error_message: string | null
          file_deleted_at: string | null
          file_path: string | null
          file_size_bytes: number
          id: string
          last_accessed_at: string
          original_filename: string
          page_count: number
          processed_at: string | null
          processing_started_at: string | null
          prompt_version: string | null
          review_completed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string
          token_count: number
          updated_at: string
          user_id: string
          word_count: number
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      chat_query_type: "contract" | "history" | "both"
      chat_role: "user" | "assistant"
      contract_status: "uploaded" | "processing" | "completed" | "error"
      contract_type: "NDA" | "MSA"
      feedback_rating: "up" | "down"
      log_kind: "upload" | "extraction" | "chat"
      message_status: "complete" | "error"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      chat_query_type: ["contract", "history", "both"],
      chat_role: ["user", "assistant"],
      contract_status: ["uploaded", "processing", "completed", "error"],
      contract_type: ["NDA", "MSA"],
      feedback_rating: ["up", "down"],
      log_kind: ["upload", "extraction", "chat"],
      message_status: ["complete", "error"],
    },
  },
} as const
