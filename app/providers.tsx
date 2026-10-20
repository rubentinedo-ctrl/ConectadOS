"use client";
import { ThemeProvider } from "next-themes";
export function Providers({children,nonce}:{children:React.ReactNode;nonce?:string}) {return <ThemeProvider nonce={nonce} attribute="data-theme" defaultTheme="dark" enableSystem={false}>{children}</ThemeProvider>}
