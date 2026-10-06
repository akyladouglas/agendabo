/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.service\\.spec\\.ts$', // specs Nest com DI/mock; dominio puro fica no vitest
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
  },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!**/main.ts'],
  coverageDirectory: '../coverage',
  moduleFileExtensions: ['ts', 'js', 'json'],
};
