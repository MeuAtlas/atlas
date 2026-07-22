export const formatCurrency=(value:number,hidden=false)=>hidden?"R$ •••••":"R$ "+new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
export const formatDate=(value:string|null)=>value?new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)):"—";
