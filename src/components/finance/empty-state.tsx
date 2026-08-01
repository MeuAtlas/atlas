import Link from "next/link";
import { AtlasText } from "@/components/ui/atlas-text";
export function EmptyState({title,description,href,label}:{title:string;description:string;href?:string;label?:string}){return <div className="finance-empty"><span aria-hidden="true">✦</span><AtlasText as="h3" variant="sectionTitle">{title}</AtlasText><AtlasText as="p" variant="body">{description}</AtlasText>{href&&label?<Link className="atlas-button-label finance-text-link" href={href}>{label}</Link>:null}</div>}
