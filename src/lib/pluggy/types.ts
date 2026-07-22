export type JsonRecord = Record<string, unknown>;

export interface PluggyPage<T> { results: T[]; next?: string | null; page?: number; totalPages?: number; total?: number }
export interface PluggyItem extends JsonRecord { id: string; status?: string; updatedAt?: string; connector?: { id?: number; name?: string } }
export interface PluggyAccount extends JsonRecord {
  id: string; itemId?: string; type?: string; subtype?: string; name?: string; marketingName?: string;
  balance?: number; currencyCode?: string; number?: string; creditData?: JsonRecord;
}
export interface PluggyTransaction extends JsonRecord {
  id: string; accountId: string; description?: string; amount?: number; date?: string; type?: string;
  status?: string; category?: string; categoryId?: string; currencyCode?: string; providerId?: string;
  merchant?: { name?: string }; paymentData?: JsonRecord; creditCardMetadata?: JsonRecord;
}
export interface PluggyInvestment extends JsonRecord { id:string; name?:string; type?:string; balance?:number; amount?:number; value?:number; quantity?:number; unitValue?:number; currencyCode?:string; code?:string; dueDate?:string; institution?:JsonRecord }
export interface PluggyLoan extends JsonRecord { id:string; type?:string; productName?:string; contractNumber?:string; balanceDue?:number; amount?:number; currencyCode?:string; interestRate?:number; startDate?:string; endDate?:string; dueDate?:string; installments?:number }

export interface PluggyRequestOptions { method?: "GET" | "POST"; body?: JsonRecord; query?: Record<string,string|number|undefined>; timeoutMs?: number }
