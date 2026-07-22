import Link from "next/link";
export function EmptyState({title,description,href,label}:{title:string;description:string;href?:string;label?:string}){return <div className="finance-empty"><span>✦</span><h3>{title}</h3><p>{description}</p>{href&&label?<Link className="finance-text-link" href={href}>{label}</Link>:null}</div>}
