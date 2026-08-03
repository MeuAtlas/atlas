export type JsonRecord = Record<string, unknown>;

export interface PluggyPage<T> { results: T[]; next?: string | null; page?: number; totalPages?: number; total?: number; totalResults?:number }
export interface PluggyItem extends JsonRecord { id: string; status?: string; executionStatus?:string; updatedAt?: string; lastUpdatedAt?:string; error?:{code?:string;message?:string}|null; statusDetail?:JsonRecord|null; connector?: { id?: number; name?: string } }
export interface PluggyAccount extends JsonRecord {
  id: string; itemId?: string; type?: string; subtype?: string; name?: string; marketingName?: string;
  balance?: number; currencyCode?: string; number?: string; creditData?: JsonRecord;
  parentAccountId?: string; brand?: string; createdAt?: string; updatedAt?: string;
}
export interface PluggyTransaction extends JsonRecord {
  id: string; accountId: string; description?: string; amount?: number; date?: string; type?: string;
  amountInAccountCurrency?:number;convertedAmount?:number;localAmount?:number;status?: string; category?: string; categoryId?: string; currencyCode?: string; providerId?: string;
  merchant?: { name?: string }; paymentData?: JsonRecord; creditCardMetadata?: JsonRecord;
  operationType?: string; operationTypeAdditionalInfo?: string; balance?: number;
  effectiveDate?: string; settlementDate?: string; createdAt?: string; updatedAt?: string;
  billId?:string; billForecastDate?:string; purchaseDate?:string; installmentNumber?:number; totalInstallments?:number; totalAmount?:number;
}
export interface PluggyBill extends JsonRecord {
  id:string; accountId?:string; dueDate:string; billClosingDate?:string|null;
  totalAmount:number; totalAmountCurrencyCode?:string;
  minimumPaymentAmount?:number|null; allowsInstallments?:boolean;
  payments?:PluggyBillPayment[];financeCharges?:PluggyBillFinanceCharge[];
  status?:string; createdAt?:string; updatedAt?:string;
}
export interface PluggyBillPayment extends JsonRecord {id?:string;valueType?:"FULL_PAYMENT"|"INSTALLMENT_PAYMENT"|"OTHER_PAYMENT"|string;paymentDate?:string;paymentMode?:"DEBIT_ACCOUNT"|"BANK_SLIP"|"PAYROLL_DEDUCTION"|"PIX"|string|null;amount?:number;currencyCode?:string}
export interface PluggyBillFinanceCharge extends JsonRecord {id?:string;type?:"LATE_PAYMENT_REMUNERATIVE_INTEREST"|"LATE_PAYMENT_FEE"|"LATE_PAYMENT_INTEREST"|"IOF"|"OTHER"|string;amount?:number;currencyCode?:string;additionalInfo?:string|null}
export interface PluggyIdentity extends JsonRecord {id:string;itemId?:string;fullName?:string;name?:string;document?:string;documentType?:string;taxNumber?:string}
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

export interface PluggyRequestOptions { method?: "GET" | "POST"|"PATCH"; body?: JsonRecord; query?: Record<string,string|number|undefined>; timeoutMs?: number; inspectResponse?:(response:Response,payload:unknown)=>void }
