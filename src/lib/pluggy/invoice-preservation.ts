import {
  isUnavailableProviderValue,
  shouldPreservePreviousValue,
  type DataCompleteness,
} from "./resilience";
import {shouldAcceptIncomingInvoiceTotal} from "./bill-domain";
import {
  resolveStatementDisplayAmount,
  type StatementChangeReason,
} from "./statement-value-policy";

type InvoiceRow=Record<string,unknown>;

const numeric=(value:unknown)=>{
  if(isUnavailableProviderValue(value))return null;
  const parsed=typeof value==="number"?value:Number(value);
  return Number.isFinite(parsed)?Math.abs(parsed):null;
};

export function reliableInvoiceTotal(row:InvoiceRow|null|undefined){
  if(!row)return null;
  const complete=row.data_completeness==="complete"||
    Boolean(row.last_complete_sync_at);
  for(const key of ["manual_invoice_total","confirmed_invoice_total"]){
    const value=numeric(row[key]);
    if(value!==null)return value;
  }
  for(const key of ["provider_invoice_total","calculated_invoice_total"]){
    const value=numeric(row[key]);
    if(value!==null&&complete)return value;
  }
  for(const key of ["last_reliable_invoice_total",
    "current_display_total","total_amount"]){
    const value=numeric(row[key]);
    if(value!==null&&(value>0||complete))return value;
  }
  return null;
}

export function mergeInvoicePersistenceRow(input:{
  previous:InvoiceRow|null;
  incoming:InvoiceRow;
  completeness:DataCompleteness;
  reasons:string[];
  syncedAt:string;
  changeReason?:StatementChangeReason;
  changeSource?:string;
  syncExecutionId?:string|null;
}){
  const {previous,incoming,completeness,reasons,syncedAt}=input;
  const previousCount=numeric(previous?.purchase_count);
  const incomingCount=numeric(incoming.purchase_count);
  const previousCalculated=numeric(previous?.calculated_invoice_total);
  const incomingCalculated=numeric(incoming.calculated_invoice_total);
  const abruptCountDrop=Boolean(
    previousCount!==null&&previousCount>0&&incomingCount===0,
  );
  const abruptTotalDrop=Boolean(
    previousCalculated!==null&&previousCalculated>0&&incomingCalculated===0,
  );
  const resolution=resolveStatementDisplayAmount({
    bankTotalAmount:
      incoming.total_source==="provider_bill"
        ? incoming.provider_invoice_total
        : null,
    calculatedTotalAmount:incoming.calculated_invoice_total,
    calculationCompleteness:completeness,
    lastReliableTotalAmount:reliableInvoiceTotal(previous),
    previousDisplayTotalAmount:previous?.current_display_total,
    manualTotalAmount:
      incoming.manual_invoice_total??incoming.confirmed_invoice_total,
    changeReason:input.changeReason,
  });
  const preserve=completeness==="partial"&&(
    abruptCountDrop||
    abruptTotalDrop||
    resolution.preserved||
    shouldPreservePreviousValue({
      previous:previousCalculated,
      incoming:incomingCalculated,
      completeness,
    })
  );
  const preservationReason=preserve
    ? [...new Set([
        ...reasons,
        ...(abruptCountDrop?["purchase_count_dropped_to_zero"]:[]),
        ...(abruptTotalDrop?["invoice_total_dropped_to_zero"]:[]),
      ])].join(",")
    : null;
  const reliableBefore=reliableInvoiceTotal(previous);
  const incomingIsReliable=shouldAcceptIncomingInvoiceTotal({
    total:incoming.calculated_invoice_total,
    dataCompleteness:completeness,
    source:"calculated",
    paginationComplete:reasons.every(reason=>!reason.includes("pagination")),
    itemHealthy:reasons.every(reason=>!reason.includes("item")),
    connectorAvailable:reasons.every(reason=>!reason.includes("connector")),
    errorCount:reasons.length,
  });
  const reliableIncoming=incomingIsReliable
    ? reliableInvoiceTotal({...incoming,data_completeness:"complete",
        last_complete_sync_at:syncedAt})
    : null;
  const reliableTotal=resolution.lastReliableTotalAmount??
    (completeness==="complete"?reliableIncoming:reliableBefore);
  const reliableCount=completeness==="complete"
    ? incomingCount
    : numeric(previous?.last_reliable_purchase_count) ??
      (previousCount!==null&&(
        previousCount>0||Boolean(previous?.last_complete_sync_at)
      )?previousCount:null);
  const protectedFields=[
    "purchases_total",
    "credits_total",
    "adjustments_total",
    "instruments_total",
    "unassigned_total",
    "unassigned_transactions_total",
    "general_adjustments_total",
    "invoice_total",
    "total_amount",
    "outstanding_amount",
    "purchase_count",
    "provider_invoice_total",
    "calculated_invoice_total",
    "reconciliation_difference",
    "reconciliation_status",
    "invoice_breakdown",
  ];
  const row:InvoiceRow={
    ...incoming,
    ...(preserve&&previous
      ? Object.fromEntries(
          protectedFields
            .filter((field)=>previous[field]!==undefined)
            .map((field)=>[field,previous[field]]),
        )
      : {}),
    last_reliable_invoice_total:reliableTotal,
    current_display_total:resolution.displayTotalAmount,
    last_reliable_purchase_count:reliableCount,
    purchase_count_source:completeness==="complete"
      ? "complete_transactions"
      : reliableCount===null?"unavailable":"last_reliable",
    data_completeness:completeness,
    last_sync_at:syncedAt,
    last_complete_sync_at:
      completeness==="complete"
        ? syncedAt
        : previous?.last_complete_sync_at??null,
    stale_since:
      completeness==="partial"
        ? previous?.stale_since??syncedAt
        : null,
    provider_status:completeness==="partial"?"degraded":"available",
    preservation_reason:preservationReason,
    sync_status:completeness==="complete"?"updated":"partially_updated",
    last_sync_attempt_at:syncedAt,
    last_successful_sync_at:completeness==="complete"?syncedAt:
      previous?.last_successful_sync_at??previous?.last_complete_sync_at??null,
    last_calculation_updated_at:syncedAt,
    last_reliable_snapshot_at:
      resolution.lastReliableTotalAmount!==reliableBefore
        ? syncedAt
        : previous?.last_reliable_snapshot_at??previous?.last_complete_sync_at??null,
    last_remote_updated_at:incoming.provider_updated_at??null,
    last_transaction_count:incomingCount,
    last_complete_transaction_count:completeness==="complete"
      ? incomingCount
      : previous?.last_complete_transaction_count??reliableCount,
    last_partial_transaction_count:completeness==="partial"
      ? incomingCount
      : previous?.last_partial_transaction_count??null,
    value_change_amount:
      resolution.displayTotalAmount!==null&&numeric(previous?.current_display_total)!==null
        ? Math.round((resolution.displayTotalAmount-Number(previous?.current_display_total))*100)/100
        : 0,
    value_change_reason:resolution.reason,
    value_change_source:input.changeSource??"reconciliation",
    sync_execution_id:input.syncExecutionId??null,
  };
  return {
    row,
    preserved:preserve,
    diagnostic:{
      previous_count:previousCount,
      incoming_count:incomingCount,
      previous_total:previousCalculated,
      incoming_total:incomingCalculated,
      completeness,
      preservation_reason:preservationReason,
    },
  };
}
