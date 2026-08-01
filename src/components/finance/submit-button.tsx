"use client";
import { useFormStatus } from "react-dom";
export function SubmitButton({children,className="finance-button"}:{children:React.ReactNode;className?:string}){const {pending}=useFormStatus();return <button className={`atlas-button-label ${className}`} disabled={pending}>{pending?"Salvando…":children}</button>}
