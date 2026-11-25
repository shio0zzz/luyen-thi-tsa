import { jsxRenderer } from 'hono/jsx-renderer'

export const renderer = jsxRenderer(({ children, title }) => {
  return (
    <html lang="vi">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title ?? 'Exam Lab'}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link
          href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
          rel="stylesheet"
        />
        {/* KaTeX for math rendering */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
        <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
        <script
          defer
          src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
        ></script>
        {/* PDF.js for client-side PDF text extraction */}
        <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs" type="module"></script>
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body class="bg-slate-100 text-slate-800 antialiased">{children}</body>
    </html>
  )
})
