export type NormalizedIntegrationError = {
  name: string;
  message: string;
  code?: string;
  status?: number;
  operation?: string;
  stage?: string;
  causeMessage?: string;
  stack?: string;
};

const SENSITIVE_KEYS=/\b(apiKey|clientId|clientSecret|accountNumber|cardNumber|authorization|x-api-key)\b\s*[:=]\s*[^\s|,;}]+/gi;
const UUID=/\b([0-9a-f]{4})[0-9a-f-]{24,}([0-9a-f]{4})\b/gi;

export function sanitizeDiagnostic(value:unknown,maxLength=1200){
  if(typeof value!=="string"||!value.trim())return undefined;
  let safe=value.replace(SENSITIVE_KEYS,"$1=[redacted]").replace(UUID,"$1…$2");
  safe=safe.replace(/Failing row contains \([\s\S]*?\)(?:\.|$)/gi,"Failing row omitted.");
  return safe.slice(0,maxLength);
}

function stringField(value:unknown){return typeof value==="string"&&value.trim()?sanitizeDiagnostic(value):undefined}
function numberField(value:unknown){return typeof value==="number"&&Number.isFinite(value)?value:undefined}

export class PluggyApiError extends Error {
  readonly code?:string;readonly status?:number;readonly operation?:string;readonly retryable:boolean;
  constructor(message:string,options:{code?:string;status?:number;operation?:string;retryable?:boolean;cause?:unknown}={}){
    super(sanitizeDiagnostic(message)??"Erro na API Pluggy.",{cause:options.cause});this.name="PluggyApiError";this.code=options.code;this.status=options.status;this.operation=options.operation;this.retryable=options.retryable??false;
  }
}

// Compatibilidade interna com o nome usado na primeira implementação.
export class PluggyError extends PluggyApiError {
  constructor(message:string,code:string,status?:number,retryable=false){super(message,{code,status,retryable});this.name="PluggyError"}
}

export class IntegrationSyncError extends Error {
  readonly code?:string;readonly status?:number;readonly operation:string;readonly stage:string;
  constructor(message:string,options:{code?:string;status?:number;operation?:string;stage:string;cause?:unknown}){
    super(sanitizeDiagnostic(message)??"Falha na sincronização.",{cause:options.cause});this.name="IntegrationSyncError";this.code=options.code;this.status=options.status;this.operation=options.operation??"sync";this.stage=options.stage;
  }
}

export function normalizeIntegrationError(error:unknown):NormalizedIntegrationError{
  if(error instanceof Error){
    const candidate=error as Error&{code?:unknown;status?:unknown;operation?:unknown;stage?:unknown;cause?:unknown};
    let causeMessage:string|undefined;
    if(candidate.cause instanceof Error)causeMessage=sanitizeDiagnostic(candidate.cause.message);
    else if(typeof candidate.cause==="object"&&candidate.cause!==null&&"message" in candidate.cause)causeMessage=stringField((candidate.cause as {message?:unknown}).message);
    return {name:candidate.name||"Error",message:sanitizeDiagnostic(candidate.message)??"Erro sem mensagem.",code:stringField(candidate.code),status:numberField(candidate.status),operation:stringField(candidate.operation),stage:stringField(candidate.stage),causeMessage,stack:process.env.NODE_ENV==="development"?candidate.stack:undefined};
  }
  if(typeof error==="object"&&error!==null){
    const candidate=error as Record<string,unknown>;
    const knownMessage=stringField(candidate.message)??stringField(candidate.details)??stringField(candidate.hint);
    return {name:stringField(candidate.name)??"UnknownObjectError",message:knownMessage??`Erro sem mensagem (campos: ${Object.keys(candidate).filter(key=>!["apiKey","clientId","clientSecret","accountNumber","cardNumber","payload","data"].includes(key)).slice(0,8).join(", ")||"nenhum"}).`,code:stringField(candidate.code),status:numberField(candidate.status),operation:stringField(candidate.operation),stage:stringField(candidate.stage)};
  }
  return {name:"UnknownError",message:sanitizeDiagnostic(typeof error==="string"?error:"")??"Erro desconhecido sem mensagem."};
}

export function publicPluggyMessage(error: unknown) {
  const normalized=normalizeIntegrationError(error);
  if(normalized.code === "pluggy_not_configured") return "A integração Pluggy ainda não está configurada neste ambiente.";
  if(normalized.status === 401 || normalized.status === 403) return "Não foi possível autenticar com a Pluggy.";
  if(normalized.status === 404) return "A conexão solicitada não foi encontrada na Pluggy.";
  if(normalized.status === 409) return "A conexão está sendo atualizada. Tente novamente em instantes.";
  if(normalized.status === 422) return "A Pluggy recusou os parâmetros desta sincronização.";
  if(normalized.status === 429) return "Muitas solicitações foram realizadas. Tente novamente em alguns minutos.";
  if(normalized.code === "pluggy_timeout") return "A Pluggy demorou para responder. Tente novamente.";
  return "Não foi possível concluir a operação com a Pluggy.";
}
