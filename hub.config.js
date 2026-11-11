/* Lifestyle Christianity Marketing Hub on hub-chassis 1.3.0: the thin config (identity, tokens, labels, file lists, storage
 * prefix, gate). Screens and drawers are in views.js; text and figures in data/. chassis/ is the Library's, unedited. */
window.HUB_CONFIG = {
  id: 'lc-marketing-hub', title: 'Marketing Hub · Lifestyle Christianity', lang: 'en', locale: 'en-US', currency: 'USD',
  home: '/brief',
  /* the hub has one look, light (skin.css holds LC's palette and screens); no dark set, so the chassis keeps it light */
  theme: 'light',
  brand: { name: 'Marketing Hub', logo: '<img src="assets/img/logo-lc-menu.png" alt="Lifestyle Christianity">', favicon: 'assets/img/logo-lc-square.png' },
  /* from skin.css :root: LC black, white and warm grey; LC red as the accent (the brand filter recolours it in skin.css) */
  tokens: { accent: '#b82838', bg: '#f6f3ef', soft: '#fbf9f6', line: '#e4dfd9', ink: '#111', mute: '#5f5a54', head: '#111',
    card: '#fff', accentSoft: '#f4efe9', onAccent: '#fff', ok: '#14694f', warn: '#8a5a00', bad: '#a3202f',
    s1: '#2a5cc0', s2: '#e05635', s3: '#1f8a6f', s4: '#d9a400', s5: '#8e5bb5' },
  fonts: { body: 'Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
    import: 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=DM+Sans:wght@400;500&family=DM+Serif+Display:ital@1&display=swap' },
  skin: ['skin.css?v=b4c778eceb'],
  storage: { prefix: 'lc-mh' },
  /* M3 brand filter (All brands / LC / LCU / Todd White) and M5 charts */
  modules: ['group-filter', 'charts'],
  /* scope.js before audit.js, which reads it; review-config.js is the review widget's config (behind the gate) */
  data: ['data/facts.js', 'data/scope.js', 'data/audit.js', 'data/evidence.js', 'data/proposal.js', 'data/summary-pdf.js', 'data/work.js',
    'data/review-config.js'],
  dataOptional: ['data/results.js'],
  /* share-rules.js before public-view.js, which asks it (Public view: a hub page shared by a link, no sign-in) */
  views: ['views.js', 'views-scope.js', 'share-rules.js', 'public-view.js'],
  /* personal sign-in (M13 key-gated, chassis/gate-key.js): answers.js is the store (window.HubAuth = HubAnswers), Firebase
   * lifestyle-christianity-hub, key ring at hubs/lc/meta/gate. Locally gate-mode.js is false and the hub boots without
   * sign-in; the published mirror's copy is true. */
  gate: { scripts: ['firebase-config.js?v=83ddbcc2fa', 'answers.js?v=1db6c52402'], store: 'HubAuth' },
  labels: {
    filter: 'Filter the menu', navigation: 'Hub navigation', menu: 'Show navigation', closeDrawer: 'Close the details',
    drawerBack: 'Previous drawer', drawerForward: 'Next drawer', switchBeside: 'Switch to another page beside {label}', filterItems: 'Filter {n} pages',
    groupAll: 'All brands', groupFilter: 'Filter by brand',
    gateTitle: 'Marketing Hub', gatePrompt: 'Sign in with your work email. We send you a one-time link; open it in this browser and the hub opens.',
    gateEmail: 'Your work email', gateSend: 'Email me a sign-in link', gateSending: 'Sending…',
    gateSent: 'Check your inbox for a sign-in link and open it in this browser.',
    gateNotListed: 'That address is not on the account list.', gateSendFailed: 'The link could not be sent. Try again.',
    gateLinkFailed: 'That sign-in link did not work. It may have expired or been used already. Ask for a new one.',
    gateNoAccess: 'Signed in as {email}, but this account does not have access to the hub. Ask North Star Communications.',
    gateSignOut: 'Sign out', gateOpenFailed: 'The hub could not be opened. Reload the page to try again.', gateUnavailable: 'The hub is not available.',
    /* the public page (view.html, view.js): the only words a visitor without an account sees besides the copy itself */
    pubLoading: 'Loading…', pubNotShared: 'This page is not shared.', pubNotSharedBody: 'The link may be old, or the page was taken down. Ask the person who sent it for a new one.',
    pubFailed: 'This page could not be loaded. Reload to try again.', pubPdf: 'Save as PDF', pubClose: 'Close',
    pubFoot: 'A read-only copy, as of {date}.',
    pubMenu: 'Pages in this link', pubCopyLink: 'Copy link to this screen', pubCopyLinkHint: 'The address of this page, with the drawer that is open', pubCopied: 'Copied'
  }
};
