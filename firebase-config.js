/* The hub's Firebase project. Public by design: access is decided by sign-in and the database rules (firebase/), not by
 * keeping this hidden. Accounts sign in by email link; their role claim decides what they reach.
 * Plain JSON so tools can read it: the Library's publish_gated.sh refuses another project or `emulator`. For local work on
 * the emulators add "emulator": true (this project's ports, firebase.json) and remove it again; answers.js reads it. */
window.FIREBASE_CONFIG = {
  "apiKey": "AIzaSyD78qSa1FudlgPRzhbZ5o2cQeDsDt5TDK0",
  "authDomain": "lifestyle-christianity-hub.firebaseapp.com",
  "projectId": "lifestyle-christianity-hub",
  "storageBucket": "lifestyle-christianity-hub.firebasestorage.app",
  "messagingSenderId": "1030074783709",
  "appId": "1:1030074783709:web:e2967b0e3052006e664834"
};
