/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./apps/web/app/**/*.{ts,tsx}",
    "./apps/web/components/**/*.{ts,tsx}",
    "./packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        float: "0 30px 70px -34px rgba(15, 23, 42, 0.34)",
        panel: "0 22px 48px -28px rgba(15, 23, 42, 0.28)",
      },
      fontFamily: {
        sans: [
          "\"Avenir Next\"",
          "\"Segoe UI\"",
          "\"Helvetica Neue\"",
          "Helvetica",
          "sans-serif",
        ],
        display: [
          "\"Iowan Old Style\"",
          "\"Palatino Linotype\"",
          "\"Book Antiqua\"",
          "\"URW Palladio L\"",
          "Georgia",
          "serif",
        ],
        mono: [
          "\"Berkeley Mono\"",
          "\"SFMono-Regular\"",
          "ui-monospace",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
