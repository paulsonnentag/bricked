import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  // Relative base so the build works from a GitHub Pages project subpath
  // (/bricked/) without hardcoding the repository name.
  base: command === 'build' ? './' : '/',
  server: { host: true },
  build: { target: 'esnext' },
}))
