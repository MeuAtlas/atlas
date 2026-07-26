type Row=Record<string,unknown>;

export function mergeManualInstallmentCorrection(incoming:Row,existing:Row|undefined){
  if(!existing?.installment_manually_confirmed){
    return incoming;
  }
  return {
    ...incoming,
    total_amount:existing.total_amount,
    total_purchase_amount:existing.total_purchase_amount,
    is_installment:existing.is_installment,
    installment_number:existing.installment_number,
    installment_count:existing.installment_count,
    installment_amount:existing.installment_amount,
    installment_source:"manual",
    installment_confidence:"manual",
    installment_plan_id:existing.installment_plan_id,
    installment_manually_confirmed:true,
  };
}
