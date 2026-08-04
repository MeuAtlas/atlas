import "server-only";
import { IntegrationSyncError, normalizeIntegrationError, sanitizeDiagnostic } from "./errors";

export const maskId=(value:string)=>value.length<8?"***":`${value.slice(0,4)}…${value.slice(-4)}`;

export function databaseFailure(error:{code?:string;message?:string;details?:string;hint?:string},stage:string,table:string):never{
  const normalized={code:sanitizeDiagnostic(error.code),message:sanitizeDiagnostic(error.message),details:sanitizeDiagnostic(error.details),hint:sanitizeDiagnostic(error.hint)};
  console.error("[Atlas Supabase Failure]",{stage,table,...normalized});
  throw new IntegrationSyncError(`Falha ao persistir dados na etapa ${stage}.`,{code:normalized.code,operation:"database",stage,cause:new Error([normalized.message,normalized.details,normalized.hint].filter(Boolean).join(" | ")||"Erro Supabase sem mensagem.")});
}

export function logIntegrationFailure(error:unknown,context:{operation?:string;stage:string;durationMs:number;user:string;item?:string;label?:string}){
  const normalized=normalizeIntegrationError(error);
  const diagnostic={operation:normalized.operation??context.operation??"sync",stage:normalized.stage??context.stage,name:normalized.name,message:normalized.message,causeMessage:normalized.causeMessage,providerMessage:normalized.providerMessage,responseBody:normalized.responseBodySanitized,code:normalized.code,status:normalized.status,durationMs:normalized.durationMs??context.durationMs,user:maskId(context.user),item:context.item?maskId(context.item):undefined,stack:normalized.stack};
  console.error(context.label??"[Atlas Pluggy Sync Failure]",JSON.stringify(diagnostic));
  return normalized;
}
