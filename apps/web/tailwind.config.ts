import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: '#5B2A9E',
        mid: '#B341E0',
        pink: '#FF6FB0',
      },
    },
  },
  plugins: [],
} satisfies Config;
