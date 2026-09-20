import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voidra",
  description: "A local-first personal assistant",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
