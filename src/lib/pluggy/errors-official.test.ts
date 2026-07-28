import assert from "node:assert/strict";
import test from "node:test";
import {mapPluggyError,publicPluggyMessage,PluggyApiError} from "./errors";

for(const [code,status,message] of [
 ["ITEM_ALREADY_UPDATING","updating","A conta já está sendo atualizada."],
 ["CONNECTOR_OFFLINE","connector_offline","O conector da instituição está temporariamente indisponível."],
 ["ITEM_MFA_EXPIRED","waiting_mfa","O código de confirmação expirou."],
 ["CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY","rate_limited","A próxima atualização estará disponível mais tarde."],
] as const)test(code,()=>{
 const mapped=mapPluggyError(code);
 assert.equal(mapped?.syncStatus,status);
 assert.equal(mapped?.message,message);
 assert.equal(publicPluggyMessage(new PluggyApiError("provider detail",{code})),message);
});

test("Bill não encontrada preserva o registro local",()=>{
 const mapped=mapPluggyError("CREDIT_CARD_BILL_NOT_FOUND");
 assert.equal(mapped?.syncStatus,"partial");
 assert.equal(mapped?.action,"retry_later");
});
