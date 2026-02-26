export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          created_at: string
        }
        Insert: {
          id: string
          email: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          created_at?: string
        }
      }
      gross_profit_uploads: {
        Row: {
          id: string
          user_id: string
          file_name: string
          uploaded_at: string
          sheet_month: number | null
          sheet_year: number | null
        }
        Insert: {
          id?: string
          user_id: string
          file_name: string
          uploaded_at?: string
          sheet_month?: number | null
          sheet_year?: number | null
        }
        Update: {
          id?: string
          user_id?: string
          file_name?: string
          uploaded_at?: string
          sheet_month?: number | null
          sheet_year?: number | null
        }
      }
      gross_profit_rows: {
        Row: {
          id: string
          upload_id: string
          customer_name: string
          product_spec: string
          quantity: number
          amount_sales: number
          freight_cost: number
          net_sales: number
          cogs: number
          gross_margin_value: number
          gross_margin_percent: number
          status: string | null
          sheet_month: number | null
          sheet_year: number | null
        }
        Insert: {
          id?: string
          upload_id: string
          customer_name: string
          product_spec: string
          quantity: number
          amount_sales: number
          freight_cost: number
          net_sales: number
          cogs: number
          gross_margin_value: number
          gross_margin_percent: number
          status?: string | null
          sheet_month?: number | null
          sheet_year?: number | null
        }
        Update: {
          id?: string
          upload_id?: string
          customer_name?: string
          product_spec?: string
          quantity?: number
          amount_sales?: number
          freight_cost?: number
          net_sales?: number
          cogs?: number
          gross_margin_value?: number
          gross_margin_percent?: number
          status?: string | null
          sheet_month?: number | null
          sheet_year?: number | null
        }
      }
      ai_recommendations: {
        Row: {
          id: string
          upload_id: string
          original_row_id: string | null
          customer_name: string
          product_spec: string
          suggested_quantity: number | null
          suggested_amount_sales: number
          suggested_freight_cost: number
          suggested_cogs: number
          predicted_net_sales: number
          predicted_gm_value: number
          predicted_gm_percent: number
          action: string | null
          confidence_score: number | null
          replaced_from: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          upload_id: string
          original_row_id?: string | null
          customer_name: string
          product_spec: string
          suggested_quantity?: number | null
          suggested_amount_sales: number
          suggested_freight_cost: number
          suggested_cogs: number
          predicted_net_sales: number
          predicted_gm_value: number
          predicted_gm_percent: number
          action?: string | null
          confidence_score?: number | null
          replaced_from?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          upload_id?: string
          original_row_id?: string | null
          customer_name?: string
          product_spec?: string
          suggested_quantity?: number | null
          suggested_amount_sales?: number
          suggested_freight_cost?: number
          suggested_cogs?: number
          predicted_net_sales?: number
          predicted_gm_value?: number
          predicted_gm_percent?: number
          action?: string | null
          confidence_score?: number | null
          replaced_from?: string | null
          reason?: string | null
          created_at?: string
        }
      }
    }
  }
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"]
export type GrossProfitUpload = Database["public"]["Tables"]["gross_profit_uploads"]["Row"]
export type GrossProfitRow = Database["public"]["Tables"]["gross_profit_rows"]["Row"]
export type AIRecommendation = Database["public"]["Tables"]["ai_recommendations"]["Row"]
