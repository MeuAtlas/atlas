"use client";
import { createContext,useContext,useState } from "react";
import { formatCurrency } from "@/modules/finance/format";
const C=createContext(false);
export function ValueVisibility({children}:{children:React.ReactNode}){const [hidden,setHidden]=useState(false);return <C.Provider value={hidden}><button className="finance-eye" onClick={()=>setHidden(v=>!v)} aria-pressed={hidden}>{hidden?"Mostrar valores":"Ocultar valores"}</button>{children}</C.Provider>}
export function Money({value}:{value:number}){return <>{formatCurrency(value,useContext(C))}</>}
