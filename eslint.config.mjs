import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    ignores: [
      '.next/**/*',
      '.next-dev/**/*',
      '.next-build/**/*',
      '.next-pw/**/*',
      'node_modules/**/*',
      'dist/**/*',
      '**/dist/**/*',
      'apps/api/dist/**/*',
      'build/**/*',
      '.cache/**/*',
      'output/**/*',
      'scripts/auto-gen-i18n.js',
    ],
  },
];

export default eslintConfig;
