/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#005EA4',
        secondary: '#006A62',
        tertiary: '#B6171E',
        surface: '#FAF8FF',
        'on-surface': '#131B2E',
        'on-surface-variant': '#404752',
        'surface-container': '#EAEDFF',
        'surface-container-lowest': '#FFFFFF'
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif']
      }
    }
  },
  plugins: []
};
