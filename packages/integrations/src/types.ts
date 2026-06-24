export type DataSourceStatus = "available" | "skipped" | "unavailable";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type FeatureDataSources = Record<string, DataSourceStatus>;
