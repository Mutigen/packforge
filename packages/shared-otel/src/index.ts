export type TelemetryServiceConfig = {
  serviceName: string
  serviceVersion?: string
  otlpEndpoint?: string
}

export function createTelemetryConfig(config: TelemetryServiceConfig): TelemetryServiceConfig {
  return config
}
