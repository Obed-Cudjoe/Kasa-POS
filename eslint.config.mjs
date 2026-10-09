import tseslint from 'typescript-eslint'

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'out/**', 'build/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
]

export default config
