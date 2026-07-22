export const SUPABASE_FILTER_BATCH_SIZE=100;

export function chunkForUrlFilter<T>(values:T[],size=SUPABASE_FILTER_BATCH_SIZE){
 if(!Number.isInteger(size)||size<1)throw new RangeError("Batch size must be a positive integer.");
 return Array.from({length:Math.ceil(values.length/size)},(_,index)=>values.slice(index*size,(index+1)*size));
}

export function shouldRecoverFullHistory(runs:{mode:string;status:string;started_at:string}[]){
 const warning=runs.find(run=>run.status==="completed_with_warnings");
 const completedFull=runs.find(run=>run.mode==="full"&&run.status==="completed");
 return Boolean(warning&&(!completedFull||new Date(completedFull.started_at)<new Date(warning.started_at)));
}
