export type AppErrorKind = "network" | "http" | "domain" | "unknown";

export interface AppError {
  kind: AppErrorKind;
  message: string;
  code?: string;
  status?: number;
}
