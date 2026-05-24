import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        sand: '#f8f1e7',
        ember: '#8f3b1e',
        olive: '#5d6b32',
        teal: '#0f766e',
        blush: '#c2415f',
        gold: '#c38b22'
      },
      boxShadow: {
        soft: '0 18px 60px rgba(15, 23, 42, 0.14)'
      }
    }
  },
  plugins: []
};

export default config;
