export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'team_member' | 'client'
export type ProjectStatus =
  | 'waiting_for_info'
  | 'ready_to_start'
  | 'in_production'
  | 'ready_to_deliver'
  | 'delivered'
  | 'waiting_for_feedback'
  | 'revision_in_progress'
  | 'archived'
  // legacy values kept for backward compat with existing DB rows
  | 'not_started'
  | 'in_progress'
  | 'waiting_for_client'
export type StageType = 'initial' | 'advanced' | 'post_production'
export type StageStatus = 'not_started' | 'in_progress' | 'done' | 'blocked' | 'reopened'
export type RoundStatus = 'active' | 'delivered' | 'revision_requested' | 'ready_for_admin_review'
export type TimeWindow = 'Midday' | 'Afternoon' | 'EOD'
export type StageEventType =
  | 'stage_started'
  | 'stage_eta_changed'
  | 'stage_finished'
  | 'stage_reopened'
  | 'stage_blocked'
  | 'stage_unblocked'
export type ProjectEventType =
  | 'project_created'
  | 'delivery_date_changed'
  | 'public_eta_changed'
  | 'view_count_changed'
  | 'delivery_marked_sent'
  | 'revision_round_created'
  | 'project_archived'
  | 'information_received'
  | 'information_completed'
  | 'project_status_changed'
  | 'admin_review_approved'

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          name: string
          email: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id: string
          name: string
          email: string
          role?: UserRole
          created_at?: string
        }
        Update: {
          name?: string
          email?: string
          role?: UserRole
        }
      }
      clients: {
        Row: {
          id: string
          name: string
          contact_name: string | null
          contact_email: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_name?: string | null
          contact_email?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          contact_name?: string | null
          contact_email?: string | null
        }
      }
      projects: {
        Row: {
          id: string
          client_id: string | null
          name: string
          status: ProjectStatus
          delivery_date: string | null
          delivery_time_window: TimeWindow | null
          public_eta_date: string | null
          public_eta_time_window: TimeWindow | null
          view_count: number
          current_round_number: number
          delivery_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          name: string
          status?: ProjectStatus
          delivery_date?: string | null
          delivery_time_window?: TimeWindow | null
          public_eta_date?: string | null
          public_eta_time_window?: TimeWindow | null
          view_count?: number
          current_round_number?: number
          delivery_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          name?: string
          status?: ProjectStatus
          delivery_date?: string | null
          delivery_time_window?: TimeWindow | null
          public_eta_date?: string | null
          public_eta_time_window?: TimeWindow | null
          view_count?: number
          current_round_number?: number
          delivery_count?: number
          updated_at?: string
        }
      }
      project_views: {
        Row: {
          id: string
          project_id: string
          number: number
          label: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          number: number
          label: string
          active?: boolean
          created_at?: string
        }
        Update: {
          label?: string
          active?: boolean
        }
      }
      delivery_rounds: {
        Row: {
          id: string
          project_id: string
          round_number: number
          status: RoundStatus
          started_at: string | null
          completed_at: string | null
          delivered_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          round_number: number
          status?: RoundStatus
          started_at?: string | null
          completed_at?: string | null
          delivered_at?: string | null
          created_at?: string
        }
        Update: {
          status?: RoundStatus
          started_at?: string | null
          completed_at?: string | null
          delivered_at?: string | null
        }
      }
      view_stage_states: {
        Row: {
          id: string
          project_id: string
          delivery_round_id: string
          project_view_id: string
          stage: StageType
          status: StageStatus
          assigned_user_id: string | null
          started_at: string | null
          completed_at: string | null
          latest_eta_date: string | null
          latest_eta_time_window: TimeWindow | null
          block_reason: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          delivery_round_id: string
          project_view_id: string
          stage: StageType
          status?: StageStatus
          assigned_user_id?: string | null
          started_at?: string | null
          completed_at?: string | null
          latest_eta_date?: string | null
          latest_eta_time_window?: TimeWindow | null
          block_reason?: string | null
          updated_at?: string
        }
        Update: {
          status?: StageStatus
          assigned_user_id?: string | null
          started_at?: string | null
          completed_at?: string | null
          latest_eta_date?: string | null
          latest_eta_time_window?: TimeWindow | null
          block_reason?: string | null
          updated_at?: string
        }
      }
      stage_events: {
        Row: {
          id: string
          project_id: string
          delivery_round_id: string
          project_view_id: string
          stage: StageType
          event_type: StageEventType
          actor_id: string | null
          eta_date: string | null
          eta_time_window: TimeWindow | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          delivery_round_id: string
          project_view_id: string
          stage: StageType
          event_type: StageEventType
          actor_id?: string | null
          eta_date?: string | null
          eta_time_window?: TimeWindow | null
          created_at?: string
        }
        Update: never
      }
      project_events: {
        Row: {
          id: string
          project_id: string
          actor_id: string | null
          event_type: ProjectEventType
          payload: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          actor_id?: string | null
          event_type: ProjectEventType
          payload?: Json | null
          created_at?: string
        }
        Update: never
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      user_role: UserRole
      project_status: ProjectStatus
      stage_type: StageType
      stage_status: StageStatus
      round_status: RoundStatus
      time_window: TimeWindow
      stage_event_type: StageEventType
      project_event_type: ProjectEventType
    }
  }
}
