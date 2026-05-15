import type { Database, StageType, TimeWindow, ProjectStatus, ClientStatus } from './database'

export type User = Database['public']['Tables']['users']['Row']
export type Client = Database['public']['Tables']['clients']['Row']
export type Project = Database['public']['Tables']['projects']['Row']
export type ProjectView = Database['public']['Tables']['project_views']['Row']
export type DeliveryRound = Database['public']['Tables']['delivery_rounds']['Row']
export type ViewStageState = Database['public']['Tables']['view_stage_states']['Row']
export type StageEvent = Database['public']['Tables']['stage_events']['Row']
export type ProjectEvent = Database['public']['Tables']['project_events']['Row']

export interface ProjectWithClient extends Project {
  clients: Client | null
}

export interface ProjectWithDetails extends Project {
  clients: Client | null
  delivery_rounds: DeliveryRound[]
  project_views: ProjectView[]
}

export interface RoundWithStates extends DeliveryRound {
  view_stage_states: ViewStageState[]
}

export interface StartStageInput {
  projectId: string
  roundId: string
  viewIds: string[]
  stage: StageType
  etaDate: string | null
  etaTimeWindow: TimeWindow | null
}

export interface FinishStageInput {
  projectId: string
  roundId: string
  viewIds: string[]
  stage: StageType
}

export interface CreateProjectInput {
  name: string
  clientId: string | null
  deliveryDate: string | null
  deliveryTimeWindow: TimeWindow | null
  viewCount: number
}

export const STAGE_LABELS: Record<StageType, string> = {
  initial: 'Initial',
  advanced: 'Advanced',
  post_production: 'Post-prod',
}

export const STAGE_ORDER: StageType[] = ['initial', 'advanced', 'post_production']

export const TIME_WINDOWS: TimeWindow[] = ['Midday', 'Afternoon', 'EOD']

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  waiting_for_info:    'Waiting for info',
  ready_to_start:      'Ready to start',
  in_production:       'In production',
  ready_to_deliver:    'Ready to deliver',
  delivered:           'Delivered',
  waiting_for_feedback:'Waiting for feedback',
  revision_in_progress:'Revision in progress',
  archived:            'Archived',
  // legacy
  not_started:         'Not started',
  in_progress:         'In progress',
  waiting_for_client:  'Waiting',
}

export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = [
  'waiting_for_info',
  'ready_to_start',
  'in_production',
  'ready_to_deliver',
  'delivered',
  'waiting_for_feedback',
  'revision_in_progress',
]

export const BLOCK_REASONS = [
  'Waiting for assets',
  'Waiting for approval',
  'Technical issue',
  'Awaiting client feedback',
  'Scope unclear',
  'Other',
] as const

export type BlockReason = typeof BLOCK_REASONS[number]

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active:   'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

export function roundLabel(n: number): string {
  return `Round ${String(n).padStart(2, '0')}`
}

export function viewLabel(n: number): string {
  return `View ${String(n).padStart(2, '0')}`
}
