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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          website: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      project_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: Database["public"]["Enums"]["project_event_type"]
          id: string
          payload: Json | null
          project_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: Database["public"]["Enums"]["project_event_type"]
          id?: string
          payload?: Json | null
          project_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: Database["public"]["Enums"]["project_event_type"]
          id?: string
          payload?: Json | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_view_rounds: {
        Row: {
          created_at: string
          delivered_at: string | null
          id: string
          project_id: string
          project_view_id: string
          round_number: number
          status: Database["public"]["Enums"]["round_status"]
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          project_id: string
          project_view_id: string
          round_number?: number
          status?: Database["public"]["Enums"]["round_status"]
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          id?: string
          project_id?: string
          project_view_id?: string
          round_number?: number
          status?: Database["public"]["Enums"]["round_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_view_rounds_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_view_rounds_project_view_id_fkey"
            columns: ["project_view_id"]
            isOneToOne: false
            referencedRelation: "project_views"
            referencedColumns: ["id"]
          },
        ]
      }
      project_views: {
        Row: {
          active: boolean
          created_at: string
          current_round_number: number
          id: string
          label: string
          number: number
          project_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_round_number?: number
          id?: string
          label: string
          number: number
          project_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          current_round_number?: number
          id?: string
          label?: string
          number?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string
          current_round_number: number
          delivery_count: number
          delivery_date: string | null
          delivery_time_window:
            | Database["public"]["Enums"]["time_window"]
            | null
          id: string
          name: string
          public_eta_date: string | null
          public_eta_time_window:
            | Database["public"]["Enums"]["time_window"]
            | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          view_count: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          current_round_number?: number
          delivery_count?: number
          delivery_date?: string | null
          delivery_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          id?: string
          name: string
          public_eta_date?: string | null
          public_eta_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          view_count?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          current_round_number?: number
          delivery_count?: number
          delivery_date?: string | null
          delivery_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          id?: string
          name?: string
          public_eta_date?: string | null
          public_eta_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_events: {
        Row: {
          actor_id: string | null
          created_at: string
          eta_date: string | null
          eta_time_window: Database["public"]["Enums"]["time_window"] | null
          event_type: Database["public"]["Enums"]["stage_event_type"]
          id: string
          project_id: string
          project_view_id: string
          project_view_round_id: string
          stage: Database["public"]["Enums"]["stage_type"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          eta_date?: string | null
          eta_time_window?: Database["public"]["Enums"]["time_window"] | null
          event_type: Database["public"]["Enums"]["stage_event_type"]
          id?: string
          project_id: string
          project_view_id: string
          project_view_round_id: string
          stage: Database["public"]["Enums"]["stage_type"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          eta_date?: string | null
          eta_time_window?: Database["public"]["Enums"]["time_window"] | null
          event_type?: Database["public"]["Enums"]["stage_event_type"]
          id?: string
          project_id?: string
          project_view_id?: string
          project_view_round_id?: string
          stage?: Database["public"]["Enums"]["stage_type"]
        }
        Relationships: [
          {
            foreignKeyName: "stage_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_events_project_view_id_fkey"
            columns: ["project_view_id"]
            isOneToOne: false
            referencedRelation: "project_views"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_events_project_view_round_id_fkey"
            columns: ["project_view_round_id"]
            isOneToOne: false
            referencedRelation: "project_view_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          name: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      view_stage_states: {
        Row: {
          assigned_user_id: string | null
          block_reason: string | null
          completed_at: string | null
          id: string
          latest_eta_date: string | null
          latest_eta_time_window:
            | Database["public"]["Enums"]["time_window"]
            | null
          project_id: string
          project_view_id: string
          project_view_round_id: string
          stage: Database["public"]["Enums"]["stage_type"]
          started_at: string | null
          status: Database["public"]["Enums"]["stage_status"]
          status_before_block:
            | Database["public"]["Enums"]["stage_status"]
            | null
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          block_reason?: string | null
          completed_at?: string | null
          id?: string
          latest_eta_date?: string | null
          latest_eta_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          project_id: string
          project_view_id: string
          project_view_round_id: string
          stage: Database["public"]["Enums"]["stage_type"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
          status_before_block?:
            | Database["public"]["Enums"]["stage_status"]
            | null
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          block_reason?: string | null
          completed_at?: string | null
          id?: string
          latest_eta_date?: string | null
          latest_eta_time_window?:
            | Database["public"]["Enums"]["time_window"]
            | null
          project_id?: string
          project_view_id?: string
          project_view_round_id?: string
          stage?: Database["public"]["Enums"]["stage_type"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["stage_status"]
          status_before_block?:
            | Database["public"]["Enums"]["stage_status"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "view_stage_states_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_stage_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_stage_states_project_view_id_fkey"
            columns: ["project_view_id"]
            isOneToOne: false
            referencedRelation: "project_views"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "view_stage_states_project_view_round_id_fkey"
            columns: ["project_view_round_id"]
            isOneToOne: false
            referencedRelation: "project_view_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      block_stage_v2_rpc: {
        Args: {
          p_project_id: string
          p_reason: string
          p_stage: Database["public"]["Enums"]["stage_type"]
          p_view_ids: string[]
        }
        Returns: Json
      }
      check_data_integrity_rpc: { Args: never; Returns: Json }
      create_revision_round_v2_rpc: {
        Args: { p_project_id: string; p_view_ids: string[] }
        Returns: Json
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      ensure_workflow_v2_rpc: { Args: { p_project_id: string }; Returns: Json }
      finish_stage_v2_rpc: {
        Args: {
          p_project_id: string
          p_stage: Database["public"]["Enums"]["stage_type"]
          p_view_ids: string[]
        }
        Returns: Json
      }
      mark_delivery_sent_v2_rpc: {
        Args: { p_project_id: string; p_view_ids: string[] }
        Returns: Json
      }
      reset_stage_v2_rpc: {
        Args: {
          p_project_id: string
          p_stage: Database["public"]["Enums"]["stage_type"]
          p_view_ids: string[]
        }
        Returns: Json
      }
      start_stage_v2_rpc: {
        Args: {
          p_eta_date?: string
          p_eta_time_window?: Database["public"]["Enums"]["time_window"]
          p_project_id: string
          p_stage: Database["public"]["Enums"]["stage_type"]
          p_view_ids: string[]
        }
        Returns: Json
      }
      undo_delivery_sent_v2_rpc: {
        Args: { p_delivered_at: string; p_project_id: string }
        Returns: Json
      }
    }
    Enums: {
      client_status: "active" | "inactive" | "archived"
      project_event_type:
        | "project_created"
        | "delivery_date_changed"
        | "public_eta_changed"
        | "view_count_changed"
        | "delivery_marked_sent"
        | "revision_round_created"
        | "project_archived"
        | "information_received"
        | "information_completed"
        | "project_status_changed"
        | "admin_review_approved"
        | "delivery_undone"
      project_status:
        | "not_started"
        | "in_progress"
        | "waiting_for_client"
        | "ready_to_deliver"
        | "delivered"
        | "revision_in_progress"
        | "archived"
        | "in_production"
        | "waiting_for_info"
        | "waiting_for_feedback"
        | "active"
        | "revision"
        | "ready_to_start"
      round_status:
        | "active"
        | "delivered"
        | "revision_requested"
        | "ready_for_admin_review"
      stage_event_type:
        | "stage_started"
        | "stage_eta_changed"
        | "stage_finished"
        | "stage_reopened"
        | "stage_blocked"
        | "stage_unblocked"
        | "stage_reset"
      stage_status:
        | "not_started"
        | "in_progress"
        | "done"
        | "blocked"
        | "reopened"
      stage_type: "initial" | "advanced" | "post_production"
      time_window: "Midday" | "Afternoon" | "EOD"
      user_role: "admin" | "team_member" | "client"
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
    Enums: {
      client_status: ["active", "inactive", "archived"],
      project_event_type: [
        "project_created",
        "delivery_date_changed",
        "public_eta_changed",
        "view_count_changed",
        "delivery_marked_sent",
        "revision_round_created",
        "project_archived",
        "information_received",
        "information_completed",
        "project_status_changed",
        "admin_review_approved",
        "delivery_undone",
      ],
      project_status: [
        "not_started",
        "in_progress",
        "waiting_for_client",
        "ready_to_deliver",
        "delivered",
        "revision_in_progress",
        "archived",
        "in_production",
        "waiting_for_info",
        "waiting_for_feedback",
        "active",
        "revision",
        "ready_to_start",
      ],
      round_status: [
        "active",
        "delivered",
        "revision_requested",
        "ready_for_admin_review",
      ],
      stage_event_type: [
        "stage_started",
        "stage_eta_changed",
        "stage_finished",
        "stage_reopened",
        "stage_blocked",
        "stage_unblocked",
        "stage_reset",
      ],
      stage_status: [
        "not_started",
        "in_progress",
        "done",
        "blocked",
        "reopened",
      ],
      stage_type: ["initial", "advanced", "post_production"],
      time_window: ["Midday", "Afternoon", "EOD"],
      user_role: ["admin", "team_member", "client"],
    },
  },
} as const
