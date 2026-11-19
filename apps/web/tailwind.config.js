/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Biru azure — dari pentagon logo SMAN 1 Gorontalo.
        brand: {
          50: '#EEF6FF',
          100: '#D9EBFD',
          200: '#B0D3FA',
          300: '#7DB4F7',
          400: '#4791F1',
          500: '#1B7FE0',
          600: '#1463BE',
          700: '#104F9B',
          800: '#0F417E',
          900: '#0F3A6B',
          950: '#0A2547',
        },
        // Kuning emas — dari tassel toga & buku logo.
        gold: {
          100: '#FFF6DC',
          200: '#FFEBB0',
          300: '#FFD97A',
          400: '#FFC53D',
          500: '#F5B014',
          600: '#D99406',
          700: '#B47408',
        },
        // Navy gelap untuk tema dark futuristik.
        ink: {
          700: '#16263D',
          800: '#0F1E33',
          900: '#0A1628',
          950: '#060D1A',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        glow: '0 0 24px -6px rgba(27, 127, 224, 0.55)',
        'glow-gold': '0 0 24px -6px rgba(255, 197, 61, 0.5)',
      },
    },
  },
  plugins: [],
};
