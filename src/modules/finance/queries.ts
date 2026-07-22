import type { BankConnectionSummary,CreditCard,FinancialAccount,FinancialInvestment,FinancialLoan,FinancialTransaction } from "./types";
import { throwSupabaseError } from "@/lib/errors";

type Client=Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;
export async function getFinanceData(supabase:Client,userId:string){
 const [accounts,transactions,cards,categories,investments,loans,connections]=await Promise.all([
  supabase.from("financial_accounts").select("id,name,institution_name,account_type,current_balance,opening_balance,source,status,visibility,last_sync_at").eq("owner_id",userId).order("created_at"),
  supabase.from("financial_transactions").select("id,description,amount,transaction_type,status,competence_date,due_date,realized_at,source,visibility,account_id,credit_card_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").eq("owner_id",userId).order("competence_date",{ascending:false}).limit(500),
  supabase.from("credit_cards").select("id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,closing_day,due_day,status,visibility,linked_account_id,last_sync_at").eq("owner_id",userId).order("created_at"),
  supabase.from("financial_categories").select("id,name,type").eq("is_active",true).order("name"),
  supabase.from("financial_investments").select("id,name,investment_type,institution_name,balance,currency,last_sync_at").eq("owner_id",userId).order("balance",{ascending:false}),
  supabase.from("financial_loans").select("id,name,loan_type,balance_due,original_amount,currency,end_date,last_sync_at").eq("owner_id",userId).order("balance_due",{ascending:false}),
  supabase.from("bank_connections").select("id,connector_name,sync_status,last_successful_sync_at").eq("owner_id",userId).eq("provider","pluggy").neq("status","disabled").order("last_successful_sync_at",{ascending:false})
 ]);
 for(const [result,context,message] of [[accounts,"contas","Não foi possível carregar suas contas."],[transactions,"movimentações","Não foi possível carregar suas movimentações."],[cards,"cartões","Não foi possível carregar seus cartões."],[categories,"categorias","Não foi possível carregar as categorias."],[investments,"investimentos","Não foi possível carregar os investimentos."],[loans,"empréstimos","Não foi possível carregar os empréstimos."],[connections,"conexões","Não foi possível carregar as conexões."]] as const){if(result.error)throwSupabaseError(result.error,`carregar ${context}`,message)}
 return {accounts:(accounts.data??[]) as FinancialAccount[],transactions:(transactions.data??[]) as unknown as FinancialTransaction[],cards:(cards.data??[]) as CreditCard[],categories:categories.data??[],investments:(investments.data??[]) as FinancialInvestment[],loans:(loans.data??[]) as FinancialLoan[],connections:(connections.data??[]) as BankConnectionSummary[]};
}
