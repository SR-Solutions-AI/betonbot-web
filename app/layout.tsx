// app/layout.tsx (Versiune Minimală FĂRĂ Header)
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Betonbot',
  description: 'Offers UI',
  icons: {
    icon: '/favicon.png',
  },
  other: {
    google: 'notranslate',
  },
}

// ATENȚIE: Nu mai importăm Header.tsx, Link sau Supabase aici.

export default function RootLayout({ children }: { children: React.ReactNode }) {
    
    return (
        <html lang="ro" translate="no" className="notranslate"> 
            <body className="min-h-screen">
                <style
                  dangerouslySetInnerHTML={{
                    __html: `
/* Dropdown-uri formular: scrollbar hardcodat (incl. Safari, conținut portalat) */
.sun-menu {
  overflow-y: scroll !important;
  overflow-x: auto !important;
  scrollbar-width: thin !important;
  scrollbar-color: #E5B800 transparent !important;
}
.sun-menu::-webkit-scrollbar {
  width: 10px !important;
  height: 10px !important;
  -webkit-appearance: none !important;
  appearance: none !important;
}
.sun-menu::-webkit-scrollbar-track {
  background: transparent !important;
  -webkit-appearance: none !important;
}
.sun-menu::-webkit-scrollbar-thumb {
  background: #E5B800 !important;
  border-radius: 9999px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
  -webkit-appearance: none !important;
  min-height: 40px !important;
}
.sun-menu::-webkit-scrollbar-thumb:hover {
  background: #F5D030 !important;
}
.sun-menu::-webkit-scrollbar-corner {
  background: transparent !important;
}
`,
                  }}
                />
                
                {/* Canvas: wrapper Full Width / Full Height */}
                {/* p-4 era padding-ul header-ului, îl mutăm pe page.tsx */}
                <div className="w-full h-full min-h-screen">
                    {children}
                </div>
            </body>
        </html>
    )
}