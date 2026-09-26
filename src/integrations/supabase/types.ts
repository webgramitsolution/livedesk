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
      meeting_join_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          display_name: string
          expires_at: string
          id: string
          meeting_code: string
          requester_session_id: string
          requester_user_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          display_name: string
          expires_at?: string
          id?: string
          meeting_code: string
          requester_session_id: string
          requester_user_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          display_name?: string
          expires_at?: string
          id?: string
          meeting_code?: string
          requester_session_id?: string
          requester_user_id?: string
          status?: string
        }
        Relationships: []
      }
      meeting_presence: {
        Row: {
          display_name: string
          id: string
          is_camera_on: boolean
          is_mic_on: boolean
          joined_at: string
          meeting_code: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          display_name: string
          id?: string
          is_camera_on?: boolean
          is_mic_on?: boolean
          joined_at?: string
          meeting_code: string
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          display_name?: string
          id?: string
          is_camera_on?: boolean
          is_mic_on?: boolean
          joined_at?: string
          meeting_code?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meetings: {
        Row: {
          annotation_enabled: boolean
          created_at: string
          ended_at: string | null
          host_session_id: string | null
          host_user_id: string
          meeting_code: string
          remote_control_enabled: boolean
          status: string
          updated_at: string
        }
        Insert: {
          annotation_enabled?: boolean
          created_at?: string
          ended_at?: string | null
          host_session_id?: string | null
          host_user_id: string
          meeting_code: string
          remote_control_enabled?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          annotation_enabled?: boolean
          created_at?: string
          ended_at?: string | null
          host_session_id?: string | null
          host_user_id?: string
          meeting_code?: string
          remote_control_enabled?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      meeting_participant_permissions: {
        Row: {
          can_annotate: boolean
          can_request_remote_control: boolean
          can_share_screen: boolean
          can_speak: boolean
          can_use_camera: boolean
          id: string
          meeting_code: string
          remote_control_granted: boolean
          session_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          can_annotate?: boolean
          can_request_remote_control?: boolean
          can_share_screen?: boolean
          can_speak?: boolean
          can_use_camera?: boolean
          id?: string
          meeting_code: string
          remote_control_granted?: boolean
          session_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          can_annotate?: boolean
          can_request_remote_control?: boolean
          can_share_screen?: boolean
          can_speak?: boolean
          can_use_camera?: boolean
          id?: string
          meeting_code?: string
          remote_control_granted?: boolean
          session_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      remote_control_sessions: {
        Row: {
          controller_session_id: string
          controller_user_id: string | null
          created_at: string
          expires_at: string
          granted_by: string
          id: string
          meeting_code: string
          mode: string
          presenter_session_id: string
          presenter_user_id: string
          revoke_reason: string | null
          revoked_at: string | null
          status: string
          token: string
        }
        Insert: {
          controller_session_id: string
          controller_user_id?: string | null
          created_at?: string
          expires_at?: string
          granted_by: string
          id?: string
          meeting_code: string
          mode: string
          presenter_session_id: string
          presenter_user_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          status?: string
          token: string
        }
        Update: {
          controller_session_id?: string
          controller_user_id?: string | null
          created_at?: string
          expires_at?: string
          granted_by?: string
          id?: string
          meeting_code?: string
          mode?: string
          presenter_session_id?: string
          presenter_user_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          status?: string
          token?: string
        }
        Relationships: []
      }
      scheduled_meetings: {
        Row: {
          created_at: string
          duration: string
          id: string
          invitees: string[] | null
          meeting_code: string
          meeting_date: string
          meeting_time: string
          recurrence: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration?: string
          id?: string
          invitees?: string[] | null
          meeting_code: string
          meeting_date: string
          meeting_time: string
          recurrence?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration?: string
          id?: string
          invitees?: string[] | null
          meeting_code?: string
          meeting_date?: string
          meeting_time?: string
          recurrence?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_meeting_host: { Args: { _meeting_code: string; _session_id: string }; Returns: Database["public"]["Tables"]["meetings"]["Row"] }
      set_participant_permission: { Args: { _meeting_code: string; _session_id: string; _patch: Json }; Returns: Database["public"]["Tables"]["meeting_participant_permissions"]["Row"] }
      set_all_participant_permissions: { Args: { _meeting_code: string; _patch: Json }; Returns: number }
      set_meeting_controls: { Args: { _meeting_code: string; _patch: Json }; Returns: Database["public"]["Tables"]["meetings"]["Row"] }
      grant_remote_control: { Args: { _meeting_code: string; _presenter_session_id: string; _controller_session_id: string; _mode: string }; Returns: Database["public"]["Tables"]["remote_control_sessions"]["Row"] }
      revoke_remote_control: { Args: { _meeting_code: string; _controller_session_id: string; _reason?: string | null }; Returns: number }
      verify_remote_control_token: { Args: { _meeting_code: string; _token: string }; Returns: Database["public"]["Tables"]["remote_control_sessions"]["Row"] | null }
      remove_participant: { Args: { _meeting_code: string; _session_id: string }; Returns: boolean }
      end_meeting: { Args: { _meeting_code: string }; Returns: boolean }
      cleanup_ended_meetings: { Args: Record<string, never>; Returns: number }
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
    Enums: {},
  },
} as const
