export class ApiKeyCache {
  private value: { key:string; expiresAt:number } | null = null;
  constructor(private readonly now:()=>number=Date.now) {}
  get() { return this.value && this.value.expiresAt-this.now()>60_000 ? this.value.key : null; }
  set(key:string, ttlMs=2*60*60*1000) { this.value={key,expiresAt:this.now()+ttlMs}; }
  clear() { this.value=null; }
}
