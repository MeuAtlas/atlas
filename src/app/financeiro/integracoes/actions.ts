"use server";

import { revalidatePath } from "next/cache";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getPluggyItem, testPluggyConnection } from "@/lib/pluggy/client";
import { databaseFailure,logIntegrationFailure } from "@/lib/pluggy/diagnostics";
import { publicPluggyMessage } from "@/lib/pluggy/errors";
import { syncPluggyItem } from "@/lib/pluggy/sync";

export type IntegrationActionState={status:"idle"|"success"|"error";message:string};
const okay=(message:string):IntegrationActionState=>({status:"success",message});
const fail=(error:unknown):IntegrationActionState=>({status:"error",message:publicPluggyMessage(error)});
function field(data:FormData,name:string,max=180){const value=String(data.get(name)??"").trim();if(!value||value.length>max)throw new Error("invalid_field");return value}
function refresh(){revalidatePath("/financeiro");revalidatePath("/financeiro/integracoes");revalidatePath("/financeiro/contas");revalidatePath("/financeiro/cartoes");revalidatePath("/financeiro/movimentacoes")}

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
  await syncPluggyItem(supabase,user.id,String(result.data.id));refresh();return okay("Item vinculado e sincronizado com sucesso.");
 }catch(error){logIntegrationFailure(error,{operation:"item.link",stage:"item_link",durationMs:Date.now()-started,user:user.id,item:itemId,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}

export async function syncItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();try{const result=await syncPluggyItem(supabase,user.id,field(data,"connection_id",50),false);refresh();return okay(`Sincronização concluída: ${result.counts.transactions} movimentações processadas${result.warnings.length?` com ${result.warnings.length} aviso(s)`:""}.`)}catch(error){logIntegrationFailure(error,{operation:"sync.action",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}
export async function fullSyncItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase,user}=await requireFinanceAccess();const started=Date.now();try{const result=await syncPluggyItem(supabase,user.id,field(data,"connection_id",50),true);refresh();return okay(`Ressincronização concluída: ${result.counts.transactions} movimentações processadas${result.warnings.length?` com ${result.warnings.length} aviso(s)`:""}.`)}catch(error){logIntegrationFailure(error,{operation:"sync.full.action",stage:"sync",durationMs:Date.now()-started,user:user.id,label:"[Atlas Pluggy Action Failure]"});return fail(error)}
}
export async function unlinkItemAction(_state:IntegrationActionState,data:FormData):Promise<IntegrationActionState>{
 const {supabase}=await requireFinanceAccess();try{const result=await supabase.rpc("unlink_financial_connection",{target_connection:field(data,"connection_id",50)});if(result.error)throw result.error;refresh();return okay("Conexão removida. Os dados já importados foram preservados.")}catch{return {status:"error",message:"Não foi possível remover a conexão. Verifique se há uma sincronização em andamento."}}
}
