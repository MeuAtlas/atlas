import {createHash,timingSafeEqual} from "node:crypto";
import {after} from "next/server";
import {syncPluggyItem} from "@/lib/pluggy/sync";
import {maskId} from "@/lib/pluggy/diagnostics";
import {normalizeIntegrationError} from "@/lib/pluggy/errors";
import {createAdminClient} from "@/lib/supabase/admin";

export const runtime="nodejs";
export const maxDuration=60;

type PluggyWebhook={
 event?:unknown;eventId?:unknown;itemId?:unknown;
};

function authorized(request:Request){
 const configured=process.env.PLUGGY_WEBHOOK_SECRET;
 const received=request.headers.get("x-atlas-webhook-secret")??
  request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!configured||!received)return false;
 const left=Buffer.from(configured);const right=Buffer.from(received);
 return left.length===right.length&&timingSafeEqual(left,right);
}

const safeText=(value:unknown,max:number)=>
 typeof value==="string"&&value.length>0&&value.length<=max?value:null;

export async function POST(request:Request){
 if(!authorized(request))return Response.json({error:"unauthorized"},{status:401});
 let payload:PluggyWebhook;
 try{payload=await request.json() as PluggyWebhook}catch{
  return Response.json({error:"invalid_payload"},{status:400});
 }
 const eventId=safeText(payload.eventId,160);
 const event=safeText(payload.event,80);
 const itemId=safeText(payload.itemId,180);
 if(!eventId||!event)return Response.json({error:"invalid_payload"},{status:400});

 let supabase:ReturnType<typeof createAdminClient>;
 try{supabase=createAdminClient()}catch{
  return Response.json({error:"server_not_configured"},{status:503});
 }
 const claimed=await supabase.from("pluggy_webhook_events").insert({
  event_id:eventId,event_type:event,status:"queued",
  item_hash:itemId?createHash("sha256").update(itemId).digest("hex"):null,
 });
 if(claimed.error?.code==="23505")return Response.json({accepted:true,duplicate:true});
 if(claimed.error)return Response.json({error:"event_not_persisted"},{status:503});

 after(async()=>{
  try{
   if(!itemId||!event.startsWith("item/")){
    await supabase.from("pluggy_webhook_events").update({
     status:"ignored",processed_at:new Date().toISOString(),
    }).eq("event_id",eventId);
    return;
   }
   const connection=await supabase.from("bank_connections")
    .select("id,owner_id").eq("provider","pluggy")
    .eq("provider_connection_id",itemId).eq("status","active").maybeSingle();
   if(connection.error||!connection.data)throw new Error("connection_not_found");
   await supabase.from("pluggy_webhook_events").update({
    status:"processing",bank_connection_id:connection.data.id,
    owner_id:connection.data.owner_id,
   }).eq("event_id",eventId);
   if(event==="item/deleted"){
    await supabase.from("bank_connections").update({
     provider_status:"unavailable",provider_sync_state:"error",
     user_message:"A conexão não está mais disponível na Pluggy.",
     is_complete:false,stale_since:new Date().toISOString(),
    }).eq("id",connection.data.id);
   }else{
    await syncPluggyItem(
     supabase as Parameters<typeof syncPluggyItem>[0],
     String(connection.data.owner_id),String(connection.data.id),false,
     {triggerType:"webhook"},
    );
   }
   await supabase.from("pluggy_webhook_events").update({
    status:"completed",processed_at:new Date().toISOString(),
   }).eq("event_id",eventId);
  }catch(error){
   const normalized=normalizeIntegrationError(error);
   console.error("[Atlas Pluggy Webhook]",{
    operation:"webhook.process",event,eventId:maskId(eventId),
    errorCode:normalized.code??"unknown",
   });
   await supabase.from("pluggy_webhook_events").update({
    status:"failed",processed_at:new Date().toISOString(),
    error_code:(normalized.code??"unknown").slice(0,80),
   }).eq("event_id",eventId);
  }
 });
 return Response.json({accepted:true},{status:202});
}
