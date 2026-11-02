import {createContext,useContext,type ReactNode} from 'react';
export type SecureArtifactScope={artifactId:string;threadId:string;revision:number;active?:boolean;editable?:boolean;saveStatus?:string};
const Scope=createContext<SecureArtifactScope|null>(null);
export function SecureArtifactProvider({value,children}:{value:SecureArtifactScope;children:ReactNode}){return <Scope value={value}>{children}</Scope>;}
export function useSecureArtifact(){return useContext(Scope);}
