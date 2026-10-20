import type { Metadata } from "next";
import { headers } from "next/headers";
import { Providers } from "./providers";
import "./globals.css";
export const metadata: Metadata = { title: "ConectadOS — Infrastructure Explorer", description: "Infrastructure explorer. Independent development preview.", robots: { index: false, follow: false } };
export default async function Layout({children}:{children:React.ReactNode}) {
 const nonce=(await headers()).get('x-nonce')??undefined;
 return <html lang="es" suppressHydrationWarning><body><Providers nonce={nonce}>{children}</Providers></body></html>;
}
