export type FlightScheduleRole = "PLANNED" | "EXECUTION_SNAPSHOT" | "FINAL_EXECUTED";

export type FlightScheduleImport = {
  id: string;
  schedule_role: FlightScheduleRole;
  snapshot_number: number | null;
  original_filename: string;
  file_size: number;
  uploaded_at: string;
  status: string;
  parser_version: string | null;
  document_type: string | null;
  crew_id: string | null;
  crew_name: string | null;
  home_base: string | null;
  document_period_start: string | null;
  document_period_end: string | null;
  document_generated_at: string | null;
  processing_warnings: Array<{ code: string; severity: string; message: string }>;
  official_month_flight_time_minutes?: number | null;
  official_month_duty_time_minutes?: number | null;
  official_off_days?: number | null;
};
