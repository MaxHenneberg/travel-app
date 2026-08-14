import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import vue from 'eslint-plugin-vue';

export default [
  ...vue.configs['flat/recommended'],
  { files: ['**/*.ts'], languageOptions: { parser: tsParser }, plugins: { '@typescript-eslint': tseslint } },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tsParser } }, plugins: { '@typescript-eslint': tseslint } },
  { ignores: ['dist/**', 'node_modules/**', 'src/features/compat/runtime.ts', 'src/lib/**', 'src/itinerary/**'] },
];
