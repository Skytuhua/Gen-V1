import type {FormHTMLAttributes, ReactNode} from 'react';

/** Shared composer presentation. Its owner supplies every action and draft. */
export function ComposerView({children,className='',...props}:FormHTMLAttributes<HTMLFormElement>&{children:ReactNode}) {
  return <form {...props} className={`composer${className?' '+className:''}`}>{children}</form>;
}
