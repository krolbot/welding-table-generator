import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'server-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { server: 'server/server.ts', 'nesting-worker': 'server/nestingWorker.ts' },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
  ssr: { target: 'node', noExternal: ['clipper2-ts', 'jszip'] },
})
