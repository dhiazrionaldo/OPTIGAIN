import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown } from "lucide-react"

export interface MetricCardProps {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  icon?: React.ReactNode
  loading?: boolean
}

export function MetricCard({
  title,
  value,
  change,
  changeLabel,
  icon,
  loading = false,
}: MetricCardProps) {
  const isPositive = change && change >= 0
  const trendIcon = isPositive ? (
    <TrendingUp className="h-4 w-4 text-green-600" />
  ) : (
    <TrendingDown className="h-4 w-4 text-red-600" />
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
          {icon && <div className="text-gray-400">{icon}</div>}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 animate-pulse bg-gray-200 rounded" />
        ) : (
          <>
            <div className="text-3xl font-bold">{value}</div>
            {change !== undefined && (
              <div className="mt-2 flex items-center gap-1">
                {trendIcon}
                <span
                  className={`text-xs ${
                    isPositive ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {isPositive ? "+" : ""}{change.toFixed(1)}%
                  {changeLabel && ` ${changeLabel}`}
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
