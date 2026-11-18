import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { normalizePath } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default {
    root: 'src/', // Sources files (typically where index.html is)
    publicDir: '../static/', // Path from "root" to static assets (files that are served as they are)
    base: '/19-sphere-particles-physics/',
    server:
    {
        open: true,
        host: true // Open to local network and display URL
    },
    build:
    {
        outDir: '../dist', // Output in the dist/ folder
        emptyOutDir: true, // Empty the folder first
        sourcemap: true, // Add sourcemap
        rollupOptions:
        {
            input:
            {
                main: resolve(rootDir, 'src/index.html'),
                lesson: resolve(rootDir, 'src/lesson.html'),
            }
        }
    },
    plugins:
    [
        // Minimalist plugin to reload the page on file change in ./static/
        {
            name: 'reload-on-static-change',
            configureServer(server)
            {
                server.watcher.on('all', (event, file) =>
                {
                    if(normalizePath(file).startsWith(server.config.publicDir))
                        server.ws.send({ type: 'full-reload' })
                })
            }
        }
    ]
}
