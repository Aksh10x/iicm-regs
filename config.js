// The only file you edit on the website side.
window.IICM = {
  // Where the registration API lives. Leave empty when the site and API are deployed together
  // (Vercel or `npm start`); otherwise the full URL, e.g. 'https://iicm-api.vercel.app/api'.
  API_URL: '',

  // Optional: the Events tab of the Google Sheet "published to the web as CSV", so events stay editable in the Sheet.
  // Use the same link as EVENTS_URL in the server's .env. Leave empty to load events from the API instead.
  EVENTS_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQqhSf5iPPEyLNYeyh8oJzQiVg_sAHXxhcAvD2OUX1DVg6H1YH5a5Gba11H_0vHJtqvBqT79JVkA5fT/pub?gid=358194801&single=true&output=csv',

  // Students must register with an address on this domain (the server enforces EMAIL_DOMAINS, same default).
  EMAIL_DOMAIN: 'kgpian.iitkgp.ac.in',

  // Shown to students on the success screen.
  CONTACT_EMAIL: 'iitkgpcl.iicm9.0@gmail.com',

  // Hero photo carousel. Put the photos in the img/ folder (1920x1080 JPG, under 400 KB each) and list them here.
  // Leave SLIDES out (or empty) to keep the labelled placeholders. Any number of slides works.
  // SLIDES: [
  //   { img: 'img/slide-1.jpg', tag: 'Dance',  title: 'The stage is yours' },
  //   { img: 'img/slide-2.jpg', tag: 'Music',  title: 'Turn the volume up' },
  // ],
  SLIDE_MS: 6500, // how long each slide stays, in milliseconds

  // Optional countdown in the hero. Leave empty to hide it. Use an ISO time with the +05:30 offset for IST.
  COUNTDOWN_TO: '', // e.g. '2026-11-08T23:59:00+05:30'
  COUNTDOWN_LABEL: 'Registration closes in',

  // Optional: words in the scrolling strip under the hero. Remove the line to use the default list.
  // Optional polaroid gallery near the bottom (img/gallery-1.jpg ...). Leave out to keep placeholders.
  // GALLERY: [ { img: 'img/gallery-1.jpg', cap: 'Opening night' } ],

  // MARQUEE: ['Dance', 'Music', 'Drama', 'Fine Arts'],

  // Optional link to your rules / code of conduct page. Leave empty to show plain text.
  RULES_URL: '',
};
