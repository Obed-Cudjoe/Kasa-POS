import tseslint from 'typescript-eslint'

const config = [
  { ignores: ['.next/**', '.next-dev/**', '.open-next/**', '.wrangler/**', 'node_modules/**', 'public/sw.js', 'public/swe-worker-*.js', 'out/**', 'build/**', 'dist/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
]

export default config
