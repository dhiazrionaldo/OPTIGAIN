import { z } from "zod"

// ============================================
// SKU Master Schemas
// ============================================

export const CreateSKUSchema = z.object({
  sku_code: z.string().min(1).max(255),
  product_name: z.string().min(1).max(255),
  category: z.string().min(1).max(255),
  base_price: z.number().positive("Base price must be positive"),
  base_cost: z.number().positive("Base cost must be positive"),
})

export type CreateSKUInput = z.infer<typeof CreateSKUSchema>

// ============================================
// Production Schemas
// ============================================

export const CreateProductionRowSchema = z.object({
  sku_id: z.string().uuid("Invalid SKU ID"),
  production_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid date format",
  }),
  quantity: z.number().int().positive("Quantity must be positive"),
  production_cost: z.number().positive("Production cost must be positive"),
})

export type CreateProductionRowInput = z.infer<typeof CreateProductionRowSchema>

export const GenerateForecastSchema = z.object({
  sku_id: z.string().uuid("Invalid SKU ID"),
})

export type GenerateForecastInput = z.infer<typeof GenerateForecastSchema>

// ============================================
// Simulation Schemas
// ============================================

export const CreateRevenueSimulationSchema = z.object({
  sku_id: z.string().uuid("Invalid SKU ID"),
  new_price: z.number().positive("New price must be positive"),
  new_cost: z.number().positive("New cost must be positive"),
  scenario_name: z.string().min(1).max(255),
})

export type CreateRevenueSimulationInput = z.infer<typeof CreateRevenueSimulationSchema>

// ============================================
// Response Schemas
// ============================================

export const ProductionRowResponseSchema = z.object({
  success: z.boolean(),
  production_id: z.string().uuid().optional(),
  error: z.string().optional(),
})

export const ForecastResponseSchema = z.object({
  success: z.boolean(),
  forecast_id: z.string().uuid().optional(),
  predicted_quantity: z.number().int().optional(),
  confidence: z.number().optional(),
  error: z.string().optional(),
})

export const SimulationResponseSchema = z.object({
  success: z.boolean(),
  simulation_id: z.string().uuid().optional(),
  projected_quantity: z.number().int().optional(),
  projected_revenue: z.number().optional(),
  projected_profit: z.number().optional(),
  error: z.string().optional(),
})

export const SKUResponseSchema = z.object({
  success: z.boolean(),
  sku_id: z.string().uuid().optional(),
  error: z.string().optional(),
})
