import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

const webProject = './packages/web/tsconfig.json';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'node_modules/**'] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.check.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  // The web UI runs in a browser: it has its own tsconfig (DOM, bundler resolution) and Svelte
  // files, which are parsed by svelte-eslint-parser with TypeScript inside.
  ...svelte.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['packages/web/**/*.svelte'],
  })),
  {
    files: ['packages/web/**/*.ts', 'packages/web/**/*.svelte'],
    languageOptions: {
      parserOptions: {
        project: webProject,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['packages/web/**/*.svelte'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  // Runes files (`.svelte.ts`) hold module-level state, which reads as an unused expression to
  // the generic rules.
  {
    files: ['packages/web/**/*.svelte.ts'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off' },
  },
);
