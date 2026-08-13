import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

type LegalSource = {
  filename: string;
  instrumentType: "ACT" | "CCT" | "ADDENDUM";
  instrumentCode: string;
  title: string;
  metadata: Record<string, unknown>;
};

const sourceDirectory = join(process.cwd(), "docs", "flight", "legal-sources");
const sources: LegalSource[] = [
  { filename: "ACT_GOL_Pilotos_2025_2026.pdf", instrumentType: "ACT", instrumentCode: "ACT_GOL_PILOTOS_2025_2026", title: "Acordo Coletivo de Trabalho Específico dos Pilotos da GOL 2025/2026", metadata: { documentRole: "OFFICIAL_SOURCE", legalInterpretation: "NOT_PERFORMED" } },
  { filename: "CCT_Aviacao_Regular_2025_2026.pdf", instrumentType: "CCT", instrumentCode: "CCT_AVIACAO_REGULAR_2025_2026", title: "Convenção Coletiva de Trabalho da Aviação Regular 2025/2026", metadata: { documentRole: "OFFICIAL_SOURCE", legalInterpretation: "NOT_PERFORMED" } },
  { filename: "Aditivo_ACT_GOL_Pilotos_DSR_Periculosidade_2026.pdf", instrumentType: "ADDENDUM", instrumentCode: "ADITIVO_ACT_GOL_PILOTOS_DSR_PERICULOSIDADE_2026", title: "Aditivo ao ACT dos Pilotos da GOL — DSR e Periculosidade 2026", metadata: { documentRole: "OFFICIAL_SOURCE", legalInterpretation: "NOT_PERFORMED", relatedInstrumentCode: "ACT_GOL_PILOTOS_2025_2026", relationType: "SUPPLEMENTS" } },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("As credenciais de servidor do Supabase não foram configuradas.");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

for (const source of sources) {
  const filePath = join(sourceDirectory, source.filename);
  const bytes = await readFile(filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `legal/${source.instrumentType.toLowerCase()}/${hash}.pdf`;
  const existing = await supabase.from("flight_legal_instruments").select("id,source_filename,file_hash_sha256,storage_path,status")
    .eq("file_hash_sha256", hash).maybeSingle();
  if (existing.error) throw new Error(`Falha ao consultar ${source.filename}: ${existing.error.message}`);
  if (existing.data) {
    console.log(JSON.stringify({ status: "existing", instrumentId: existing.data.id, filename: existing.data.source_filename, sha256: existing.data.file_hash_sha256, storagePath: existing.data.storage_path, instrumentStatus: existing.data.status }));
    continue;
  }
  const uploaded = await supabase.storage.from("flight-legal-documents").upload(storagePath, bytes, { contentType: "application/pdf", cacheControl: "private, max-age=0", upsert: false });
  if (uploaded.error) throw new Error(`Falha ao armazenar ${source.filename}: ${uploaded.error.message}`);
  const inserted = await supabase.from("flight_legal_instruments").insert({
    instrument_type: source.instrumentType,
    instrument_code: source.instrumentCode,
    title: source.title,
    status: "DRAFT",
    source_filename: basename(source.filename),
    storage_bucket: "flight-legal-documents",
    storage_path: storagePath,
    file_hash_sha256: hash,
    mime_type: "application/pdf",
    file_size: bytes.length,
    source_notes: "Fonte documental oficial preservada sem interpretação jurídica.",
    metadata: source.metadata,
  }).select("id,source_filename,file_hash_sha256,storage_path,status").single();
  if (inserted.error) {
    await supabase.storage.from("flight-legal-documents").remove([storagePath]);
    throw new Error(`Falha ao registrar ${source.filename}: ${inserted.error.message}`);
  }
  console.log(JSON.stringify({ status: "created", instrumentId: inserted.data.id, filename: inserted.data.source_filename, sha256: inserted.data.file_hash_sha256, storagePath: inserted.data.storage_path, instrumentStatus: inserted.data.status }));
}
