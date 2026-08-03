import "server-only";
import { readPluggyConfig } from "./config-core";
import { PluggyApiError, PluggyError, sanitizeDiagnostic } from "./errors";
import { ApiKeyCache } from "./key-cache";
import type { JsonRecord, PluggyAccount, PluggyBill, PluggyIdentity, PluggyInvestment, PluggyItem, PluggyLoan, PluggyPage, PluggyRequestOptions, PluggyTransaction } from "./types";

const API_URL="https://api.pluggy.ai";
const cache=new ApiKeyCache();
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function config(){ const value=readPluggyConfig(process.env); if(!value.configured) throw new PluggyError("Pluggy is not configured","pluggy_not_configured"); return value; }
export function getPluggyConfigurationStatus(){ return { configured:readPluggyConfig(process.env).configured }; }

async function parse(response:Response):Promise<unknown>{ const text=await response.text(); if(!text)return {}; try{return JSON.parse(text)}catch{return {}} }
function responseError(payload:unknown,status:number,operation:string,retryable:boolean){
 const candidate=typeof payload==="object"&&payload!==null?payload as Record<string,unknown>:{};
 const message=sanitizeDiagnostic(typeof candidate.message==="string"?candidate.message:typeof candidate.error==="string"?candidate.error:"")??`Pluggy respondeu com HTTP ${status}.`;
 const code=typeof candidate.code==="string"?candidate.code:typeof candidate.errorCode==="string"?candidate.errorCode:typeof candidate.codeDescription==="string"?candidate.codeDescription:undefined;
 return new PluggyApiError(message,{status,code,operation,retryable});
}
function retryAfter(response:Response,attempt:number){ const seconds=Number(response.headers.get("retry-after")); return Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,5000):350*(attempt+1); }

async function authenticate(force=false){
  if(!force){const cached=cache.get();if(cached)return cached}
  const {clientId,clientSecret}=config();
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12_000);
    try{
      const response=await fetch(`${API_URL}/auth`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clientId,clientSecret}),signal:controller.signal,cache:"no-store"});
      const payload=await parse(response) as JsonRecord;
      if(!response.ok){const retryable=response.status>=500||response.status===429;if(retryable&&attempt<2){await wait(retryAfter(response,attempt));continue}throw responseError(payload,response.status,"POST /auth",retryable)}
      const key=typeof payload.apiKey==="string"?payload.apiKey:typeof payload.accessToken==="string"?payload.accessToken:"";
      if(!key)throw new PluggyError("Pluggy authentication response is invalid","pluggy_auth_invalid");
      cache.set(key); return key;
    }catch(error){
      if(error instanceof PluggyApiError)throw error;
      if(attempt<2){await wait(350*(attempt+1));continue}
      if(error instanceof DOMException&&error.name==="AbortError")throw new PluggyError("Pluggy timeout","pluggy_timeout",undefined,true);
      throw new PluggyError("Pluggy authentication unavailable","pluggy_auth_unavailable",undefined,true);
    }finally{clearTimeout(timer)}
  }
  throw new PluggyError("Pluggy authentication exhausted retries","pluggy_auth_unavailable",undefined,true);
}

export async function pluggyRequest<T>(path:string,options:PluggyRequestOptions={}):Promise<T>{
  const method=options.method??"GET"; const url=new URL(path,API_URL); Object.entries(options.query??{}).forEach(([key,value])=>{if(value!==undefined)url.searchParams.set(key,String(value))});
  const operation=`${method} ${url.pathname}`;
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),options.timeoutMs??20_000);
    try{
      const apiKey=await authenticate(attempt>0&&attempt===1);
      const response=await fetch(url,{method,headers:{"X-API-KEY":apiKey,"content-type":"application/json"},body:options.body?JSON.stringify(options.body):undefined,signal:controller.signal,cache:"no-store"});
      const payload=await parse(response);
      if(options.inspectResponse){try{options.inspectResponse(response,payload)}catch{/* Diagnostic inspection cannot interrupt a request. */}}
      if(response.ok)return payload as T;
      if(response.status===401&&attempt===0){cache.clear();continue}
      const retryable=method==="GET"&&(response.status===429||response.status>=500);
      if(retryable&&attempt<2){await wait(retryAfter(response,attempt));continue}
      throw responseError(payload,response.status,operation,retryable);
    }catch(error){
      const retryable=method==="GET"&&(!(error instanceof PluggyApiError)||error.retryable);
      if(retryable&&attempt<2){await wait(350*(attempt+1));continue}
      if(error instanceof DOMException&&error.name==="AbortError")throw new PluggyError("Pluggy timeout","pluggy_timeout",undefined,true);
      throw error;
    }finally{clearTimeout(timer)}
  }
  throw new PluggyError("Pluggy request exhausted retries","pluggy_retries_exhausted");
}

export const testPluggyConnection=()=>authenticate(true).then(()=>true);
export const getPluggyItem=(itemId:string)=>pluggyRequest<PluggyItem>(`/items/${encodeURIComponent(itemId)}`);
export const updatePluggyItem=(itemId:string)=>pluggyRequest<PluggyItem>(`/items/${encodeURIComponent(itemId)}`,{method:"PATCH",body:{}});
export const getPluggyAccounts=(itemId:string)=>pluggyRequest<PluggyAccount[]|PluggyPage<PluggyAccount>>("/accounts",{query:{itemId}});
export const getPluggyInvestments=(itemId:string,page=1)=>pluggyRequest<PluggyPage<PluggyInvestment>>("/investments",{query:{itemId,page,pageSize:500}});
function loanList(payload:unknown):Record<string,unknown>[] {
 const value=Array.isArray(payload)?payload:payload&&typeof payload==="object"&&Array.isArray((payload as {results?:unknown[]}).results)?(payload as {results:unknown[]}).results:[];
 return value.filter((row):row is Record<string,unknown>=>Boolean(row)&&typeof row==="object");
}
export function inspectLoanResponse(response:Response,payload:unknown){
 const loans=loanList(payload);const sample=loans[0];const installments=sample?.installments&&typeof sample.installments==="object"?sample.installments as Record<string,unknown>:undefined;const payments=sample?.payments&&typeof sample.payments==="object"?sample.payments as Record<string,unknown>:undefined;
 console.info("[Atlas Pluggy Loans]",{operation:"loans.fetch",status:response.status,count:loans.length,fields:sample?Object.keys(sample).sort():[],types:sample?Object.fromEntries(Object.entries(sample).map(([key,value])=>[key,Array.isArray(value)?"array":value===null?"null":typeof value])):{},hasContractAmount:typeof sample?.contractAmount==="number",hasOutstandingBalance:typeof payments?.contractOutstandingBalance==="number",hasInstallmentAmount:false,hasInstallmentCount:typeof installments?.totalNumberOfInstallments==="number",hasRate:Array.isArray(sample?.interestRates)&&sample.interestRates.length>0,hasDates:Boolean(sample?.contractDate||sample?.firstInstallmentDueDate||sample?.dueDate)});
}
export async function listPluggyLoans(itemId:string){
 const rows:PluggyLoan[]=[];
 for(let pageNumber=1;pageNumber<=100;pageNumber++){
  const page=await pluggyRequest<PluggyLoan[]|PluggyPage<PluggyLoan>>("/loans",{query:{itemId,page:pageNumber,pageSize:500},inspectResponse:inspectLoanResponse});
  if(Array.isArray(page))return [...rows,...page];
  rows.push(...page.results);
  if(page.totalPages&&pageNumber<page.totalPages)continue;
  if(page.next)continue;
  if(page.totalResults!==undefined&&rows.length<page.totalResults)throw new PluggyError("Loan pagination ended before all results","pluggy_pagination_incomplete",undefined,true);
  return rows;
 }
 throw new PluggyError("Loan pagination exceeded the safety limit","pluggy_pagination_limit",undefined,true);
}
export const getPluggyLoans=listPluggyLoans;
export const getPluggyTransactions=(accountId:string,after?:string,dateFrom?:string,dateTo?:string)=>pluggyRequest<PluggyPage<PluggyTransaction>>("/v2/transactions",{query:{accountId,after,dateFrom,dateTo,pageSize:500}});
export const getPluggyTransaction=(transactionId:string)=>pluggyRequest<PluggyTransaction>(`/transactions/${encodeURIComponent(transactionId)}`);
export async function listPluggyBills(accountId:string){
 const rows:PluggyBill[]=[];
 for(let pageNumber=1;pageNumber<=100;pageNumber++){
  const page=await pluggyRequest<PluggyBill[]|PluggyPage<PluggyBill>>("/bills",{query:{accountId,page:pageNumber,pageSize:500}});
  if(Array.isArray(page))return [...rows,...page];
  rows.push(...page.results);
  if(page.totalPages&&pageNumber<page.totalPages)continue;
  if(page.next)continue;
  if(page.totalResults!==undefined&&rows.length<page.totalResults)throw new PluggyError("Bill pagination ended before all results","pluggy_pagination_incomplete",undefined,true);
  return rows;
 }
 throw new PluggyError("Bill pagination exceeded the safety limit","pluggy_pagination_limit",undefined,true);
}
export const getPluggyBills=listPluggyBills;
export const retrievePluggyBill=(billId:string)=>pluggyRequest<PluggyBill>(`/bills/${encodeURIComponent(billId)}`);
export const findPluggyIdentityByItem=(itemId:string)=>pluggyRequest<PluggyIdentity>("/identity",{query:{itemId}});
export const retrievePluggyIdentity=(identityId:string)=>pluggyRequest<PluggyIdentity>(`/identity/${encodeURIComponent(identityId)}`);
