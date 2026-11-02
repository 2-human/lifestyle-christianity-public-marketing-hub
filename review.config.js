/* Review widget config. No Firebase project yet, so comments stay in this browser (local-only mode).
 * When the hub gets a shared database, put its config in FIREBASE_CONFIG. Never reuse another client's project. */
window.HUB_REVIEW_CONFIG = {
  FIREBASE_CONFIG: {},
  PAGE_PREFIX: 'lc-marketing-hub:',
  REVIEW_LABELS: {
    toggleButton: 'Feedback', toggleButtonTitle: 'Open the Feedback Drawer', bannerTitle: 'Feedback · Marketing Hub',
    localOnly: 'Feedback stays in this browser for now', exit: 'Close feedback', sidebarTitle: 'Feedback Drawer',
    modeQA: 'QA', modeAnswers: 'Q&A', tabToAnswer: 'To answer', tabAnswered: 'Answered', answeredCount: 'answered', yourAnswer: 'Your answer:',
    answerPlaceholder: 'Your answer…', saveAnswer: 'Save answer', filesLabel: 'files', emptyToAnswer: 'Every question is answered.', emptyAnswered: 'No answers yet.',
    empty: 'No comments on this screen yet. Hover any text and click the + to add one.', add: '+ Comment', save: 'Post comment', cancel: 'Cancel',
    edit: 'Edit', del: 'Delete', resolve: 'Resolve', reopen: 'Reopen', tabOpen: 'Open', tabResolved: 'Resolved', scopePage: 'This screen', scopeAll: 'All screens',
    thisPage: 'This screen', hideSide: 'Hide drawer', showSide: 'Show drawer', resolvePrompt: 'Resolution note (what was done):',
    placeholder: 'Your feedback…', replacementPlaceholder: 'Suggested change (optional)…', namePrompt: 'Your name (so the team knows who left this comment):'
  }
};
