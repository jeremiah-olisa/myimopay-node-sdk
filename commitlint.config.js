// @sdk-owner: A0-contracts
// @sdk-phase: 1

/**
 * Conventional Commits, enforced on the commit subject only. Squash-merged PRs
 * take their title from the same format, which is what changesets and the
 * changelog generator read.
 */
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    'scope-enum': [
      2,
      'always',
      ['core', 'node', 'browser', 'docs', 'ci', 'deps', 'release', 'repo', 'tooling'],
    ],
  },
};

export default config;
