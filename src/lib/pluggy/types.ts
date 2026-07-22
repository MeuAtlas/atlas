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
export interface PluggyLoanInterestRate extends JsonRecord { taxType?:string; interestRateType?:string; taxPeriodicity?:string; preFixedRate?:number; postFixedRate?:number }
export interface PluggyLoanInstallments extends JsonRecord { typeNumberOfInstallments?:string; totalNumberOfInstallments?:number; typeContractRemaining?:string; contractRemainingNumber?:number; paidInstallments?:number; dueInstallments?:number; pastDueInstallments?:number }
export interface PluggyLoanPayments extends JsonRecord { contractOutstandingBalance?:number }
export interface PluggyLoan extends JsonRecord {
  id:string; itemId?:string; providerId?:string; contractNumber?:string; productName?:string; type?:string; date?:string;
  contractDate?:string; settlementDate?:string; contractAmount?:number; currencyCode?:string; dueDate?:string;
  installmentPeriodicity?:string; firstInstallmentDueDate?:string; CET?:number; amortizationScheduled?:string;
  interestRates?:PluggyLoanInterestRate[]; installments?:PluggyLoanInstallments; payments?:PluggyLoanPayments;
}

export interface PluggyRequestOptions { method?: "GET" | "POST"; body?: JsonRecord; query?: Record<string,string|number|undefined>; timeoutMs?: number; inspectResponse?:(response:Response,payload:unknown)=>void }
