import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

const font = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Kargo Hiring Studio",
  description: "Drop in CVs, get a ranked shortlist with interview briefs, then approve every email yourself.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { colorScheme: "dark light", themeColor: "#0a0f24" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a saved Light/System choice never flashes dark. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("kargo-theme");if(t==="light"||t==="system"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} />
      </head>
      <body>
        {/* Slow-moving colour mesh that the glass panels blur and refract. Decorative only. */}
        <div className="g-aurora" aria-hidden="true"><i /><i /><i /><i /></div>
        {children}
      </body>
    </html>
  );
}
