import { PluggyIntegrationPanel } from "@/components/finance/pluggy-integration-panel";
import { getPluggyConfigurationStatus } from "@/lib/pluggy/client";
import { requireFinanceAccess } from "@/modules/finance/access";

const mask=(value:string)=>value.length<8?"••••":`${value.slice(0,4)}…${value.slice(-4)}`;
export default async function Page(){
 const {supabase,user}=await requireFinanceAccess();
 const [result,history]=await Promise.all([supabase.from("bank_connections").select("id,provider_connection_id,connector_name,status,sync_status,last_provider_update_at,last_successful_sync_at,connection_error_message").eq("owner_id",user.id).eq("provider","pluggy").neq("status","disabled").order("created_at",{ascending:false}),supabase.from("financial_sync_runs").select("id,bank_connection_id,status,started_at,accounts_count,cards_count,transactions_count,investments_count,loans_count").eq("owner_id",user.id).order("started_at",{ascending:false}).limit(30)]);
 if(result.error||history.error)throw new Error("Não foi possível carregar as integrações.");
 const connections=(result.data??[]).map(row=>({id:String(row.id),connector_name:row.connector_name?String(row.connector_name):null,status:String(row.status),sync_status:String(row.sync_status),last_provider_update_at:row.last_provider_update_at?String(row.last_provider_update_at):null,last_successful_sync_at:row.last_successful_sync_at?String(row.last_successful_sync_at):null,connection_error_message:row.connection_error_message?String(row.connection_error_message):null,maskedItem:mask(String(row.provider_connection_id))}));
 const runs=(history.data??[]).map(row=>({id:String(row.id),bank_connection_id:String(row.bank_connection_id),status:String(row.status),started_at:String(row.started_at),accounts_count:Number(row.accounts_count),cards_count:Number(row.cards_count),transactions_count:Number(row.transactions_count),investments_count:Number(row.investments_count),loans_count:Number(row.loans_count)}));
 return <PluggyIntegrationPanel configured={getPluggyConfigurationStatus().configured} connections={connections} runs={runs}/>;
}
export const maxDuration=60;
