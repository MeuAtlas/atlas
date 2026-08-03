"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getPluggyItem, testPluggyConnection } from "@/lib/pluggy/client";
import { databaseFailure,logIntegrationFailure } from "@/lib/pluggy/diagnostics";
import { publicPluggyMessage } from "@/lib/pluggy/errors";
import { syncPluggyItem } from "@/lib/pluggy/sync";
import { invalidatePluggySyncCaches } from "@/lib/pluggy/sync-cache";
import type { PluggyResourceType } from "@/lib/pluggy/incremental-sync";
import { invalidateOpenInvoiceCache } from "@/modules/finance/open-invoice-cache";
import { invalidateIntegrationsCache } from "@/modules/finance/integrations-cache";

export type IntegrationActionState={status:"idle"|"success"|"error";message:string};
const okay=(message:string):IntegrationActionState=>({status:"success",message});
const fail=(error:unknown):IntegrationActionState=>({status:"error",message:publicPluggyMessage(error)});
function field(data:FormData,name:string,max=180){const value=String(data.get(name)??"").trim();if(!value||value.length>max)throw new Error("invalid_field");return value}
function refresh(){revalidatePath("/financeiro");revalidatePath("/financeiro/integracoes");revalidatePath("/financeiro/contas");revalidatePath("/financeiro/cartoes");revalidatePath("/financeiro/cartoes?view=current");revalidatePath("/financeiro/cartoes?view=history");revalidatePath("/financeiro/movimentacoes");revalidatePath("/financeiro/relatorios");revalidatePath("/financeiro/relatorios/[year]/[month]","page")}
async function refreshIntegrationTags(
 supabase:Awaited<ReturnType<typeof requireFinanceAccess>>["supabase"],
 userId:string,
 connectionId?:string,
){
 let workspaceId:string|null=null;
 if(connectionId){
  const connection=await supabase.from("bank_connections")
   .select("workspace_id").eq("id",connectionId).eq("owner_id",userId)
   .maybeSingle();
  workspaceId=connection.data?.workspace_id?String(connection.data.workspace_id):null;
 }
 invalidateIntegrationsCache(workspaceId??userId,connectionId);
}
async function invalidateSyncResult(
 supabase:Awaited<ReturnType<typeof requireFinanceAccess>>["supabase"],
 userId:string,
 connectionId:string,
 summary:Awaited<ReturnType<typeof syncPluggyItem>>["summary"],
){
 const connection=await supabase.from("bank_connections")
  .select("workspace_id").eq("id",connectionId).eq("owner_id",userId)
  .maybeSingle();
 await invalidatePluggySyncCaches({
  supabase,ownerId:userId,integrationId:connectionId,
  workspaceId:connection.data?.workspace_id?String(connection.data.workspace_id):null,
  summary,
 });
}
function refreshSyncedResources(summary:Awaited<ReturnType<typeof syncPluggyItem>>["summary"]){
 revalidatePath("/financeiro/integracoes");
 const succeeded=new Set(summary.resources.filter(resource=>["succeeded","succeeded_with_warnings"].includes(resource.status)).map(resource=>resource.resourceType));
 if(succeeded.has("accounts")||succeeded.has("transactions")){revalidatePath("/financeiro");revalidatePath("/financeiro/contas");revalidatePath("/financeiro/movimentacoes");revalidatePath("/financeiro/planejamento");revalidatePath("/financeiro/relatorios")}
 if(succeeded.has("credit_cards")||succeeded.has("bills")){revalidatePath("/financeiro");revalidatePath("/financeiro/cartoes");revalidatePath("/financeiro/planejamento");revalidatePath("/financeiro/relatorios");revalidatePath("/financeiro/relatorios/[year]/[month]","page")}
 if(succeeded.has("loans"))revalidatePath("/financeiro/emprestimos");
}
function syncFeedback(result:Awaited<ReturnType<typeof syncPluggyItem>>){
 const names:Record<string,string>={accounts:"contas",transactions:"movimentações",credit_cards:"cartões",bills:"faturas",loans:"empréstimos",investments:"investimentos",identity:"identidade"};
 const unique=(values:string[])=>[...new Set(values)];
 const join=(values:string[])=>values.length<2?(values[0]??""):`${values.slice(0,-1).join(", ")} e ${values.at(-1)}`;
 const updated=unique(result.summary.resources.filter(resource=>["succeeded","succeeded_with_warnings"].includes(resource.status)).map(resource=>names[resource.resourceType]??"dados"));
 const preserved=unique(result.summary.resources.filter(resource=>["preserved","unavailable","failed"].includes(resource.status)).map(resource=>names[resource.resourceType]??"dados"));
 if(result.summary.overallStatus==="completed")return "Sincronização concluída. Os dados disponíveis foram atualizados.";
 const messages=["Sincronização concluída parcialmente."];
 if(updated.length)messages.push(`Produtos atualizados: ${join(updated)}.`);
 if(preserved.length)messages.push(`Sem atualização: ${join(preserved)}. Os últimos dados confiáveis foram preservados.`);
 return messages.join(" ");
}
async function refreshOpenInvoiceCache(supabase:Awaited<ReturnType<typeof requireFinanceAccess>>["supabase"],userId:string){
 const result=await supabase.from("card_invoices").select("id,workspace_id").eq("owner_id",userId).eq("status","open");
 invalidateOpenInvoiceCache((result.data??[]).map(invoice=>({
  cycleId:String(invoice.id),workspaceId:invoice.workspace_id??null,
 })));
}

export async function testCredentialsAction(_state:IntegrationActionState,_data:FormData):Promise<IntegrationActionState>{
 void _state;void _data;const {user}=await requireFinanceAccess();const started=Date.now();try{await testPluggyConnection();return okay("Credenciais validadas com sucesso.")}catch(error){logIntegrationFailure(error,{operation:"credentials.test",stage:"auth",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}

export async function linkItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();let itemId="unknown";
 try{
  itemId=field(data,"item_id");if(!/^[A-Za-z0-9_-]+$/.test(itemId))return {status:"error",message:"Informe um Item ID válido."};
  const item=await getPluggyItem(itemId);
  const result=await supabase.from("bank_connections").upsert({owner_id:user.id,provider:"pluggy",provider_connection_id:item.id,status:"active",sync_status:"idle",connector_name:item.connector?.name??null,last_provider_update_at:item.updatedAt??null,metadata:{itemStatus:item.status??null}},{onConflict:"owner_id,provider,provider_connection_id"}).select("id").single();
  if(result.error){if(result.error.code==="23505")return {status:"error",message:"Este Item já está vinculado a outro perfil."};databaseFailure(result.error,"item_link","bank_connections")}
  await syncPluggyItem(supabase,user.id,String(result.data.id));await refreshOpenInvoiceCache(supabase,user.id);await refreshIntegrationTags(supabase,user.id,String(result.data.id));refresh();return okay("Item vinculado e sincronizado com sucesso.");
 }catch(error){logIntegrationFailure(error,{operation:"item.link",stage:"item_link",durationMs:Date.now()-started,user:user.id,item:itemId,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}

export async function syncItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();try{const connectionId=field(data,"connection_id",50);const result=await syncPluggyItem(supabase,user.id,connectionId,false,{triggerType:"manual"});await refreshOpenInvoiceCache(supabase,user.id);refreshSyncedResources(result.summary);await invalidateSyncResult(supabase,user.id,connectionId,result.summary);return okay(syncFeedback(result))}catch(error){logIntegrationFailure(error,{operation:"sync.action",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}
export async function fullSyncItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();try{const connectionId=field(data,"connection_id",50);const result=await syncPluggyItem(supabase,user.id,connectionId,true,{triggerType:"full_resync"});await refreshOpenInvoiceCache(supabase,user.id);refreshSyncedResources(result.summary);await invalidateSyncResult(supabase,user.id,connectionId,result.summary);return okay(syncFeedback(result))}catch(error){logIntegrationFailure(error,{operation:"sync.full.action",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}
export async function retryResourceAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();
 try{
  const resource=field(data,"resource_type",40) as PluggyResourceType;
  const allowed:PluggyResourceType[]=["accounts","transactions","credit_cards","bills","loans","investments","identity"];
  if(!allowed.includes(resource))return {status:"error",message:"Recurso inválido para nova tentativa."};
  const connectionId=field(data,"connection_id",50);
  const result=await syncPluggyItem(supabase,user.id,connectionId,false,{triggerType:"retry",resourceTypes:[resource]});
  refreshSyncedResources(result.summary);
  await invalidateSyncResult(supabase,user.id,connectionId,result.summary);
  return okay(`${resource==="transactions"?"Movimentações":"Recurso"} atualizado em uma tentativa independente.`);
 }catch(error){logIntegrationFailure(error,{operation:"sync.resource.retry",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Resource Retry Failure]"});return fail(error)}
}
export async function recoverPluggyTransactionsAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();
 try{
  const connectionId=field(data,"connection_id",50);
  const result=await syncPluggyItem(supabase,user.id,connectionId,false,{
   triggerType:"recovery",resourceTypes:["accounts","transactions"],
   recoveryWindowDays:90,
  });
  refreshSyncedResources(result.summary);
  await invalidateSyncResult(supabase,user.id,connectionId,result.summary);
  return okay(syncFeedback(result));
 }catch(error){
  logIntegrationFailure(error,{operation:"sync.recovery",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Recovery Failure]"});
  return fail(error);
 }
}
export async function toggleAutomaticSyncAction(
 _state:IntegrationActionState,
 data:FormData,
):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();
 try{
  const connectionId=field(data,"connection_id",50);
  const enabled=String(data.get("enabled")??"false")==="true";
  const updated=await supabase.from("bank_connections")
   .update({automatic_sync_enabled:enabled})
   .eq("id",connectionId).eq("owner_id",user.id)
   .eq("provider","pluggy").neq("status","disabled")
   .select("id").single();
  if(updated.error)databaseFailure(
   updated.error,"connection_update","bank_connections.automatic_sync",
  );
  revalidatePath("/financeiro/integracoes");
  await refreshIntegrationTags(supabase,user.id,connectionId);
  return okay(
   enabled
    ?"Sincronização automática ativada."
    :"Sincronização automática desativada.",
  );
 }catch(error){
  logIntegrationFailure(error,{
   operation:"sync.automatic.toggle",stage:"connection_update",
   durationMs:0,user:user.id,label:"[Atlas Pluggy Automatic Sync Failure]",
  });
  return fail(error);
 }
}
export async function syncCurrentInvoicesAction(){
 const {supabase,user}=await requireFinanceAccess();const connections=await supabase.from("bank_connections").select("id").eq("owner_id",user.id).eq("provider","pluggy").eq("status","active");if(connections.error)databaseFailure(connections.error,"connection_load","bank_connections.current_invoice_sync");let partial=false;for(const connection of connections.data??[]){const result=await syncPluggyItem(supabase,user.id,String(connection.id),false);partial=partial||result.warnings.length>0}await refreshOpenInvoiceCache(supabase,user.id);refresh();redirect(`/financeiro/cartoes?view=current&sync=${partial?"partial":"complete"}`)
}
export async function unlinkItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();try{const connectionId=field(data,"connection_id",50);const result=await supabase.rpc("unlink_financial_connection",{target_connection:connectionId});if(result.error)throw result.error;await refreshIntegrationTags(supabase,user.id,connectionId);refresh();return okay("Conexão removida. Os dados já importados foram preservados.")}catch{return {status:"error",message:"Não foi possível remover a conexão. Verifique se há uma sincronização em andamento."}}
}
