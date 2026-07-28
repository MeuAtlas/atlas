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

export type PluggyErrorAction=
  |"reconnect"|"wait"|"open_widget"|"support"|"block"
  |"reauthenticate"|"retry_later"|"restart_update"|"none";

const OFFICIAL_ERRORS:Record<string,{message:string;action:PluggyErrorAction;syncStatus:string}>={
 PARAMETERS_NOT_PROVIDED:{message:"São necessárias informações adicionais para atualizar a conexão.",action:"reconnect",syncStatus:"waiting_credentials"},
 ITEM_ALREADY_UPDATING:{message:"A conta já está sendo atualizada.",action:"wait",syncStatus:"updating"},
 ITEM_IS_ALREADY_UPDATING:{message:"A conta já está sendo atualizada.",action:"wait",syncStatus:"updating"},
 CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY:{message:"A próxima atualização estará disponível mais tarde.",action:"wait",syncStatus:"rate_limited"},
 CREATE_ITEMS_API_FREE_DISABLED:{message:"Novas contas precisam ser conectadas pelo ambiente seguro da Pluggy.",action:"open_widget",syncStatus:"error"},
 SANDBOX_CLIENT_ITEM_UPDATE_NOT_ALLOWED:{message:"Seu plano atual não permite atualizar esta conexão.",action:"none",syncStatus:"error"},
 TOO_MANY_CONSECUTIVE_ERRORS:{message:"A conexão apresentou falhas repetidas.",action:"support",syncStatus:"error"},
 ITEM_CREATION_LIMIT_EXCEEDED:{message:"O limite de conexões do plano foi atingido.",action:"none",syncStatus:"rate_limited"},
 CLIENT_HAS_ITEM_UPDATES_DISABLED:{message:"As atualizações desta conexão estão indisponíveis.",action:"support",syncStatus:"error"},
 ITEM_ORIGINAL_CONNECTED_WITH_DIFFERENT_ACCOUNT:{message:"Esta conexão pertence a outra conta bancária.",action:"block",syncStatus:"error"},
 CONNECTOR_REQUIRED_PARAMETER_VALIDATION_ERROR:{message:"O banco solicitou uma nova confirmação.",action:"open_widget",syncStatus:"waiting_credentials"},
 LAST_EXECUTION_HAD_LOGIN_ERROR:{message:"É necessário renovar o acesso à instituição.",action:"reauthenticate",syncStatus:"waiting_credentials"},
 TOO_MANY_CONSECUTIVE_LOGIN_FAILURES:{message:"Muitas tentativas de acesso falharam. Aguarde antes de tentar novamente.",action:"wait",syncStatus:"rate_limited"},
 CONNECTOR_OFFLINE:{message:"O conector da instituição está temporariamente indisponível.",action:"retry_later",syncStatus:"connector_offline"},
 ITEM_MFA_ALREADY_PROVIDED:{message:"A confirmação já foi enviada.",action:"none",syncStatus:"updating"},
 ITEM_MFA_NOT_FOUND:{message:"A conexão não está aguardando confirmação.",action:"none",syncStatus:"error"},
 ITEM_MFA_EXPIRED:{message:"O código de confirmação expirou.",action:"restart_update",syncStatus:"waiting_mfa"},
 ITEM_MFA_PARAMETER_EXPECTED_MISMATCH:{message:"O banco está aguardando outro tipo de confirmação.",action:"reconnect",syncStatus:"waiting_mfa"},
 MFA_PARAMETER_WAS_ALREADY_USED_ERROR:{message:"Esse código já foi utilizado. Solicite um novo código.",action:"reconnect",syncStatus:"waiting_mfa"},
 MFA_PARAMERTER_WAS_ALREADY_USED_ERROR:{message:"Esse código já foi utilizado. Solicite um novo código.",action:"reconnect",syncStatus:"waiting_mfa"},
 CREDIT_CARD_BILL_NOT_FOUND:{message:"A fatura está temporariamente indisponível no provedor.",action:"retry_later",syncStatus:"partial"},
 IDENTITY_NOT_FOUND:{message:"A identidade do titular não foi disponibilizada.",action:"none",syncStatus:"success"},
};

export function mapPluggyError(code:unknown){
 const normalized=typeof code==="string"
  ? code.trim().toUpperCase().replace(/[\s.-]+/g,"_")
  : "";
 return normalized?OFFICIAL_ERRORS[normalized]??null:null;
}

export function publicPluggyMessage(error: unknown) {
  const normalized=normalizeIntegrationError(error);
  const mapped=mapPluggyError(normalized.code);
  if(mapped)return mapped.message;
  if(normalized.code === "pluggy_not_configured") return "A integração Pluggy ainda não está configurada neste ambiente.";
  if(normalized.status === 401 || normalized.status === 403) return "Não foi possível autenticar com a Pluggy.";
  if(normalized.status === 404) return "A conexão solicitada não foi encontrada na Pluggy.";
  if(normalized.status === 409) return "A conexão está sendo atualizada. Tente novamente em instantes.";
  if(normalized.status === 422) return "A Pluggy recusou os parâmetros desta sincronização.";
  if(normalized.status === 429) return "Muitas solicitações foram realizadas. Tente novamente em alguns minutos.";
  if(normalized.code === "pluggy_timeout") return "A Pluggy demorou para responder. Tente novamente.";
  return "Não foi possível concluir a operação com a Pluggy.";
}
